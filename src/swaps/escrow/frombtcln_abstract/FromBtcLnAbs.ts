import {Express, Request, Response} from "express";
import {createHash, randomBytes} from "crypto";
import {FromBtcLnSwapAbs, FromBtcLnSwapState} from "./FromBtcLnSwapAbs";
import {MultichainData, SwapHandlerType} from "../../SwapHandler";
import {ISwapPrice} from "../../../prices/ISwapPrice";
import {
    BigIntBufferUtils,
    ChainSwapType,
    ClaimEvent,
    InitializeEvent,
    RefundEvent,
    SwapCommitStateType,
    SwapData
} from "@atomiqlabs/base";
import {expressHandlerWrapper, getAbortController, HEX_REGEX, isDefinedRuntimeError} from "../../../utils/Utils";
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

export type FromBtcLnConfig = FromBtcBaseConfig & {
    invoiceTimeoutSeconds?: number,
    minCltv: bigint,
    gracePeriod: bigint
}

export type FromBtcLnRequestType = {
    address: string,
    paymentHash: string,
    amount: bigint,
    token: string,
    descriptionHash?: string,
    exactOut?: boolean
}

/**
 * Swap handler handling from BTCLN swaps using submarine swaps
 */
export class FromBtcLnAbs extends FromBtcBaseSwapHandler<FromBtcLnSwapAbs, FromBtcLnSwapState> {
    readonly type = SwapHandlerType.FROM_BTCLN;
    readonly swapType = ChainSwapType.HTLC;

    readonly config: FromBtcLnConfig;
    readonly lightning: ILightningWallet;
    readonly LightningAssertions: LightningAssertions;

    constructor(
        storageDirectory: IIntermediaryStorage<FromBtcLnSwapAbs>,
        path: string,
        chains: MultichainData,
        lightning: ILightningWallet,
        swapPricing: ISwapPrice,
        config: FromBtcLnConfig
    ) {
        super(storageDirectory, path, chains, swapPricing, config);
        this.config = config;
        this.config.invoiceTimeoutSeconds = this.config.invoiceTimeoutSeconds || 90;
        this.lightning = lightning;
        this.LightningAssertions = new LightningAssertions(this.logger, lightning);
    }

