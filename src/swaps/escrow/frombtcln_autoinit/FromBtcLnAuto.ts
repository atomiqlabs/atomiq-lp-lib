import {Express, Request, Response} from "express";
import {createHash} from "crypto";
import {FromBtcLnAutoSwap, FromBtcLnAutoSwapState} from "./FromBtcLnAutoSwap";
import {MultichainData, SwapHandlerType} from "../../SwapHandler";
import {ISwapPrice} from "../../../prices/ISwapPrice";
import {ChainSwapType, ClaimEvent, InitializeEvent, RefundEvent, SwapCommitStateType, SwapData} from "@atomiqlabs/base";
import {expressHandlerWrapper, getAbortController, HEX_REGEX} from "../../../utils/Utils";
import {PluginManager} from "../../../plugins/PluginManager";
import {IIntermediaryStorage} from "../../../storage/IIntermediaryStorage";
import {FieldTypeEnum, verifySchema} from "../../../utils/paramcoders/SchemaVerifier";
import {serverParamDecoder} from "../../../utils/paramcoders/server/ServerParamDecoder";
import {ServerParamEncoder} from "../../../utils/paramcoders/server/ServerParamEncoder";
import {IParamReader} from "../../../utils/paramcoders/IParamReader";
import {FromBtcBaseConfig, FromBtcBaseSwapHandler} from "../FromBtcBaseSwapHandler";
import {
    HodlInvoiceInit,
    ILightningWallet,
    LightningNetworkChannel,
    LightningNetworkInvoice
} from "../../../wallets/ILightningWallet";
import {LightningAssertions} from "../../assertions/LightningAssertions";
import {FromBtcLnSwapState} from "../frombtcln_abstract/FromBtcLnSwapAbs";
import {ToBtcLnSwapAbs} from "../tobtcln_abstract/ToBtcLnSwapAbs";

export type FromBtcLnAutoConfig = FromBtcBaseConfig & {
    invoiceTimeoutSeconds?: number,
    minCltv: bigint,
    gracePeriod: bigint,
    gasTokenMax: {[chainId: string]: bigint}
}

export type FromBtcLnAutoRequestType = {
    address: string,
    paymentHash: string,
    amount: bigint,
    token: string,
    gasToken: string,
    gasAmount: bigint,
    claimerBounty: bigint,
    descriptionHash?: string,
    exactOut?: boolean
}

/**
 * Swap handler handling from BTCLN swaps using submarine swaps
 */
export class FromBtcLnAuto extends FromBtcBaseSwapHandler<FromBtcLnAutoSwap, FromBtcLnAutoSwapState> {
    readonly type = SwapHandlerType.FROM_BTCLN_AUTO;
    readonly swapType = ChainSwapType.HTLC;

    activeSubscriptions: Set<string> = new Set<string>();

    readonly config: FromBtcLnAutoConfig;
    readonly lightning: ILightningWallet;
    readonly LightningAssertions: LightningAssertions;

    constructor(
        storageDirectory: IIntermediaryStorage<FromBtcLnAutoSwap>,
        path: string,
        chains: MultichainData,
        lightning: ILightningWallet,
        swapPricing: ISwapPrice,
        config: FromBtcLnAutoConfig
    ) {
        super(storageDirectory, path, chains, swapPricing, config);
        this.config = config;
        this.config.invoiceTimeoutSeconds = this.config.invoiceTimeoutSeconds || 90;
        this.lightning = lightning;
        this.LightningAssertions = new LightningAssertions(this.logger, lightning);
    }

