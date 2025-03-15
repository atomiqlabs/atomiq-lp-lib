import {Express, Request, Response} from "express";
import {createHash, randomBytes} from "crypto";
import {FromBtcLnTrustedSwap, FromBtcLnTrustedSwapState} from "./FromBtcLnTrustedSwap";
import {FromBtcBaseConfig} from "../../escrow/FromBtcBaseSwapHandler";
import {ISwapPrice} from "../../../prices/ISwapPrice";
import {MultichainData, SwapHandler, SwapHandlerType} from "../../SwapHandler";
import {IIntermediaryStorage} from "../../../storage/IIntermediaryStorage";
import {expressHandlerWrapper, getAbortController, HEX_REGEX} from "../../../utils/Utils";
import {IParamReader} from "../../../utils/paramcoders/IParamReader";
import {ServerParamEncoder} from "../../../utils/paramcoders/server/ServerParamEncoder";
import {FieldTypeEnum, verifySchema} from "../../../utils/paramcoders/SchemaVerifier";
import {PluginManager} from "../../../plugins/PluginManager";
import {
    HodlInvoiceInit,
    ILightningWallet,
    LightningNetworkChannel,
    LightningNetworkInvoice
} from "../../../wallets/ILightningWallet";
import {FromBtcAmountAssertions} from "../../assertions/FromBtcAmountAssertions";
import { LightningAssertions } from "../../assertions/LightningAssertions";

export type SwapForGasServerConfig = FromBtcBaseConfig & {
    minCltv: bigint,

    invoiceTimeoutSeconds?: number
}

export type FromBtcLnTrustedRequestType = {
    address: string,
    amount: bigint,
    exactIn?: boolean,
    token?: string
};

/**
 * Swap handler handling from BTCLN swaps using submarine swaps
 */
export class FromBtcLnTrusted extends SwapHandler<FromBtcLnTrustedSwap, FromBtcLnTrustedSwapState> {
    readonly type: SwapHandlerType = SwapHandlerType.FROM_BTCLN_TRUSTED;

    activeSubscriptions: Map<string, AbortController> = new Map<string, AbortController>();
    processedTxIds: Map<string, string> = new Map<string, string>();

    readonly config: SwapForGasServerConfig;
    readonly lightning: ILightningWallet;
    readonly LightningAssertions: LightningAssertions;
    readonly AmountAssertions: FromBtcAmountAssertions;

    constructor(
        storageDirectory: IIntermediaryStorage<FromBtcLnTrustedSwap>,
        path: string,
        chains: MultichainData,
        lightning: ILightningWallet,
        swapPricing: ISwapPrice,
        config: SwapForGasServerConfig
    ) {
        super(storageDirectory, path, chains, swapPricing);
        this.lightning = lightning;
        this.LightningAssertions = new LightningAssertions(this.logger, lightning);
        this.AmountAssertions = new FromBtcAmountAssertions(config, swapPricing);
        this.config = config;
        this.config.invoiceTimeoutSeconds = this.config.invoiceTimeoutSeconds || 90;
    }

    /**
     * Unsubscribe from the pending lightning network invoice
     *
     * @param paymentHash
     * @private
     */
    private unsubscribeInvoice(paymentHash: string): boolean {
        const controller = this.activeSubscriptions.get(paymentHash);
        if(controller==null) return false;
        controller.abort("Unsubscribed");
        this.activeSubscriptions.delete(paymentHash);
        return true;
    }

    /**
     * Subscribe to a pending lightning network invoice
     *
     * @param invoiceData
     */
    private subscribeToInvoice(invoiceData: FromBtcLnTrustedSwap) {
        const hash = invoiceData.getIdentifierHash();

        //Already subscribed
        if(this.activeSubscriptions.has(hash)) return;

        const abortController = new AbortController();
        this.lightning.waitForInvoice(hash, abortController.signal).then(invoice => {
            this.swapLogger.debug(invoiceData, "subscribeToInvoice(): invoice_updated: ", invoice);
            this.htlcReceived(invoiceData, invoice).catch(e => console.error(e));
            this.activeSubscriptions.delete(hash);
        });

        this.swapLogger.debug(invoiceData, "subscribeToInvoice(): Subscribed to invoice payment");
        this.activeSubscriptions.set(hash, abortController);
    }

