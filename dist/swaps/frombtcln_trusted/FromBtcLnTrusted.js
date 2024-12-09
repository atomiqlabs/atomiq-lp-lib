"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcLnTrusted = void 0;
const BN = require("bn.js");
const crypto_1 = require("crypto");
const bolt11 = require("@atomiqlabs/bolt11");
const lightning_1 = require("lightning");
const FromBtcLnTrustedSwap_1 = require("./FromBtcLnTrustedSwap");
const SwapHandler_1 = require("../SwapHandler");
const Utils_1 = require("../../utils/Utils");
const SchemaVerifier_1 = require("../../utils/paramcoders/SchemaVerifier");
const PluginManager_1 = require("../../plugins/PluginManager");
const FromBtcLnBaseSwapHandler_1 = require("../FromBtcLnBaseSwapHandler");
const ServerParamDecoder_1 = require("../../utils/paramcoders/server/ServerParamDecoder");
/**
 * Swap handler handling from BTCLN swaps using submarine swaps
 */
class FromBtcLnTrusted extends FromBtcLnBaseSwapHandler_1.FromBtcLnBaseSwapHandler {
    constructor(storageDirectory, path, chains, lnd, swapPricing, config) {
        super(storageDirectory, path, chains, lnd, swapPricing);
        this.type = SwapHandler_1.SwapHandlerType.FROM_BTCLN_TRUSTED;
        this.activeSubscriptions = new Map();
        this.processedTxIds = new Map();
        this.config = config;
        this.config.invoiceTimeoutSeconds = this.config.invoiceTimeoutSeconds || 90;
        for (let chainId in chains.chains) {
            this.allowedTokens[chainId] = new Set([chains.chains[chainId].swapContract.getNativeCurrencyAddress()]);
        }
    }
    /**
     * Unsubscribe from the pending lightning network invoice
     *
     * @param paymentHash
     * @private
     */
    unsubscribeInvoice(paymentHash) {
        const sub = this.activeSubscriptions.get(paymentHash);
        if (sub == null)
            return false;
        sub.removeAllListeners();
        this.activeSubscriptions.delete(paymentHash);
        return true;
    }
    /**
     * Subscribe to a pending lightning network invoice
     *
     * @param invoiceData
     */
    subscribeToInvoice(invoiceData) {
        const hash = invoiceData.getHash();
        //Already subscribed
        if (this.activeSubscriptions.has(invoiceData.getHash()))
            return;
        const sub = (0, lightning_1.subscribeToInvoice)({ id: hash, lnd: this.LND });
        this.swapLogger.debug(invoiceData, "subscribeToInvoice(): Subscribed to invoice payment");
        sub.on('invoice_updated', (invoice) => {
            this.swapLogger.debug(invoiceData, "subscribeToInvoice(): invoice_updated: ", invoice);
            if (!invoice.is_held)
                return;
            this.htlcReceived(invoiceData, invoice).catch(e => console.error(e));
            sub.removeAllListeners();
            this.activeSubscriptions.delete(hash);
        });
        this.activeSubscriptions.set(hash, sub);
    }
    /**
     *
     * @param swap
     * @protected
     * @returns {Promise<boolean>} Whether the invoice should be cancelled
     */
    processPastSwap(swap) {
        return __awaiter(this, void 0, void 0, function* () {
            if (swap.state === FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.CANCELED)
                return true;
            if (swap.state === FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.REFUNDED)
                return true;
            const parsedPR = bolt11.decode(swap.pr);
            const invoice = yield (0, lightning_1.getInvoice)({
                id: parsedPR.tagsObject.payment_hash,
                lnd: this.LND
            });
            if (invoice.is_held) {
                //Adjust the state of the swap and expiry
                try {
                    yield this.htlcReceived(swap, invoice);
                    //Result is either FromBtcLnTrustedSwapState.RECEIVED or FromBtcLnTrustedSwapState.CANCELED
                }
                catch (e) {
                    console.error(e);
                }
            }
            else if (!invoice.is_confirmed) {
                //Not paid
                const isInvoiceExpired = parsedPR.timeExpireDate < Date.now() / 1000;
                if (isInvoiceExpired) {
                    yield swap.setState(FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.CANCELED);
                    return true;
                }
                this.subscribeToInvoice(swap);
            }
            return false;
        });
    }
    cancelInvoices(swaps) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let swap of swaps) {
                //Cancel invoices
                try {
                    const paymentHash = swap.getHash();
                    yield (0, lightning_1.cancelHodlInvoice)({
                        lnd: this.LND,
                        id: paymentHash
                    });
                    this.unsubscribeInvoice(paymentHash);
                    this.swapLogger.info(swap, "cancelInvoices(): invoice cancelled!");
                    yield this.removeSwapData(swap);
                }
                catch (e) {
                    this.swapLogger.error(swap, "cancelInvoices(): cannot cancel hodl invoice id", e);
                }
            }
        });
    }
    /**
     * Checks past swaps, refunds and deletes ones that are already expired.
     */
    processPastSwaps() {
        return __awaiter(this, void 0, void 0, function* () {
            const cancelInvoices = [];
            const queriedData = yield this.storageManager.query([
                {
                    key: "state",
                    value: [
                        FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.CREATED,
                        FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.RECEIVED,
                        FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.SENT,
                        FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.CONFIRMED,
                        FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.CANCELED,
                        FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.REFUNDED,
                    ]
                }
            ]);
            for (let swap of queriedData) {
                if (yield this.processPastSwap(swap))
                    cancelInvoices.push(swap);
            }
            yield this.cancelInvoices(cancelInvoices);
        });
    }
    cancelSwapAndInvoice(swap) {
        return __awaiter(this, void 0, void 0, function* () {
            if (swap.state !== FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.RECEIVED)
                return;
            yield swap.setState(FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.CANCELED);
            const paymentHash = swap.getHash();
            yield (0, lightning_1.cancelHodlInvoice)({
                id: paymentHash,
                lnd: this.LND
            });
            this.unsubscribeInvoice(paymentHash);
            yield this.removeSwapData(swap);
            this.swapLogger.info(swap, "cancelSwapAndInvoice(): swap removed & invoice cancelled, invoice: ", swap.pr);
        });
    }
    /**
     * Saves the state of received HTLC of the lightning payment
     *
     * @param invoiceData
     * @param invoice
     */
    htlcReceived(invoiceData, invoice) {
        return __awaiter(this, void 0, void 0, function* () {
            const { swapContract, signer } = this.getChain(invoiceData.chainIdentifier);
            //Important to prevent race condition and issuing 2 signed init messages at the same time
            if (invoiceData.state === FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.CREATED) {
                if (invoiceData.metadata != null)
                    invoiceData.metadata.times.htlcReceived = Date.now();
                yield invoiceData.setState(FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.RECEIVED);
                yield this.storageManager.saveData(invoice.id, null, invoiceData);
            }
            if (invoiceData.state === FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.RECEIVED) {
                const balance = swapContract.getBalance(signer.getAddress(), swapContract.getNativeCurrencyAddress(), false);
                try {
                    yield this.checkBalance(invoiceData.output, balance, null);
                    if (invoiceData.metadata != null)
                        invoiceData.metadata.times.htlcBalanceChecked = Date.now();
                }
                catch (e) {
                    yield this.cancelSwapAndInvoice(invoiceData);
                    throw e;
                }
                if (invoiceData.state !== FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.RECEIVED)
                    return;
                let unlock = invoiceData.lock(30 * 1000);
                if (unlock == null)
                    return;
                const txns = yield swapContract.txsTransfer(signer.getAddress(), swapContract.getNativeCurrencyAddress(), invoiceData.output, invoiceData.dstAddress);
                yield swapContract.sendAndConfirm(signer, txns, true, null, false, (txId, rawTx) => __awaiter(this, void 0, void 0, function* () {
                    invoiceData.txIds = { init: txId };
                    invoiceData.scRawTx = rawTx;
                    if (invoiceData.state === FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.RECEIVED) {
                        yield invoiceData.setState(FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.SENT);
                        yield this.storageManager.saveData(invoice.id, null, invoiceData);
                    }
                    if (unlock != null)
                        unlock();
                    unlock = null;
                }));
            }
            if (invoiceData.state === FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.SENT) {
                const txStatus = yield swapContract.getTxStatus(invoiceData.scRawTx);
                if (txStatus === "not_found") {
                    //Retry
                    invoiceData.txIds = { init: null };
                    invoiceData.scRawTx = null;
                    yield invoiceData.setState(FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.RECEIVED);
                    yield this.storageManager.saveData(invoice.id, null, invoiceData);
                }
                if (txStatus === "reverted") {
                    //Cancel invoice
                    yield invoiceData.setState(FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.REFUNDED);
                    yield this.storageManager.saveData(invoice.id, null, invoiceData);
                    yield (0, lightning_1.cancelHodlInvoice)({
                        id: invoice.id,
                        lnd: this.LND
                    });
                    this.unsubscribeInvoice(invoice.id);
                    yield this.removeSwapData(invoice.id, null);
                    this.swapLogger.info(invoiceData, "htlcReceived(): transaction reverted, refunding lightning: ", invoiceData.pr);
                    throw {
                        code: 20002,
                        msg: "Transaction reverted"
                    };
                }
                if (txStatus === "success") {
                    //Successfully paid
                    yield invoiceData.setState(FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.CONFIRMED);
                    yield this.storageManager.saveData(invoice.id, null, invoiceData);
                }
            }
            if (invoiceData.state === FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.CONFIRMED) {
                yield (0, lightning_1.settleHodlInvoice)({
                    lnd: this.LND,
                    secret: invoiceData.secret
                });
                if (invoiceData.metadata != null)
                    invoiceData.metadata.times.htlcSettled = Date.now();
                const paymentHash = invoiceData.getHash();
                this.processedTxIds.set(paymentHash, invoiceData.txIds.init);
                yield invoiceData.setState(FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.SETTLED);
                this.unsubscribeInvoice(paymentHash);
                this.swapLogger.info(invoiceData, "htlcReceived(): invoice settled, invoice: " + invoiceData.pr + " scTxId: " + invoiceData.txIds.init);
                yield this.removeSwapData(invoiceData);
            }
        });
    }
    /**
     *
     * Checks if the lightning invoice is in HELD state (htlcs received but yet unclaimed)
     *
     * @param paymentHash
     * @throws {DefinedRuntimeError} Will throw if the lightning invoice is not found, or if it isn't in the HELD state
     * @returns the fetched lightning invoice
     */
    checkInvoiceStatus(paymentHash) {
        return __awaiter(this, void 0, void 0, function* () {
            const invoice = yield (0, lightning_1.getInvoice)({
                id: paymentHash,
                lnd: this.LND
            });
            const isInvoiceFound = invoice != null;
            if (!isInvoiceFound)
                throw {
                    _httpStatus: 200,
                    code: 10001,
                    msg: "Invoice expired/canceled"
                };
            const arr = invoice.description.split("-");
            let chainIdentifier;
            let address;
            if (arr.length > 2 && arr[1] === "GAS") {
                chainIdentifier = arr[0];
                address = arr[2];
            }
            else {
                chainIdentifier = this.chains.default;
                address = invoice.description;
            }
            const { swapContract } = this.getChain(chainIdentifier);
            if (!swapContract.isValidAddress(address))
                throw {
                    _httpStatus: 200,
                    code: 10001,
                    msg: "Invoice expired/canceled"
                };
            const isBeingPaid = invoice.is_held;
            if (!isBeingPaid) {
                if (invoice.is_canceled)
                    throw {
                        _httpStatus: 200,
                        code: 10001,
                        msg: "Invoice expired/canceled"
                    };
                if (invoice.is_confirmed) {
                    const scTxId = this.processedTxIds.get(paymentHash);
                    throw {
                        _httpStatus: 200,
                        code: 10000,
                        msg: "Invoice already paid",
                        data: {
                            txId: scTxId
                        }
                    };
                }
                throw {
                    _httpStatus: 200,
                    code: 10010,
                    msg: "Invoice yet unpaid"
                };
            }
            return invoice;
        });
    }
    startRestServer(restServer) {
        const createInvoice = (0, Utils_1.expressHandlerWrapper)((req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const metadata = { request: {}, times: {} };
            const chainIdentifier = (_a = req.query.chain) !== null && _a !== void 0 ? _a : this.chains.default;
            const { swapContract, signer } = this.getChain(chainIdentifier);
            metadata.times.requestReceived = Date.now();
            /**
             * address: string              solana address of the recipient
             * amount: string               amount (in lamports/smart chain base units) of the invoice
             */
            const parsedBody = yield req.paramReader.getParams({
                address: (val) => val != null &&
                    typeof (val) === "string" &&
                    swapContract.isValidAddress(val) ? val : null,
                amount: SchemaVerifier_1.FieldTypeEnum.BN,
                exactOut: SchemaVerifier_1.FieldTypeEnum.BooleanOptional
            });
            if (parsedBody == null)
                throw {
                    code: 20100,
                    msg: "Invalid request body"
                };
            metadata.request = parsedBody;
            const requestedAmount = { input: !parsedBody.exactOut, amount: parsedBody.amount };
            const request = {
                chainIdentifier,
                raw: req,
                parsed: parsedBody,
                metadata
            };
            const useToken = swapContract.getNativeCurrencyAddress();
            //Check request params
            const fees = yield this.preCheckAmounts(request, requestedAmount, useToken);
            metadata.times.requestChecked = Date.now();
            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;
            const abortController = this.getAbortController(responseStream);
            //Pre-fetch data
            const { pricePrefetchPromise } = this.getFromBtcPricePrefetches(chainIdentifier, useToken, abortController);
            const balancePrefetch = swapContract.getBalance(signer.getAddress(), useToken, false).catch(e => {
                this.logger.error("getBalancePrefetch(): balancePrefetch error: ", e);
                abortController.abort(e);
                return null;
            });
            const channelsPrefetch = this.getChannelsPrefetch(abortController);
            //Check valid amount specified (min/max)
            const { amountBD, swapFee, swapFeeInToken, totalInToken } = yield this.checkFromBtcAmount(request, requestedAmount, fees, useToken, abortController.signal, pricePrefetchPromise);
            metadata.times.priceCalculated = Date.now();
            //Check if we have enough funds to honor the request
            yield this.checkBalance(totalInToken, balancePrefetch, abortController.signal);
            yield this.checkInboundLiquidity(amountBD, channelsPrefetch, abortController.signal);
            metadata.times.balanceChecked = Date.now();
            const secret = (0, crypto_1.randomBytes)(32);
            const hash = (0, crypto_1.createHash)("sha256").update(secret).digest();
            const hodlInvoiceObj = {
                description: chainIdentifier + "-GAS-" + parsedBody.address,
                cltv_delta: this.config.minCltv.add(new BN(5)).toNumber(),
                expires_at: new Date(Date.now() + (this.config.invoiceTimeoutSeconds * 1000)).toISOString(),
                id: hash.toString("hex"),
                mtokens: amountBD.mul(new BN(1000)).toString(10),
                lnd: null
            };
            metadata.invoiceRequest = Object.assign({}, hodlInvoiceObj);
            hodlInvoiceObj.lnd = this.LND;
            const hodlInvoice = yield (0, lightning_1.createHodlInvoice)(hodlInvoiceObj);
            abortController.signal.throwIfAborted();
            metadata.times.invoiceCreated = Date.now();
            metadata.invoiceResponse = Object.assign({}, hodlInvoice);
            console.log("[From BTC-LN: REST.CreateInvoice] hodl invoice created: ", hodlInvoice);
            const createdSwap = new FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwap(chainIdentifier, hodlInvoice.request, swapFee, swapFeeInToken, totalInToken, secret.toString("hex"), parsedBody.address);
            metadata.times.swapCreated = Date.now();
            createdSwap.metadata = metadata;
            yield PluginManager_1.PluginManager.swapCreate(createdSwap);
            yield this.storageManager.saveData(hash.toString("hex"), null, createdSwap);
            this.subscribeToInvoice(createdSwap);
            this.swapLogger.info(createdSwap, "REST: /createInvoice: Created swap invoice: " + hodlInvoice.request + " amount: " + amountBD.toString(10));
            yield responseStream.writeParamsAndEnd({
                msg: "Success",
                code: 10000,
                data: {
                    pr: hodlInvoice.request,
                    swapFee: swapFeeInToken.toString(10),
                    total: totalInToken.toString(10),
                    intermediaryKey: signer.getAddress()
                }
            });
        }));
        restServer.use(this.path + "/createInvoice", (0, ServerParamDecoder_1.serverParamDecoder)(10 * 1000));
        restServer.post(this.path + "/createInvoice", createInvoice);
        const getInvoiceStatus = (0, Utils_1.expressHandlerWrapper)((req, res) => __awaiter(this, void 0, void 0, function* () {
            /**
             * paymentHash: string          payment hash of the invoice
             */
            const parsedBody = (0, SchemaVerifier_1.verifySchema)(Object.assign(Object.assign({}, req.body), req.query), {
                paymentHash: (val) => val != null &&
                    typeof (val) === "string" &&
                    val.length === 64 &&
                    Utils_1.HEX_REGEX.test(val) ? val : null,
            });
            yield this.checkInvoiceStatus(parsedBody.paymentHash);
            const invoiceData = yield this.storageManager.getData(parsedBody.paymentHash, null);
            if (invoiceData == null)
                throw {
                    _httpStatus: 200,
                    code: 10001,
                    msg: "Invoice expired/canceled"
                };
            if (invoiceData.state === FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.CANCELED ||
                invoiceData.state === FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.REFUNDED)
                throw {
                    _httpStatus: 200,
                    code: 10001,
                    msg: "Invoice expired/canceled"
                };
            if (invoiceData.state === FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.CREATED)
                throw {
                    _httpStatus: 200,
                    code: 10010,
                    msg: "Invoice yet unpaid"
                };
            if (invoiceData.state === FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.RECEIVED)
                throw {
                    _httpStatus: 200,
                    code: 10011,
                    msg: "Invoice received, payment processing"
                };
            if (invoiceData.state === FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.SENT)
                throw {
                    _httpStatus: 200,
                    code: 10012,
                    msg: "Tx sent",
                    data: {
                        txId: invoiceData.txIds.init
                    }
                };
            if (invoiceData.state === FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.CONFIRMED)
                throw {
                    _httpStatus: 200,
                    code: 10000,
                    msg: "Success, tx confirmed",
                    data: {
                        txId: invoiceData.txIds.init
                    }
                };
            if (invoiceData.state === FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwapState.SETTLED)
                throw {
                    _httpStatus: 200,
                    code: 10000,
                    msg: "Success, tx confirmed - invoice settled",
                    data: {
                        txId: invoiceData.txIds.init
                    }
                };
        }));
        restServer.post(this.path + "/getInvoiceStatus", getInvoiceStatus);
        restServer.get(this.path + "/getInvoiceStatus", getInvoiceStatus);
        this.logger.info("started at path: ", this.path);
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.storageManager.loadData(FromBtcLnTrustedSwap_1.FromBtcLnTrustedSwap);
            yield PluginManager_1.PluginManager.serviceInitialize(this);
        });
    }
    getInfoData() {
        return {
            minCltv: this.config.minCltv.toNumber()
        };
    }
    processClaimEvent(chainIdentifier, event) {
        return Promise.resolve();
    }
    processInitializeEvent(chainIdentifier, event) {
        return Promise.resolve();
    }
    processRefundEvent(chainIdentifier, event) {
        return Promise.resolve();
    }
}
exports.FromBtcLnTrusted = FromBtcLnTrusted;