    protected async processPastSwap(swap: FromBtcLnAutoSwap): Promise<"REFUND" | "SETTLE" | null> {
        const {swapContract, signer} = this.getChain(swap.chainIdentifier);
        if(swap.state===FromBtcLnAutoSwapState.CREATED) {
            //Check if already paid
            const parsedPR = await this.lightning.parsePaymentRequest(swap.pr);
            const invoice = await this.lightning.getInvoice(parsedPR.id);

            const isBeingPaid = invoice.status==="held";
            if(!isBeingPaid) {
                //Not paid
                const isInvoiceExpired = parsedPR.expiryEpochMillis<Date.now();
                if(isInvoiceExpired) {
                    this.swapLogger.info(swap, "processPastSwap(state=CREATED): swap LN invoice expired, cancelling, invoice: "+swap.pr);
                    await this.cancelSwapAndInvoice(swap);
                    return null;
                }
                this.subscribeToInvoice(swap);
                return null;
            }

            //Adjust the state of the swap and expiry
            try {
                await this.htlcReceived(swap, invoice);
                //Result is either FromBtcLnSwapState.RECEIVED or FromBtcLnSwapState.CANCELED
            } catch (e) {
                this.swapLogger.error(swap, "processPastSwap(state=CREATED): htlcReceived error", e);
            }

            return null;
        }

        if(swap.state===FromBtcLnAutoSwapState.RECEIVED) {
            try {
                if(!await this.offerHtlc(swap)) {
                    //Expired
                    if(swap.state===FromBtcLnAutoSwapState.RECEIVED) {
                        this.swapLogger.info(swap, "processPastSwap(state=RECEIVED): offer HTLC expired, cancelling invoice: "+swap.pr);
                        await this.cancelSwapAndInvoice(swap);
                    }
                }
            } catch (e) {
                this.swapLogger.error(swap, "processPastSwap(state=RECEIVED): offerHtlc error", e);
            }

            return null;
        }

        if(swap.state===FromBtcLnAutoSwapState.TXS_SENT || swap.state===FromBtcLnAutoSwapState.COMMITED) {
            const onchainStatus = await swapContract.getCommitStatus(signer.getAddress(), swap.data);
            const state: FromBtcLnAutoSwapState = swap.state as FromBtcLnAutoSwapState;
            if(onchainStatus.type===SwapCommitStateType.PAID) {
                //Extract the swap secret
                if(state!==FromBtcLnAutoSwapState.CLAIMED && state!==FromBtcLnAutoSwapState.SETTLED) {
                    const secretHex = await onchainStatus.getClaimResult();
                    const secret: Buffer = Buffer.from(secretHex, "hex");
                    const paymentHash: Buffer = createHash("sha256").update(secret).digest();
                    const paymentHashHex = paymentHash.toString("hex");

                    if (swap.lnPaymentHash!==paymentHashHex) {
                        //TODO: Possibly fatal failure
                        this.swapLogger.error(swap, "processPastSwap(state=TXS_SENT|COMMITED): onchainStatus=PAID, Invalid swap secret specified: "+secretHex+" for paymentHash: "+paymentHashHex);
                        return null;
                    }

                    swap.secret = secretHex;
                    await swap.setState(FromBtcLnAutoSwapState.CLAIMED);
                    await this.saveSwapData(swap);

                    this.swapLogger.warn(swap, "processPastSwap(state=TXS_SENT|COMMITED): swap settled (detected from processPastSwap), invoice: "+swap.pr);

                    return "SETTLE";
                }
                return null;
            }
            if(onchainStatus.type===SwapCommitStateType.COMMITED) {
                if(state===FromBtcLnAutoSwapState.TXS_SENT) {
                    await swap.setState(FromBtcLnAutoSwapState.COMMITED);
                    await this.saveSwapData(swap);

                    this.swapLogger.info(swap, "processPastSwap(state=TXS_SENT|COMMITED): swap committed (detected from processPastSwap), invoice: "+swap.pr);
                }
                return null;
            }
            if(onchainStatus.type===SwapCommitStateType.NOT_COMMITED || onchainStatus.type===SwapCommitStateType.EXPIRED) {
                if(swap.state===FromBtcLnAutoSwapState.TXS_SENT) {
                    const isAuthorizationExpired = await swapContract.isInitAuthorizationExpired(swap.data, swap);
                    if(isAuthorizationExpired) {
                        this.swapLogger.info(swap, "processPastSwap(state=TXS_SENT|COMMITED): swap not committed before authorization expiry, cancelling the LN invoice, invoice: "+swap.pr);
                        await this.cancelSwapAndInvoice(swap);
                        return null;
                    }
                } else {
                    if(await swapContract.isExpired(signer.getAddress(), swap.data)) {
                        this.swapLogger.info(swap, "processPastSwap(state=TXS_SENT|COMMITED): swap timed out, refunding to self, invoice: "+swap.pr);
                        return "REFUND";
                    }
                }
            }
            if(onchainStatus.type===SwapCommitStateType.REFUNDABLE) {
                this.swapLogger.info(swap, "processPastSwap(state=TXS_SENT|COMMITED): swap timed out, refunding to self, invoice: "+swap.pr);
                return "REFUND";
            }
        }

        if(swap.state===FromBtcLnAutoSwapState.CLAIMED) return "SETTLE";
        if(swap.state===FromBtcLnAutoSwapState.CANCELED) await this.cancelSwapAndInvoice(swap);
    }