    /**
     *
     * @param swap
     * @protected
     * @returns {Promise<boolean>} Whether the invoice should be cancelled
     */
    protected async processPastSwap(swap: FromBtcLnTrustedSwap): Promise<boolean> {
        if(swap.state===FromBtcLnTrustedSwapState.CANCELED) return true;
        if(swap.state===FromBtcLnTrustedSwapState.REFUNDED) return true;

        const parsedPR = await this.lightning.parsePaymentRequest(swap.pr);
        const invoice = await this.lightning.getInvoice(parsedPR.id);

        switch (invoice.status) {
            case "held":
                try {
                    await this.htlcReceived(swap, invoice);
                    //Result is either FromBtcLnTrustedSwapState.RECEIVED or FromBtcLnTrustedSwapState.CANCELED
                } catch (e) {
                    console.error(e);
                }
                return false;
            case "confirmed":
                return false;
            default:
                const isInvoiceExpired = parsedPR.expiryEpochMillis<Date.now();
                if(isInvoiceExpired) {
                    await swap.setState(FromBtcLnTrustedSwapState.CANCELED);
                    return true;
                }
                this.subscribeToInvoice(swap);
                return false;
        }
    }

    protected async cancelInvoices(swaps: FromBtcLnTrustedSwap[]) {
        for(let swap of swaps) {
            //Cancel invoices
            try {
                const paymentHash = swap.getIdentifierHash();
                await this.lightning.cancelHodlInvoice(paymentHash);
                this.unsubscribeInvoice(paymentHash);
                this.swapLogger.info(swap, "cancelInvoices(): invoice cancelled!");
                await this.removeSwapData(swap);
            } catch (e) {
                this.swapLogger.error(swap, "cancelInvoices(): cannot cancel hodl invoice id", e);
            }
        }
    }

    /**
     * Checks past swaps, refunds and deletes ones that are already expired.
     */
    protected async processPastSwaps(): Promise<void> {
        const cancelInvoices: FromBtcLnTrustedSwap[] = [];

        const queriedData = await this.storageManager.query([
            {
                key: "state",
                value: [
                    FromBtcLnTrustedSwapState.CREATED,
                    FromBtcLnTrustedSwapState.RECEIVED,
                    FromBtcLnTrustedSwapState.SENT,
                    FromBtcLnTrustedSwapState.CONFIRMED,
                    FromBtcLnTrustedSwapState.CANCELED,
                    FromBtcLnTrustedSwapState.REFUNDED,
                ]
            }
        ]);

        for(let {obj: swap} of queriedData) {
            if(await this.processPastSwap(swap)) cancelInvoices.push(swap);
        }

        await this.cancelInvoices(cancelInvoices);
    }

    private async cancelSwapAndInvoice(swap: FromBtcLnTrustedSwap): Promise<void> {
        if(swap.state!==FromBtcLnTrustedSwapState.RECEIVED) return;
        await swap.setState(FromBtcLnTrustedSwapState.CANCELED);
        const paymentHash = swap.getIdentifierHash();
        await this.lightning.cancelHodlInvoice(paymentHash);
        this.unsubscribeInvoice(paymentHash);
        await this.removeSwapData(swap);
        this.swapLogger.info(swap, "cancelSwapAndInvoice(): swap removed & invoice cancelled, invoice: ", swap.pr);
    }