    protected async processPastSwap(swap: FromBtcLnSwapAbs): Promise<"REFUND" | "SETTLE" | "CANCEL" | null> {
        const {swapContract, signer} = this.getChain(swap.chainIdentifier);
        if(swap.state===FromBtcLnSwapState.CREATED) {
            //Check if already paid
            const parsedPR = await this.lightning.parsePaymentRequest(swap.pr);
            const invoice = await this.lightning.getInvoice(parsedPR.id);

            const isBeingPaid = invoice.status==="held";
            if(!isBeingPaid) {
                //Not paid
                const isInvoiceExpired = parsedPR.expiryEpochMillis<Date.now();
                if(!isInvoiceExpired) return null;

                this.swapLogger.info(swap, "processPastSwap(state=CREATED): swap LN invoice expired, cancelling, invoice: "+swap.pr);
                await swap.setState(FromBtcLnSwapState.CANCELED);
                return "CANCEL";
            }

            //Adjust the state of the swap and expiry
            try {
                await this.htlcReceived(swap, invoice);
                //Result is either FromBtcLnSwapState.RECEIVED or FromBtcLnSwapState.CANCELED
            } catch (e) {
                this.swapLogger.error(swap, "processPastSwap(state=CREATED): htlcReceived error", e);
            }

            // @ts-ignore Previous call (htlcReceived) mutates the state of the swap, so this is valid
            if(swap.state===FromBtcLnSwapState.CANCELED) {
                this.swapLogger.info(swap, "processPastSwap(state=CREATED): invoice CANCELED after htlcReceived(), cancelling, invoice: "+swap.pr);
                return "CANCEL";
            }

            return null;
        }

        if(swap.state===FromBtcLnSwapState.RECEIVED || swap.state===FromBtcLnSwapState.COMMITED) {
            const onchainStatus = await swapContract.getCommitStatus(signer.getAddress(), swap.data);
            const state: FromBtcLnSwapState = swap.state as FromBtcLnSwapState;
            if(onchainStatus.type===SwapCommitStateType.PAID) {
                //Extract the swap secret
                if(state!==FromBtcLnSwapState.CLAIMED && state!==FromBtcLnSwapState.SETTLED) {
                    const secretHex = await onchainStatus.getClaimResult();
                    const secret: Buffer = Buffer.from(secretHex, "hex");
                    const paymentHash: Buffer = createHash("sha256").update(secret).digest();
                    const paymentHashHex = paymentHash.toString("hex");

                    if (swap.lnPaymentHash!==paymentHashHex) {
                        //TODO: Possibly fatal failure
                        this.swapLogger.error(swap, "processPastSwap(state=RECEIVED|COMMITED): onchainStatus=PAID, Invalid swap secret specified: "+secretHex+" for paymentHash: "+paymentHashHex);
                        return null;
                    }

                    swap.secret = secretHex;
                    await swap.setState(FromBtcLnSwapState.CLAIMED);
                    await this.saveSwapData(swap);

                    this.swapLogger.warn(swap, "processPastSwap(state=RECEIVED|COMMITED): swap settled (detected from processPastSwap), invoice: "+swap.pr);

                    return "SETTLE";
                }
                return null;
            }
            if(onchainStatus.type===SwapCommitStateType.COMMITED) {
                if(state===FromBtcLnSwapState.RECEIVED) {
                    await swap.setState(FromBtcLnSwapState.COMMITED);
                    await this.saveSwapData(swap);

                    this.swapLogger.info(swap, "processPastSwap(state=RECEIVED|COMMITED): swap committed (detected from processPastSwap), invoice: "+swap.pr);
                }
                return null;
            }
            if(onchainStatus.type===SwapCommitStateType.NOT_COMMITED || onchainStatus.type===SwapCommitStateType.EXPIRED) {
                if(swap.state===FromBtcLnSwapState.RECEIVED) {
                    const isAuthorizationExpired = await swapContract.isInitAuthorizationExpired(swap.data, swap);
                    if(isAuthorizationExpired) {
                        this.swapLogger.info(swap, "processPastSwap(state=RECEIVED|COMMITED): swap not committed before authorization expiry, cancelling the LN invoice, invoice: "+swap.pr);
                        await swap.setState(FromBtcLnSwapState.CANCELED);
                        return "CANCEL";
                    }
                } else {
                    if(await swapContract.isExpired(signer.getAddress(), swap.data)) {
                        this.swapLogger.info(swap, "processPastSwap(state=RECEIVED|COMMITED): swap timed out, refunding to self, invoice: "+swap.pr);
                        return "REFUND";
                    }
                }
            }
            if(onchainStatus.type===SwapCommitStateType.REFUNDABLE) {
                this.swapLogger.info(swap, "processPastSwap(state=RECEIVED|COMMITED): swap timed out, refunding to self, invoice: "+swap.pr);
                return "REFUND";
            }
        }

        if(swap.state===FromBtcLnSwapState.CLAIMED) return "SETTLE";
        if(swap.state===FromBtcLnSwapState.CANCELED) return "CANCEL";
    }

    protected async refundSwaps(refundSwaps: FromBtcLnSwapAbs[]) {
        for(let refundSwap of refundSwaps) {
            const {swapContract, signer} = this.getChain(refundSwap.chainIdentifier);
            const unlock = refundSwap.lock(swapContract.refundTimeout);
            if(unlock==null) continue;

            this.swapLogger.debug(refundSwap, "refundSwaps(): initiate refund of swap");
            await swapContract.refund(signer, refundSwap.data, true, false, {waitForConfirmation: true});
            this.swapLogger.info(refundSwap, "refundsSwaps(): swap refunded, invoice: "+refundSwap.pr);

            await refundSwap.setState(FromBtcLnSwapState.REFUNDED);
            unlock();
        }
    }