    protected async refundSwaps(refundSwaps: FromBtcLnAutoSwap[]) {
        for(let refundSwap of refundSwaps) {
            const {swapContract, signer} = this.getChain(refundSwap.chainIdentifier);
            const unlock = refundSwap.lock(swapContract.refundTimeout);
            if(unlock==null) continue;

            this.swapLogger.debug(refundSwap, "refundSwaps(): initiate refund of swap");
            await swapContract.refund(signer, refundSwap.data, true, false, {waitForConfirmation: true});
            this.swapLogger.info(refundSwap, "refundsSwaps(): swap refunded, invoice: "+refundSwap.pr);

            await refundSwap.setState(FromBtcLnAutoSwapState.REFUNDED);
            unlock();
        }
    }

    protected async settleInvoices(swaps: FromBtcLnAutoSwap[]) {
        for(let swap of swaps) {
            try {
                await this.lightning.settleHodlInvoice(swap.secret);
                if(swap.metadata!=null) swap.metadata.times.htlcSettled = Date.now();
                await this.removeSwapData(swap, FromBtcLnAutoSwapState.SETTLED);

                this.swapLogger.info(swap, "settleInvoices(): invoice settled, secret: "+swap.secret);
            } catch (e) {
                this.swapLogger.error(swap, "settleInvoices(): cannot settle invoice", e);
            }
        }
    }

    /**
     * Checks past swaps, refunds and deletes ones that are already expired.
     */
    protected async processPastSwaps() {

        const settleInvoices: FromBtcLnAutoSwap[] = [];
        const refundSwaps: FromBtcLnAutoSwap[] = [];

        const queriedData = await this.storageManager.query([
            {
                key: "state",
                value: [
                    FromBtcLnAutoSwapState.CREATED,
                    FromBtcLnAutoSwapState.RECEIVED,
                    FromBtcLnAutoSwapState.TXS_SENT,
                    FromBtcLnAutoSwapState.COMMITED,
                    FromBtcLnAutoSwapState.CLAIMED,
                    FromBtcLnAutoSwapState.CANCELED,
                ]
            }
        ]);

        for(let {obj: swap} of queriedData) {
            switch(await this.processPastSwap(swap)) {
                case "SETTLE":
                    settleInvoices.push(swap);
                    break;
                case "REFUND":
                    refundSwaps.push(swap);
                    break;
            }
        }

        await this.refundSwaps(refundSwaps);
        await this.settleInvoices(settleInvoices);
    }

    protected async processInitializeEvent(chainIdentifier: string, savedSwap: FromBtcLnAutoSwap, event: InitializeEvent<SwapData>): Promise<void> {
        this.swapLogger.info(savedSwap, "SC: InitializeEvent: HTLC initialized by the client, invoice: "+savedSwap.pr);

        if(savedSwap.state===FromBtcLnAutoSwapState.TXS_SENT) {
            await savedSwap.setState(FromBtcLnAutoSwapState.COMMITED);
            await this.saveSwapData(savedSwap);
        }
    }

    protected async processClaimEvent(chainIdentifier: string, savedSwap: FromBtcLnAutoSwap, event: ClaimEvent<SwapData>): Promise<void> {
        //Claim
        //This is the important part, we need to catch the claim TX, else we may lose money
        const secret: Buffer = Buffer.from(event.result, "hex");
        const paymentHash: Buffer = createHash("sha256").update(secret).digest();
        const secretHex = secret.toString("hex");
        const paymentHashHex = paymentHash.toString("hex");

        if (savedSwap.lnPaymentHash!==paymentHashHex) return;

        this.swapLogger.info(savedSwap, "SC: ClaimEvent: swap HTLC successfully claimed by the client, invoice: "+savedSwap.pr);

        try {
            await this.lightning.settleHodlInvoice(secretHex);
            this.swapLogger.info(savedSwap, "SC: ClaimEvent: invoice settled, secret: "+secretHex);
            savedSwap.secret = secretHex;
            if(savedSwap.metadata!=null) savedSwap.metadata.times.htlcSettled = Date.now();
            await this.removeSwapData(savedSwap, FromBtcLnAutoSwapState.SETTLED);
        } catch (e) {
            this.swapLogger.error(savedSwap, "SC: ClaimEvent: cannot settle invoice", e);
            savedSwap.secret = secretHex;
            await savedSwap.setState(FromBtcLnAutoSwapState.CLAIMED);
            await this.saveSwapData(savedSwap);
        }

    }