    /**
     * Saves the state of received HTLC of the lightning payment
     *
     * @param invoiceData
     * @param invoice
     */
    private async htlcReceived(invoiceData: FromBtcLnTrustedSwap, invoice: { id: string }) {

        const { signer, chainInterface} = this.getChain(invoiceData.chainIdentifier);

        //Important to prevent race condition and issuing 2 signed init messages at the same time
        if(invoiceData.state===FromBtcLnTrustedSwapState.CREATED) {
            if(invoiceData.metadata!=null) invoiceData.metadata.times.htlcReceived = Date.now();
            await invoiceData.setState(FromBtcLnTrustedSwapState.RECEIVED);
            await this.storageManager.saveData(invoice.id, null, invoiceData);
        }

        if(invoiceData.state===FromBtcLnTrustedSwapState.RECEIVED) {
            const balance: Promise<bigint> = chainInterface.getBalance(signer.getAddress(), invoiceData.token);
            try {
                await this.checkBalance(invoiceData.output, balance, null);
                if(invoiceData.metadata!=null) invoiceData.metadata.times.htlcBalanceChecked = Date.now();
            } catch (e) {
                await this.cancelSwapAndInvoice(invoiceData);
                throw e;
            }

            if(invoiceData.state!==FromBtcLnTrustedSwapState.RECEIVED) return;

            const txns = await chainInterface.txsTransfer(signer.getAddress(), invoiceData.token, invoiceData.output, invoiceData.dstAddress);

            let unlock = invoiceData.lock(Infinity);
            if(unlock==null) return;

            const result = await chainInterface.sendAndConfirm(signer, txns, true, null, false, async (txId: string, rawTx: string) => {
                invoiceData.txIds = {init: txId};
                invoiceData.scRawTx = rawTx;
                if(invoiceData.state===FromBtcLnTrustedSwapState.RECEIVED) {
                    await invoiceData.setState(FromBtcLnTrustedSwapState.SENT);
                    await this.storageManager.saveData(invoice.id, null, invoiceData);
                }
            }).catch(e => console.error(e));

            if(result==null) {
                //Cancel invoice
                await invoiceData.setState(FromBtcLnTrustedSwapState.REFUNDED);
                await this.storageManager.saveData(invoice.id, null, invoiceData);
                await this.lightning.cancelHodlInvoice(invoice.id);
                this.unsubscribeInvoice(invoice.id);
                await this.removeSwapData(invoice.id, null);
                this.swapLogger.info(invoiceData, "htlcReceived(): transaction sending failed, refunding lightning: ", invoiceData.pr);
                throw {
                    code: 20002,
                    msg: "Transaction sending failed"
                };
            } else {
                //Successfully paid
                await invoiceData.setState(FromBtcLnTrustedSwapState.CONFIRMED);
                await this.storageManager.saveData(invoice.id, null, invoiceData);
            }

            unlock();
            unlock = null;
        }

        if(invoiceData.state===FromBtcLnTrustedSwapState.SENT) {
            if(invoiceData.isLocked()) return;

            const txStatus = await chainInterface.getTxStatus(invoiceData.scRawTx);
            if(txStatus==="not_found") {
                //Retry
                invoiceData.txIds = {init: null};
                invoiceData.scRawTx = null;
                await invoiceData.setState(FromBtcLnTrustedSwapState.RECEIVED);
                await this.storageManager.saveData(invoice.id, null, invoiceData);
            }
            if(txStatus==="reverted") {
                //Cancel invoice
                await invoiceData.setState(FromBtcLnTrustedSwapState.REFUNDED);
                await this.storageManager.saveData(invoice.id, null, invoiceData);
                await this.lightning.cancelHodlInvoice(invoice.id);
                this.unsubscribeInvoice(invoice.id);
                await this.removeSwapData(invoice.id, null);
                this.swapLogger.info(invoiceData, "htlcReceived(): transaction reverted, refunding lightning: ", invoiceData.pr);
                throw {
                    code: 20002,
                    msg: "Transaction reverted"
                };
            }
            if(txStatus==="success") {
                //Successfully paid
                await invoiceData.setState(FromBtcLnTrustedSwapState.CONFIRMED);
                await this.storageManager.saveData(invoice.id, null, invoiceData);
            }
        }

        if(invoiceData.state===FromBtcLnTrustedSwapState.CONFIRMED) {
            await this.lightning.settleHodlInvoice(invoiceData.secret);

            if(invoiceData.metadata!=null) invoiceData.metadata.times.htlcSettled = Date.now();

            const paymentHash = invoiceData.getIdentifierHash();
            this.processedTxIds.set(paymentHash, invoiceData.txIds.init);
            await invoiceData.setState(FromBtcLnTrustedSwapState.SETTLED);

            this.unsubscribeInvoice(paymentHash);
            this.swapLogger.info(invoiceData, "htlcReceived(): invoice settled, invoice: "+invoiceData.pr+" scTxId: "+invoiceData.txIds.init);
            await this.removeSwapData(invoiceData);
        }
    }