    protected async cancelInvoices(swaps: FromBtcLnSwapAbs[]) {
        for(let swap of swaps) {
            //Refund
            const paymentHash = swap.lnPaymentHash;
            try {
                await this.lightning.cancelHodlInvoice(paymentHash);
                this.swapLogger.info(swap, "cancelInvoices(): invoice cancelled!");
                await this.removeSwapData(swap);
            } catch (e) {
                this.swapLogger.error(swap, "cancelInvoices(): cannot cancel hodl invoice id", e);
            }
        }
    }

    protected async settleInvoices(swaps: FromBtcLnSwapAbs[]) {
        for(let swap of swaps) {
            try {
                await this.lightning.settleHodlInvoice(swap.secret);
                if(swap.metadata!=null) swap.metadata.times.htlcSettled = Date.now();
                await this.removeSwapData(swap, FromBtcLnSwapState.SETTLED);

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

        const settleInvoices: FromBtcLnSwapAbs[] = [];
        const cancelInvoices: FromBtcLnSwapAbs[] = [];
        const refundSwaps: FromBtcLnSwapAbs[] = [];

        const queriedData = await this.storageManager.query([
            {
                key: "state",
                value: [
                    FromBtcLnSwapState.CREATED,
                    FromBtcLnSwapState.RECEIVED,
                    FromBtcLnSwapState.COMMITED,
                    FromBtcLnSwapState.CLAIMED,
                    FromBtcLnSwapState.CANCELED,
                ]
            }
        ]);

        for(let {obj: swap} of queriedData) {
            switch(await this.processPastSwap(swap)) {
                case "CANCEL":
                    cancelInvoices.push(swap);
                    break;
                case "SETTLE":
                    settleInvoices.push(swap);
                    break;
                case "REFUND":
                    refundSwaps.push(swap);
                    break;
            }
        }

        await this.refundSwaps(refundSwaps);
        await this.cancelInvoices(cancelInvoices);
        await this.settleInvoices(settleInvoices);
    }

    protected async processInitializeEvent(chainIdentifier: string, savedSwap: FromBtcLnSwapAbs, event: InitializeEvent<SwapData>): Promise<void> {
        this.swapLogger.info(savedSwap, "SC: InitializeEvent: HTLC initialized by the client, invoice: "+savedSwap.pr);

        if(savedSwap.state===FromBtcLnSwapState.RECEIVED) {
            await savedSwap.setState(FromBtcLnSwapState.COMMITED);
            await this.saveSwapData(savedSwap);
        }
    }

    protected async processClaimEvent(chainIdentifier: string, savedSwap: FromBtcLnSwapAbs, event: ClaimEvent<SwapData>): Promise<void> {
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
            await this.removeSwapData(savedSwap, FromBtcLnSwapState.SETTLED);
        } catch (e) {
            this.swapLogger.error(savedSwap, "SC: ClaimEvent: cannot settle invoice", e);
            savedSwap.secret = secretHex;
            await savedSwap.setState(FromBtcLnSwapState.CLAIMED);
            await this.saveSwapData(savedSwap);
        }

    }

    protected async processRefundEvent(chainIdentifier: string, savedSwap: FromBtcLnSwapAbs, event: RefundEvent<SwapData>): Promise<void> {
        this.swapLogger.info(savedSwap, "SC: RefundEvent: swap refunded to us, invoice: "+savedSwap.pr);

        try {
            await this.lightning.cancelHodlInvoice(savedSwap.lnPaymentHash);
            this.swapLogger.info(savedSwap, "SC: RefundEvent: invoice cancelled");
            await this.removeSwapData(savedSwap, FromBtcLnSwapState.REFUNDED);
        } catch (e) {
            this.swapLogger.error(savedSwap, "SC: RefundEvent: cannot cancel invoice", e);
            await savedSwap.setState(FromBtcLnSwapState.CANCELED);
            // await PluginManager.swapStateChange(savedSwap);
            await this.saveSwapData(savedSwap);
        }
    }

    /**
     * Called when lightning HTLC is received, also signs an init transaction on the smart chain side, expiry of the
     *  smart chain authorization starts ticking as soon as this HTLC is received
     *
     * @param invoiceData
     * @param invoice
     */
    private async htlcReceived(invoiceData: FromBtcLnSwapAbs, invoice: any) {
        this.swapLogger.debug(invoiceData, "htlcReceived(): invoice: ", invoice);
        if(invoiceData.metadata!=null) invoiceData.metadata.times.htlcReceived = Date.now();

        const useToken = invoiceData.token;
        const escrowAmount: bigint = invoiceData.totalTokens;

        //Create abort controller for parallel fetches
        const abortController = new AbortController();

        //Pre-fetch data
        const balancePrefetch: Promise<bigint> = this.getBalancePrefetch(invoiceData.chainIdentifier, useToken, abortController);
        const blockheightPrefetch = this.getBlockheightPrefetch(abortController);
        const signDataPrefetchPromise: Promise<any> = this.getSignDataPrefetch(invoiceData.chainIdentifier, abortController);

        let expiryTimeout: bigint;
        try {
            //Check if we have enough liquidity to proceed
            await this.checkBalance(escrowAmount, balancePrefetch, abortController.signal);
            if(invoiceData.metadata!=null) invoiceData.metadata.times.htlcBalanceChecked = Date.now();

            //Check if HTLC expiry is long enough
            expiryTimeout = await this.checkHtlcExpiry(invoice, blockheightPrefetch, abortController.signal);
            if(invoiceData.metadata!=null) invoiceData.metadata.times.htlcTimeoutCalculated = Date.now();
        } catch (e) {
            if(!abortController.signal.aborted) {
                if(invoiceData.state===FromBtcLnSwapState.CREATED) await this.cancelSwapAndInvoice(invoiceData);
            }
            throw e;
        }

        const {swapContract, signer} = this.getChain(invoiceData.chainIdentifier);

        //Create real swap data
        const payInvoiceObject: SwapData = await swapContract.createSwapData(
            ChainSwapType.HTLC,
            signer.getAddress(),
            invoiceData.claimer,
            useToken,
            escrowAmount,
            invoiceData.claimHash,
            0n,
            BigInt(Math.floor(Date.now() / 1000)) + expiryTimeout,
            false,
            true,
            invoiceData.securityDeposit,
            0n,
            invoiceData.depositToken
        );
        abortController.signal.throwIfAborted();
        if(invoiceData.metadata!=null) invoiceData.metadata.times.htlcSwapCreated = Date.now();

        //Sign swap data
        const sigData = await swapContract.getInitSignature(
            signer,
            payInvoiceObject,
            this.getInitAuthorizationTimeout(invoiceData.chainIdentifier),
            signDataPrefetchPromise==null ? null : await signDataPrefetchPromise,
            invoiceData.feeRate
        );
        //No need to check abortController anymore since all pending promises are resolved by now
        if(invoiceData.metadata!=null) invoiceData.metadata.times.htlcSwapSigned = Date.now();

        //Important to prevent race condition and issuing 2 signed init messages at the same time
        if(invoiceData.state===FromBtcLnSwapState.CREATED) {
            invoiceData.data = payInvoiceObject;
            invoiceData.prefix = sigData.prefix;
            invoiceData.timeout = sigData.timeout;
            invoiceData.signature = sigData.signature;

            //Setting the state variable is done outside the promise, so is done synchronously
            await invoiceData.setState(FromBtcLnSwapState.RECEIVED);

            await this.saveSwapData(invoiceData);
            return;
        }
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
     * Starts LN channels pre-fetch
     *
     * @param abortController
     */
    private getBlockheightPrefetch(abortController: AbortController): Promise<number> {
        return this.lightning.getBlockheight().catch(e => {
            this.logger.error("getBlockheightPrefetch(): error", e);
            abortController.abort(e);
            return null;
        });
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
    private getInvoicePaymentsTimeout(invoice: LightningNetworkInvoice) {
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
     * @param blockheightPrefetch
     * @param signal
     * @throws {DefinedRuntimeError} Will throw if HTLC expires too soon and therefore cannot be processed
     * @returns expiry timeout in seconds
     */
    private async checkHtlcExpiry(invoice: LightningNetworkInvoice, blockheightPrefetch: Promise<number>, signal: AbortSignal): Promise<bigint> {
        const timeout: number = this.getInvoicePaymentsTimeout(invoice);
        const current_block_height = await blockheightPrefetch;
        signal.throwIfAborted();

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
    private async cancelSwapAndInvoice(invoiceData: FromBtcLnSwapAbs): Promise<void> {
        if(invoiceData.state!==FromBtcLnSwapState.CREATED) return;
        await invoiceData.setState(FromBtcLnSwapState.CANCELED);
        await this.lightning.cancelHodlInvoice(invoiceData.lnPaymentHash);
        await this.removeSwapData(invoiceData);
        this.swapLogger.info(invoiceData, "cancelSwapAndInvoice(): swap removed & invoice cancelled, invoice: ", invoiceData.pr);
    };

    private getDummySwapData(chainIdentifier: string, useToken: string, address: string, paymentHash: string) {
        const {swapContract, signer} = this.getChain(chainIdentifier);
        const dummyAmount = BigInt(Math.floor(Math.random() * 0x1000000));
        return swapContract.createSwapData(
            ChainSwapType.HTLC,
            signer.getAddress(),
            address,
            useToken,
            dummyAmount,
            swapContract.getHashForHtlc(Buffer.from(paymentHash, "hex")).toString("hex"),
            BigIntBufferUtils.fromBuffer(randomBytes(8)),
            BigInt(Math.floor(Date.now()/1000)),
            false,
            true,
            BigInt(Math.floor(Math.random() * 0x10000)),
            0n
        );
    }

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
            const depositToken = req.query.depositToken as string ?? chainInterface.getNativeCurrencyAddress();
            this.checkAllowedDepositToken(chainIdentifier, depositToken);

            metadata.times.requestReceived = Date.now();


            /**
             * address: string              solana address of the recipient
             * paymentHash: string          payment hash of the to-be-created invoice
             * amount: string               amount (in sats) of the invoice
             * token: string                Desired token to swap
             * exactOut: boolean            Whether the swap should be an exact out instead of exact in swap
             * descriptionHash: string      Description hash of the invoice
             *
             *Sent later:
             * feeRate: string              Fee rate to use for the init signature
             */
            const parsedBody: FromBtcLnRequestType = await req.paramReader.getParams({
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
                exactOut: FieldTypeEnum.BooleanOptional
            });
            if(parsedBody==null) throw {
                code: 20100,
                msg: "Invalid request body"
            };
            metadata.request = parsedBody;

            const requestedAmount = {input: !parsedBody.exactOut, amount: parsedBody.amount, token: parsedBody.token};
            const request = {
                chainIdentifier,
                raw: req,
                parsed: parsedBody,
                metadata
            };
            const useToken = parsedBody.token;

            //Check request params
            this.checkDescriptionHash(parsedBody.descriptionHash);
            const fees = await this.AmountAssertions.preCheckFromBtcAmounts(this.type, request, requestedAmount);
            metadata.times.requestChecked = Date.now();

            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;
            const abortController = getAbortController(responseStream);

            //Pre-fetch data
            const {
                pricePrefetchPromise,
                gasTokenPricePrefetchPromise,
                depositTokenPricePrefetchPromise
            } = this.getFromBtcPricePrefetches(chainIdentifier, useToken, depositToken, abortController);
            const balancePrefetch: Promise<bigint> = this.getBalancePrefetch(chainIdentifier, useToken, abortController);
            const channelsPrefetch: Promise<LightningNetworkChannel[]> = this.LightningAssertions.getChannelsPrefetch(abortController);

            const dummySwapData = await this.getDummySwapData(chainIdentifier, useToken, parsedBody.address, parsedBody.paymentHash);
            abortController.signal.throwIfAborted();
            const baseSDPromise: Promise<bigint> = this.getBaseSecurityDepositPrefetch(
                chainIdentifier, dummySwapData, depositToken,
                gasTokenPricePrefetchPromise, depositTokenPricePrefetchPromise,
                abortController
            );

            //Asynchronously send the node's public key to the client
            this.sendPublicKeyAsync(responseStream);

            //Check valid amount specified (min/max)
            const {
                amountBD,
                swapFee,
                swapFeeInToken,
                totalInToken,
                securityDepositApyPPM,
                securityDepositBaseMultiplierPPM
            } = await this.AmountAssertions.checkFromBtcAmount(this.type, request, {...requestedAmount, pricePrefetch: pricePrefetchPromise}, fees, abortController.signal);
            metadata.times.priceCalculated = Date.now();

            if(securityDepositApyPPM!=null) fees.securityDepositApyPPM = securityDepositApyPPM;
            if(securityDepositBaseMultiplierPPM!=null) fees.securityDepositBaseMultiplierPPM = securityDepositBaseMultiplierPPM;

            //Check if we have enough funds to honor the request
            await this.checkBalance(totalInToken, balancePrefetch, abortController.signal)
            await this.LightningAssertions.checkInboundLiquidity(amountBD, channelsPrefetch, abortController.signal);
            metadata.times.balanceChecked = Date.now();

            //Create swap
            const hodlInvoiceObj: HodlInvoiceInit = {
                description: chainIdentifier+"-"+parsedBody.address,
                cltvDelta:  Number(this.config.minCltv) + 5,
                expiresAt: Date.now()+(this.config.invoiceTimeoutSeconds*1000),
                id: parsedBody.paymentHash,
                mtokens: amountBD * 1000n,
                descriptionHash: parsedBody.descriptionHash
            };
            metadata.invoiceRequest = hodlInvoiceObj;

            const hodlInvoice = await this.lightning.createHodlInvoice(hodlInvoiceObj);
            abortController.signal.throwIfAborted();
            metadata.times.invoiceCreated = Date.now();
            metadata.invoiceResponse = {...hodlInvoice};

            //Pre-compute the security deposit
            const expiryTimeout = (this.config.minCltv * this.config.bitcoinBlocktime / this.config.safetyFactor) - this.config.gracePeriod;
            const totalSecurityDeposit = await this.getSecurityDeposit(
                chainIdentifier, amountBD, swapFee, expiryTimeout,
                baseSDPromise, depositToken, depositTokenPricePrefetchPromise, fees,
                abortController.signal, metadata
            );
            metadata.times.securityDepositCalculated = Date.now();

            const createdSwap = new FromBtcLnSwapAbs(
                chainIdentifier,
                hodlInvoice.request,
                parsedBody.paymentHash,
                hodlInvoice.mtokens,
                swapFee,
                swapFeeInToken,
                parsedBody.address,
                useToken,
                totalInToken,
                swapContract.getHashForHtlc(Buffer.from(parsedBody.paymentHash, "hex")).toString("hex"),
                totalSecurityDeposit,
                depositToken
            );
            metadata.times.swapCreated = Date.now();

            createdSwap.metadata = metadata;

            //Save the desired fee rate for the signature
            const feeRateObj = await req.paramReader.getParams({
                feeRate: FieldTypeEnum.String
            }).catch(() => null);
            abortController.signal.throwIfAborted();
            createdSwap.feeRate = feeRateObj?.feeRate!=null && typeof(feeRateObj.feeRate)==="string" ? feeRateObj.feeRate : null;

            await PluginManager.swapCreate(createdSwap);
            await this.saveSwapData(createdSwap);

            this.swapLogger.info(createdSwap, "REST: /createInvoice: Created swap invoice: "+hodlInvoice.request+" amount: "+amountBD.toString(10));

            await responseStream.writeParamsAndEnd({
                code: 20000,
                msg: "Success",
                data: {
                    pr: hodlInvoice.request,
                    swapFee: swapFeeInToken.toString(10),
                    total: totalInToken.toString(10),
                    intermediaryKey: signer.getAddress(),
                    securityDeposit: totalSecurityDeposit.toString(10)
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

            res.status(200).json({
                code: 10000,
                msg: "Success"
            });

        });

        restServer.post(this.path+"/getInvoiceStatus", getInvoiceStatus);
        restServer.get(this.path+"/getInvoiceStatus", getInvoiceStatus);

        const getInvoicePaymentAuth = expressHandlerWrapper(async (req, res) => {
            /**
             * paymentHash: string          payment hash of the invoice
             */
            const parsedBody = verifySchema({...req.body, ...req.query}, {
                paymentHash: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    val.length===64 &&
                    HEX_REGEX.test(val) ? val: null,
            });

            const invoice: any =  await this.checkInvoiceStatus(parsedBody.paymentHash);

            const swap: FromBtcLnSwapAbs = await this.storageManager.getData(parsedBody.paymentHash, null);
            if (swap==null) throw {
                _httpStatus: 200,
                code: 10001,
                msg: "Invoice expired/canceled"
            };

            const {swapContract, signer} = this.getChain(swap.chainIdentifier);

            if (swap.state === FromBtcLnSwapState.RECEIVED) {
                if (await swapContract.isInitAuthorizationExpired(swap.data, swap)) throw {
                    _httpStatus: 200,
                    code: 10001,
                    msg: "Invoice expired/canceled"
                }
            }

            if (swap.state === FromBtcLnSwapState.CREATED) {
                try {
                    await this.htlcReceived(swap, invoice);
                } catch (e) {
                    if(isDefinedRuntimeError(e)) e._httpStatus = 200;
                    throw e;
                }
                this.swapLogger.info(swap, "REST: /getInvoicePaymentAuth: swap processed through htlcReceived, invoice: "+swap.pr);
            }

            if (swap.state === FromBtcLnSwapState.CANCELED) throw {
                _httpStatus: 200,
                code: 10001,
                msg: "Invoice expired/canceled"
            };

            if (swap.state === FromBtcLnSwapState.COMMITED) throw {
                _httpStatus: 200,
                code: 10004,
                msg: "Invoice already committed"
            };

            res.status(200).json({
                code: 10000,
                msg: "Success",
                data: {
                    address: signer.getAddress(),
                    data: swap.data.serialize(),
                    prefix: swap.prefix,
                    timeout: swap.timeout,
                    signature: swap.signature
                }
            });
        });

        restServer.post(this.path+"/getInvoicePaymentAuth", getInvoicePaymentAuth);
        restServer.get(this.path+"/getInvoicePaymentAuth", getInvoicePaymentAuth);

        this.logger.info("started at path: ", this.path);
    }

    async init() {
        await this.loadData(FromBtcLnSwapAbs);
        //Check if all swaps contain a valid amount
        for(let {obj: swap} of await this.storageManager.query([])) {
            if(swap.amount==null) {
                const parsedPR = await this.lightning.parsePaymentRequest(swap.pr);
                swap.amount = (parsedPR.mtokens + 999n) / 1000n;
            }
        }
        this.subscribeToEvents();
        await PluginManager.serviceInitialize(this);
    }

    getInfoData(): any {
        return {
            minCltv: Number(this.config.minCltv)
        };
    }

}