    protected async processRefundEvent(chainIdentifier: string, savedSwap: FromBtcLnAutoSwap, event: RefundEvent<SwapData>): Promise<void> {
        this.swapLogger.info(savedSwap, "SC: RefundEvent: swap refunded to us, invoice: "+savedSwap.pr);

        //We don't cancel the incoming invoice, to make the offender pay for this with locked liquidity
        // await this.lightning.cancelHodlInvoice(savedSwap.lnPaymentHash);
        await this.removeSwapData(savedSwap, FromBtcLnAutoSwapState.REFUNDED)
    }

    /**
     * Subscribe to a lightning network invoice
     *
     * @param swap
     */
    private subscribeToInvoice(swap: FromBtcLnAutoSwap): boolean {
        const paymentHash = swap.lnPaymentHash;
        if(this.activeSubscriptions.has(paymentHash)) return false;

        this.lightning.waitForInvoice(paymentHash).then(result => {
            this.swapLogger.info(swap, "subscribeToInvoice(): result callback, outcome: "+result.status+" invoice: "+swap.pr);
            if(result.status==="held")
                this.htlcReceived(swap, result).catch(e => this.swapLogger.error(swap, "subscribeToInvoice(): HTLC received result", e));
            this.activeSubscriptions.delete(paymentHash);
        });
        this.swapLogger.info(swap, "subscribeToInvoice(): subscribe to invoice: "+swap.pr);

        this.activeSubscriptions.add(paymentHash);
        return true;
    }

    /**
     * Called when lightning HTLC is received, also signs an init transaction on the smart chain side, expiry of the
     *  smart chain authorization starts ticking as soon as this HTLC is received
     *
     * @param invoiceData
     * @param invoice
     */
    private async htlcReceived(invoiceData: FromBtcLnAutoSwap, invoice: LightningNetworkInvoice) {
        if(invoiceData.state!==FromBtcLnAutoSwapState.CREATED) return;
        this.swapLogger.debug(invoiceData, "htlcReceived(): invoice: ", invoice);
        if(invoiceData.metadata!=null) invoiceData.metadata.times.htlcReceived = Date.now();

        const useToken = invoiceData.token;
        const gasToken = invoiceData.gasToken;

        let expiryTimeout: bigint;
        try {
            //Check if HTLC expiry is long enough
            expiryTimeout = await this.checkHtlcExpiry(invoice);
            if(invoiceData.metadata!=null) invoiceData.metadata.times.htlcTimeoutCalculated = Date.now();
        } catch (e) {
            if(invoiceData.state===FromBtcLnAutoSwapState.CREATED) await this.cancelSwapAndInvoice(invoiceData);
            throw e;
        }

        const {swapContract, signer} = this.getChain(invoiceData.chainIdentifier);

        //Create real swap data
        const swapData: SwapData = await swapContract.createSwapData(
            ChainSwapType.HTLC,
            signer.getAddress(),
            invoiceData.claimer,
            useToken,
            invoiceData.amountToken,
            invoiceData.claimHash,
            0n,
            BigInt(Math.floor(Date.now() / 1000)) + expiryTimeout,
            false,
            true,
            invoiceData.amountGasToken + invoiceData.claimerBounty,
            invoiceData.claimerBounty,
            invoiceData.gasToken
        );
        if(invoiceData.metadata!=null) invoiceData.metadata.times.htlcSwapCreated = Date.now();

        //Important to prevent race condition and issuing 2 signed init messages at the same time
        if(invoiceData.state===FromBtcLnAutoSwapState.CREATED) {
            invoiceData.data = swapData;
            invoiceData.signature = null;
            invoiceData.timeout = (BigInt(Math.floor(Date.now() / 1000)) + 120n).toString(10);

            //Setting the state variable is done outside the promise, so is done synchronously
            await invoiceData.setState(FromBtcLnAutoSwapState.RECEIVED);

            await this.saveSwapData(invoiceData);

            await this.offerHtlc(invoiceData);
        }
    }