    /**
     *
     * Checks if the lightning invoice is in HELD state (htlcs received but yet unclaimed)
     *
     * @param paymentHash
     * @throws {DefinedRuntimeError} Will throw if the lightning invoice is not found, or if it isn't in the HELD state
     * @returns the fetched lightning invoice
     */
    private async checkInvoiceStatus(paymentHash: string): Promise<LightningNetworkInvoice> {
        const invoice = await this.lightning.getInvoice(paymentHash);

        const isInvoiceFound = invoice!=null;
        if (!isInvoiceFound) throw {
            _httpStatus: 200,
            code: 10001,
            msg: "Invoice expired/canceled"
        }

        const arr = invoice.description.split("-");
        let chainIdentifier: string;
        let address: string;
        if(arr.length>2 && arr[1]==="GAS") {
            chainIdentifier = arr[0];
            address = arr[2];
        } else {
            chainIdentifier = this.chains.default;
            address = invoice.description;
        }
        const { chainInterface} = this.getChain(chainIdentifier);
        if(!chainInterface.isValidAddress(address)) throw {
            _httpStatus: 200,
            code: 10001,
            msg: "Invoice expired/canceled"
        };

        switch(invoice.status) {
            case "held":
                return invoice;
            case "canceled":
                throw {
                    _httpStatus: 200,
                    code: 10001,
                    msg: "Invoice expired/canceled"
                };
            case "confirmed":
                throw {
                    _httpStatus: 200,
                    code: 10000,
                    msg: "Invoice already paid",
                    data: {
                        txId: this.processedTxIds.get(paymentHash)
                    }
                };
            case "unpaid":
                throw {
                    _httpStatus: 200,
                    code: 10010,
                    msg: "Invoice yet unpaid"
                };
            default:
                throw new Error("Lightning invoice invalid state!");
        }
    }