    private async offerHtlc(invoiceData: FromBtcLnAutoSwap) {
        if(invoiceData.state!==FromBtcLnAutoSwapState.RECEIVED) return;

        this.swapLogger.debug(invoiceData, "offerHtlc(): invoice: ", invoiceData.pr);
        if(invoiceData.metadata!=null) invoiceData.metadata.times.offerHtlc = Date.now();

        const useToken = invoiceData.token;
        const gasToken = invoiceData.gasToken;

        const {swapContract, signer, chainInterface} = this.getChain(invoiceData.chainIdentifier);

        //Create abort controller for parallel fetches
        const abortController = new AbortController();

        //Pre-fetch data
        const balancePrefetch: Promise<bigint> = this.getBalancePrefetch(invoiceData.chainIdentifier, useToken, abortController);
        const gasTokenBalancePrefetch: Promise<bigint> = invoiceData.getTotalOutputGasAmount()===0n || useToken===gasToken ?
            null : this.getBalancePrefetch(invoiceData.chainIdentifier, gasToken, abortController);

        if(await swapContract.getInitAuthorizationExpiry(invoiceData.data, invoiceData) < Date.now()) {
            if(invoiceData.state===FromBtcLnAutoSwapState.RECEIVED) {
                await this.cancelSwapAndInvoice(invoiceData);
            }
            return false;
        }

        try {
            //Check if we have enough liquidity to proceed
            if(useToken===gasToken) {
                await this.checkBalance(invoiceData.getTotalOutputAmount() + invoiceData.getTotalOutputGasAmount(), balancePrefetch, abortController.signal);
            } else {
                await this.checkBalance(invoiceData.getTotalOutputAmount(), balancePrefetch, abortController.signal);
                await this.checkBalance(invoiceData.getTotalOutputGasAmount(), gasTokenBalancePrefetch, abortController.signal);
            }
            if(invoiceData.metadata!=null) invoiceData.metadata.times.offerHtlcChecked = Date.now();
        } catch (e) {
            if(!abortController.signal.aborted) {
                if(invoiceData.state===FromBtcLnAutoSwapState.RECEIVED) await this.cancelSwapAndInvoice(invoiceData);
            }
            throw e;
        }

        const txWithdraw = await swapContract.txsWithdraw(signer.getAddress(), gasToken, invoiceData.data.getTotalDeposit());
        const txInit = await swapContract.txsInit(signer.getAddress(), invoiceData.data, {
            prefix: invoiceData.prefix,
            timeout: invoiceData.timeout,
            signature: invoiceData.signature
        }, true);

        if(invoiceData.state===FromBtcLnAutoSwapState.RECEIVED) {
            //Setting the state variable is done outside the promise, so is done synchronously
            await invoiceData.setState(FromBtcLnAutoSwapState.TXS_SENT);
            await this.saveSwapData(invoiceData);
            await chainInterface.sendAndConfirm(signer, [...txWithdraw, ...txInit], true, undefined, true);
        }

        return true;
    }

    /**
     * Checks invoice description hash
     *
     * @param descriptionHash
     * @throws {DefinedRuntimeError} will throw an error if the description hash is invalid
     */
    private checkDescriptionHash(descriptionHash: string) {
        if(descriptionHash!=null) {
            if(typeof(descriptionHash)!=="string" || !HEX_REGEX.test(descriptionHash) || descriptionHash.length!==64) {
                throw {
                    code: 20100,
                    msg: "Invalid request body (descriptionHash)"
                };
            }
        }
    }

    /**
     * Asynchronously sends the LN node's public key to the client, so he can pre-fetch the node's channels from 1ml api
     *
     * @param responseStream
     */
    private sendPublicKeyAsync(responseStream: ServerParamEncoder) {
        this.lightning.getIdentityPublicKey().then(publicKey => responseStream.writeParams({
            lnPublicKey: publicKey
        })).catch(e => {
            this.logger.error("sendPublicKeyAsync(): error", e);
        });
    }

    /**
     * Returns the CLTV timeout (blockheight) of the received HTLC corresponding to the invoice. If multiple HTLCs are
     *  received (MPP) it returns the lowest of the timeouts
     *
     * @param invoice
     */
    private getInvoicePaymentsTimeout(invoice: LightningNetworkInvoice): number | null {
        let timeout: number = null;
        invoice.payments.forEach((curr) => {
            if (timeout == null || timeout > curr.timeout) timeout = curr.timeout;
        });
        return timeout;
    }

    /**
     * Checks if the received HTLC's CLTV timeout is large enough to still process the swap
     *
     * @param invoice
     * @throws {DefinedRuntimeError} Will throw if HTLC expires too soon and therefore cannot be processed
     * @returns expiry timeout in seconds
     */
    private async checkHtlcExpiry(invoice: LightningNetworkInvoice): Promise<bigint> {
        const timeout: number = this.getInvoicePaymentsTimeout(invoice);
        const current_block_height = await this.lightning.getBlockheight();

        const blockDelta = BigInt(timeout - current_block_height);

        const htlcExpiresTooSoon = blockDelta < this.config.minCltv;
        if(htlcExpiresTooSoon) {
            throw {
                code: 20002,
                msg: "Not enough time to reliably process the swap",
                data: {
                    requiredDelta: this.config.minCltv.toString(10),
                    actualDelta: blockDelta.toString(10)
                }
            };
        }

        return (this.config.minCltv * this.config.bitcoinBlocktime / this.config.safetyFactor) - this.config.gracePeriod;
    }

    /**
     * Cancels the swap (CANCELED state) & also cancels the LN invoice (including all pending HTLCs)
     *
     * @param invoiceData
     */
    private async cancelSwapAndInvoice(invoiceData: FromBtcLnAutoSwap): Promise<void> {
        await invoiceData.setState(FromBtcLnAutoSwapState.CANCELED);
        await this.lightning.cancelHodlInvoice(invoiceData.lnPaymentHash);
        await this.removeSwapData(invoiceData);
        this.swapLogger.info(invoiceData, "cancelSwapAndInvoice(): swap removed & invoice cancelled, invoice: ", invoiceData.pr);
    };

    /**
     *
     * Checks if the lightning invoice is in HELD state (htlcs received but yet unclaimed)
     *
     * @param paymentHash
     * @throws {DefinedRuntimeError} Will throw if the lightning invoice is not found, or if it isn't in the HELD state
     * @returns the fetched lightning invoice
     */
    private async checkInvoiceStatus(paymentHash: string): Promise<any> {
        const invoice = await this.lightning.getInvoice(paymentHash);
        if(invoice==null) throw {
            _httpStatus: 200,
            code: 10001,
            msg: "Invoice expired/canceled"
        };

        const arr = invoice.description.split("-");
        let chainIdentifier: string;
        let address: string;
        if(arr.length>1) {
            chainIdentifier = arr[0];
            address = arr[1];
        } else {
            chainIdentifier = this.chains.default;
            address = invoice.description;
        }
        const {chainInterface} = this.getChain(chainIdentifier);
        if(!chainInterface.isValidAddress(address)) throw {
            _httpStatus: 200,
            code: 10001,
            msg: "Invoice expired/canceled"
        };

        switch(invoice.status) {
            case "canceled":
                throw {
                    _httpStatus: 200,
                    code: 10001,
                    msg: "Invoice expired/canceled"
                }
            case "confirmed":
                throw {
                    _httpStatus: 200,
                    code: 10002,
                    msg: "Invoice already paid"
                };
            case "unpaid":
                throw {
                    _httpStatus: 200,
                    code: 10003,
                    msg: "Invoice yet unpaid"
                };
            default:
                return invoice;
        }
    }