    startRestServer(restServer: Express) {

        const createInvoice = expressHandlerWrapper(async (req: Request & {paramReader: IParamReader}, res: Response & {responseStream: ServerParamEncoder}) => {
            const metadata: {
                request: any,
                invoiceRequest?: any,
                invoiceResponse?: any,
                times: {[key: string]: number}
            } = {request: {}, times: {}};

            const chainIdentifier = req.query.chain as string ?? this.chains.default;
            const {signer, chainInterface} = this.getChain(chainIdentifier);

            metadata.times.requestReceived = Date.now();
            /**
             * address: string              solana address of the recipient
             * amount: string               amount (in lamports/smart chain base units) of the invoice
             */

            req.query.token ??= chainInterface.getNativeCurrencyAddress();

            const parsedBody: FromBtcLnTrustedRequestType = verifySchema(req.query,{
                address: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    chainInterface.isValidAddress(val) ? val : null,
                token: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    this.isTokenSupported(chainIdentifier, val) ? val : null,
                amount: FieldTypeEnum.BigInt,
                exactIn: (val: string) => val==="true" ? true :
                    (val==="false" || val===undefined) ? false : null
            });
            if(parsedBody==null) throw {
                code: 20100,
                msg: "Invalid request body"
            };
            metadata.request = parsedBody;

            const requestedAmount = {input: parsedBody.exactIn, amount: parsedBody.amount};
            const request = {
                chainIdentifier,
                raw: req,
                parsed: parsedBody,
                metadata
            };
            const useToken = parsedBody.token;

            //Check request params
            const fees = await this.AmountAssertions.preCheckFromBtcAmounts(request, requestedAmount, useToken);
            metadata.times.requestChecked = Date.now();

            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;
            const abortController = getAbortController(responseStream);

            //Pre-fetch data
            const pricePrefetchPromise: Promise<bigint> = this.swapPricing.preFetchPrice(useToken, chainIdentifier).catch(e => {
                this.logger.error("pricePrefetchPromise(): pricePrefetch error: ", e);
                abortController.abort(e);
                return null;
            });
            const balancePrefetch = chainInterface.getBalance(signer.getAddress(), useToken).catch(e => {
                this.logger.error("getBalancePrefetch(): balancePrefetch error: ", e);
                abortController.abort(e);
                return null;
            });
            const channelsPrefetch: Promise<LightningNetworkChannel[]> = this.LightningAssertions.getChannelsPrefetch(abortController);

            //Check valid amount specified (min/max)
            const {
                amountBD,
                swapFee,
                swapFeeInToken,
                totalInToken
            } = await this.AmountAssertions.checkFromBtcAmount(request, requestedAmount, fees, useToken, abortController.signal, pricePrefetchPromise);
            metadata.times.priceCalculated = Date.now();

            //Check if we have enough funds to honor the request
            await this.checkBalance(totalInToken, balancePrefetch, abortController.signal)
            await this.LightningAssertions.checkInboundLiquidity(amountBD, channelsPrefetch, abortController.signal);
            metadata.times.balanceChecked = Date.now();

            const secret = randomBytes(32);
            const hash = createHash("sha256").update(secret).digest();

            const hodlInvoiceObj: HodlInvoiceInit = {
                description: chainIdentifier+"-GAS-"+parsedBody.address,
                cltvDelta: Number(this.config.minCltv) + 5,
                expiresAt: Date.now()+(this.config.invoiceTimeoutSeconds*1000),
                id: hash.toString("hex"),
                mtokens: amountBD * 1000n
            };
            metadata.invoiceRequest = hodlInvoiceObj;

            const hodlInvoice = await this.lightning.createHodlInvoice(hodlInvoiceObj);
            abortController.signal.throwIfAborted();
            metadata.times.invoiceCreated = Date.now();
            metadata.invoiceResponse = {...hodlInvoice};

            console.log("[From BTC-LN: REST.CreateInvoice] hodl invoice created: ", hodlInvoice);

            const createdSwap = new FromBtcLnTrustedSwap(
                chainIdentifier,
                hodlInvoice.request,
                hodlInvoice.mtokens,
                swapFee,
                swapFeeInToken,
                totalInToken,
                secret.toString("hex"),
                parsedBody.address,
                useToken
            );
            metadata.times.swapCreated = Date.now();
            createdSwap.metadata = metadata;

            await PluginManager.swapCreate(createdSwap);
            await this.storageManager.saveData(hash.toString("hex"), null, createdSwap);
            this.subscribeToInvoice(createdSwap);

            this.swapLogger.info(createdSwap, "REST: /createInvoice: Created swap invoice: "+hodlInvoice.request+" amount: "+amountBD.toString(10));

            res.status(200).json({
                msg: "Success",
                code: 10000,
                data: {
                    pr: hodlInvoice.request,
                    amountSats: amountBD.toString(10),
                    swapFeeSats: swapFee.toString(10),
                    swapFee: swapFeeInToken.toString(10),
                    total: totalInToken.toString(10),
                    intermediaryKey: signer.getAddress()
                }
            });
        });

        restServer.get(this.path+"/createInvoice", createInvoice);

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

            const invoiceData: FromBtcLnTrustedSwap = await this.storageManager.getData(parsedBody.paymentHash, null);
            if (invoiceData==null) throw {
                _httpStatus: 200,
                code: 10001,
                msg: "Invoice expired/canceled"
            };

            if (
                invoiceData.state === FromBtcLnTrustedSwapState.CANCELED ||
                invoiceData.state === FromBtcLnTrustedSwapState.REFUNDED
            ) throw {
                _httpStatus: 200,
                code: 10001,
                msg: "Invoice expired/canceled"
            };

            if (invoiceData.state === FromBtcLnTrustedSwapState.CREATED) throw {
                _httpStatus: 200,
                code: 10010,
                msg: "Invoice yet unpaid"
            };

            if (invoiceData.state === FromBtcLnTrustedSwapState.RECEIVED) throw {
                _httpStatus: 200,
                code: 10011,
                msg: "Invoice received, payment processing"
            };

            if (invoiceData.state === FromBtcLnTrustedSwapState.SENT) throw {
                _httpStatus: 200,
                code: 10012,
                msg: "Tx sent",
                data: {
                    txId: invoiceData.txIds.init
                }
            };

            if (invoiceData.state === FromBtcLnTrustedSwapState.CONFIRMED) throw {
                _httpStatus: 200,
                code: 10000,
                msg: "Success, tx confirmed",
                data: {
                    txId: invoiceData.txIds.init
                }
            };

            if (invoiceData.state === FromBtcLnTrustedSwapState.SETTLED) throw {
                _httpStatus: 200,
                code: 10000,
                msg: "Success, tx confirmed - invoice settled",
                data: {
                    txId: invoiceData.txIds.init
                }
            };
        });
        restServer.get(this.path+"/getInvoiceStatus", getInvoiceStatus);

        this.logger.info("started at path: ", this.path);
    }

    async init() {
        await this.storageManager.loadData(FromBtcLnTrustedSwap);
        //Check if all swaps contain a valid amount
        for(let {obj: swap} of await this.storageManager.query([])) {
            if(swap.amount==null) {
                const parsedPR = await this.lightning.parsePaymentRequest(swap.pr);
                swap.amount = (parsedPR.mtokens + 999n) / 1000n;
            }
        }
        await PluginManager.serviceInitialize(this);
    }

    getInfoData(): any {
        return {
            minCltv: Number(this.config.minCltv)
        };
    }

}