    startRestServer(restServer: Express) {

        restServer.use(this.path+"/createInvoice", serverParamDecoder(10*1000));
        restServer.post(this.path+"/createInvoice", expressHandlerWrapper(async (req: Request & {paramReader: IParamReader}, res: Response & {responseStream: ServerParamEncoder}) => {
            const metadata: {
                request: any,
                invoiceRequest?: any,
                invoiceResponse?: any,
                times: {[key: string]: number}
            } = {request: {}, times: {}};

            const chainIdentifier = req.query.chain as string ?? this.chains.default;
            const {swapContract, signer, chainInterface} = this.getChain(chainIdentifier);
            if(!swapContract.supportsInitWithoutClaimer) throw {
                code: 20299,
                msg: "Not supported for "+chainIdentifier
            };

            metadata.times.requestReceived = Date.now();

            /**
             * address: string              smart chain address of the recipient
             * paymentHash: string          payment hash of the to-be-created invoice
             * amount: string               amount (in sats) of the invoice
             * token: string                Desired token to swap
             * exactOut: boolean            Whether the swap should be an exact out instead of exact in swap
             * descriptionHash: string      Description hash of the invoice
             * gasAmount: string            Desired amount in gas token to also get
             * gasToken: string
             * claimerBounty: string        Desired amount to be left out as a claimer bounty
             */
            const parsedBody: FromBtcLnAutoRequestType = await req.paramReader.getParams({
                address: (val: string) => val!=null &&
                            typeof(val)==="string" &&
                            chainInterface.isValidAddress(val) ? val : null,
                paymentHash: (val: string) => val!=null &&
                            typeof(val)==="string" &&
                            val.length===64 &&
                            HEX_REGEX.test(val) ? val: null,
                amount: FieldTypeEnum.BigInt,
                token: (val: string) => val!=null &&
                        typeof(val)==="string" &&
                        this.isTokenSupported(chainIdentifier, val) ? val : null,
                descriptionHash: FieldTypeEnum.StringOptional,
                exactOut: FieldTypeEnum.BooleanOptional,
                gasToken: (val: string) => val!=null &&
                        typeof(val)==="string" &&
                        chainInterface.isValidToken(val) ? val : null,
                gasAmount: FieldTypeEnum.BigInt,
                claimerBounty: FieldTypeEnum.BigInt
            });
            if(parsedBody==null) throw {
                code: 20100,
                msg: "Invalid request body"
            };

            if(parsedBody.gasToken!==chainInterface.getNativeCurrencyAddress()) throw {
                code: 20290,
                msg: "Unsupported gas token"
            };

            if(parsedBody.gasAmount < 0) throw {
                code: 20291,
                msg: "Invalid gas amount, negative"
            };
            if(parsedBody.claimerBounty < 0) throw {
                code: 20292,
                msg: "Invalid claimer bounty, negative"
            };
            metadata.request = parsedBody;

            const requestedAmount = {input: !parsedBody.exactOut, amount: parsedBody.amount, token: parsedBody.token};
            const gasTokenAmount = {
                input: false,
                amount: parsedBody.gasAmount + parsedBody.claimerBounty,
                token: parsedBody.gasToken
            } as const;
            const request = {
                chainIdentifier,
                raw: req,
                parsed: parsedBody,
                metadata
            };
            const useToken = parsedBody.token;
            const gasToken = parsedBody.gasToken;

            //Check request params
            this.checkDescriptionHash(parsedBody.descriptionHash);
            const fees = await this.AmountAssertions.preCheckFromBtcAmounts(this.type, request, requestedAmount, gasTokenAmount);
            metadata.times.requestChecked = Date.now();

            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;
            const abortController = getAbortController(responseStream);

            //Pre-fetch data
            const {
                pricePrefetchPromise,
                gasTokenPricePrefetchPromise
            } = this.getFromBtcPricePrefetches(chainIdentifier, useToken, gasToken, abortController);
            const balancePrefetch: Promise<bigint> = this.getBalancePrefetch(chainIdentifier, useToken, abortController);
            const gasTokenBalancePrefetch: Promise<bigint> = gasTokenAmount.amount===0n || useToken===gasToken ?
                null : this.getBalancePrefetch(chainIdentifier, gasToken, abortController);
            const channelsPrefetch: Promise<LightningNetworkChannel[]> = this.LightningAssertions.getChannelsPrefetch(abortController);

            //Asynchronously send the node's public key to the client
            this.sendPublicKeyAsync(responseStream);

            //Check valid amount specified (min/max)
            let {
                amountBD,
                swapFee,
                swapFeeInToken,
                totalInToken,
                amountBDgas,
                gasSwapFee,
                gasSwapFeeInToken,
                totalInGasToken
            } = await this.AmountAssertions.checkFromBtcAmount(
                this.type, request,
                {...requestedAmount, pricePrefetch: pricePrefetchPromise},
                fees, abortController.signal,
                {...gasTokenAmount, pricePrefetch: gasTokenPricePrefetchPromise}
            );
            metadata.times.priceCalculated = Date.now();

            const totalBtcInput = amountBD + amountBDgas;

            //Check if we have enough funds to honor the request
            if(useToken===gasToken) {
                await this.checkBalance(totalInToken + totalInGasToken, balancePrefetch, abortController.signal);
            } else {
                await this.checkBalance(totalInToken, balancePrefetch, abortController.signal);
                await this.checkBalance(totalInGasToken, gasTokenBalancePrefetch, abortController.signal);
            }
            await this.LightningAssertions.checkInboundLiquidity(totalBtcInput, channelsPrefetch, abortController.signal);
            metadata.times.balanceChecked = Date.now();

            //Create swap
            const hodlInvoiceObj: HodlInvoiceInit = {
                description: chainIdentifier+"-"+parsedBody.address,
                cltvDelta:  Number(this.config.minCltv) + 5,
                expiresAt: Date.now()+(this.config.invoiceTimeoutSeconds*1000),
                id: parsedBody.paymentHash,
                mtokens: totalBtcInput * 1000n,
                descriptionHash: parsedBody.descriptionHash
            };
            metadata.invoiceRequest = hodlInvoiceObj;

            const hodlInvoice = await this.lightning.createHodlInvoice(hodlInvoiceObj);
            abortController.signal.throwIfAborted();
            metadata.times.invoiceCreated = Date.now();
            metadata.invoiceResponse = {...hodlInvoice};

            totalInGasToken -= parsedBody.claimerBounty;

            const createdSwap = new FromBtcLnAutoSwap(
                chainIdentifier,
                hodlInvoice.request,
                parsedBody.paymentHash,
                swapContract.getHashForHtlc(Buffer.from(parsedBody.paymentHash, "hex")).toString("hex"),
                hodlInvoice.mtokens,
                parsedBody.address,
                useToken,
                gasToken,
                totalInToken,
                totalInGasToken,
                swapFee,
                swapFeeInToken,
                gasSwapFee,
                gasSwapFeeInToken,
                parsedBody.claimerBounty
            );
            metadata.times.swapCreated = Date.now();

            createdSwap.metadata = metadata;

            await PluginManager.swapCreate(createdSwap);
            await this.saveSwapData(createdSwap);

            this.swapLogger.info(createdSwap, "REST: /createInvoice: Created swap invoice: "+hodlInvoice.request+" amount: "+totalBtcInput.toString(10));
            this.subscribeToInvoice(createdSwap);

            await responseStream.writeParamsAndEnd({
                code: 20000,
                msg: "Success",
                data: {
                    intermediaryKey: signer.getAddress(),
                    pr: hodlInvoice.request,

                    btcAmountSwap: amountBD.toString(10),
                    btcAmountGas: amountBDgas.toString(10),

                    total: totalInToken.toString(10),
                    totalGas: totalInGasToken.toString(10),

                    totalFeeBtc: (swapFee + gasSwapFee).toString(10),

                    swapFeeBtc: swapFee.toString(10),
                    swapFee: swapFeeInToken.toString(10),

                    gasSwapFeeBtc: gasSwapFee.toString(10),
                    gasSwapFee: gasSwapFeeInToken.toString(10),

                    claimerBounty: parsedBody.claimerBounty.toString(10)
                }
            });

        }));

        const getInvoiceStatus = expressHandlerWrapper(async (req, res) => {
            /**
             * paymentHash: string          payment hash of the invoice
             */
            const parsedBody = verifySchema({...req.body, ...req.query}, {
                paymentHash: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    val.length===64 &&
                    HEX_REGEX.test(val) ? val: null,
            });

            await this.checkInvoiceStatus(parsedBody.paymentHash);

            const swap: FromBtcLnAutoSwap = await this.storageManager.getData(parsedBody.paymentHash, null);
            if (swap==null) throw {
                _httpStatus: 200,
                code: 10001,
                msg: "Invoice expired/canceled"
            };

            if (
                swap.state === FromBtcLnAutoSwapState.RECEIVED ||
                swap.state === FromBtcLnAutoSwapState.TXS_SENT ||
                swap.state === FromBtcLnAutoSwapState.COMMITED
            ) {
                res.status(200).json({
                    code: 10000,
                    msg: "Success",
                    data: {
                        data: swap.data.serialize()
                    }
                });
            } else {
                res.status(200).json({
                    code: 10003,
                    msg: "Invoice yet unpaid"
                });
            }

        });

        restServer.post(this.path+"/getInvoiceStatus", getInvoiceStatus);
        restServer.get(this.path+"/getInvoiceStatus", getInvoiceStatus);

        this.logger.info("started at path: ", this.path);
    }

    async init() {
        await this.loadData(FromBtcLnAutoSwap);
        this.subscribeToEvents();
        await PluginManager.serviceInitialize(this);
    }

    getInfoData(): any {
        const mappedDict = {};
        for(let chainId in this.config.gasTokenMax) {
            mappedDict[chainId] = {
                gasToken: this.getChain(chainId).chainInterface.getNativeCurrencyAddress(),
                max: this.config.gasTokenMax[chainId].toString(10)
            };
        }
        return {
            minCltv: Number(this.config.minCltv),
            invoiceTimeoutSeconds: this.config.invoiceTimeoutSeconds,
            gasTokens: mappedDict
        };
    }

}

