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
exports.FromBtcLnAbs = void 0;
const BN = require("bn.js");
const crypto_1 = require("crypto");
const FromBtcLnSwapAbs_1 = require("./FromBtcLnSwapAbs");
const SwapHandler_1 = require("../SwapHandler");
const base_1 = require("@atomiqlabs/base");
const Utils_1 = require("../../utils/Utils");
const PluginManager_1 = require("../../plugins/PluginManager");
const SchemaVerifier_1 = require("../../utils/paramcoders/SchemaVerifier");
const ServerParamDecoder_1 = require("../../utils/paramcoders/server/ServerParamDecoder");
const FromBtcLnBaseSwapHandler_1 = require("../FromBtcLnBaseSwapHandler");
/**
 * Swap handler handling from BTCLN swaps using submarine swaps
 */
class FromBtcLnAbs extends FromBtcLnBaseSwapHandler_1.FromBtcLnBaseSwapHandler {
    constructor(storageDirectory, path, chains, lightning, swapPricing, config) {
        super(storageDirectory, path, chains, lightning, swapPricing);
        this.type = SwapHandler_1.SwapHandlerType.FROM_BTCLN;
        this.swapType = base_1.ChainSwapType.HTLC;
        this.config = config;
        this.config.invoiceTimeoutSeconds = this.config.invoiceTimeoutSeconds || 90;
    }
    processPastSwap(swap) {
        return __awaiter(this, void 0, void 0, function* () {
            const { swapContract, signer } = this.getChain(swap.chainIdentifier);
            if (swap.state === FromBtcLnSwapAbs_1.FromBtcLnSwapState.CREATED) {
                //Check if already paid
                const parsedPR = yield this.lightning.parsePaymentRequest(swap.pr);
                const invoice = yield this.lightning.getInvoice(parsedPR.id);
                const isBeingPaid = invoice.status === "held";
                if (!isBeingPaid) {
                    //Not paid
                    const isInvoiceExpired = parsedPR.expiryEpochMillis < Date.now();
                    if (!isInvoiceExpired)
                        return null;
                    this.swapLogger.info(swap, "processPastSwap(state=CREATED): swap LN invoice expired, cancelling, invoice: " + swap.pr);
                    yield swap.setState(FromBtcLnSwapAbs_1.FromBtcLnSwapState.CANCELED);
                    return "CANCEL";
                }
                //Adjust the state of the swap and expiry
                try {
                    yield this.htlcReceived(swap, invoice);
                    //Result is either FromBtcLnSwapState.RECEIVED or FromBtcLnSwapState.CANCELED
                }
                catch (e) {
                    this.swapLogger.error(swap, "processPastSwap(state=CREATED): htlcReceived error", e);
                }
                // @ts-ignore Previous call (htlcReceived) mutates the state of the swap, so this is valid
                if (swap.state === FromBtcLnSwapAbs_1.FromBtcLnSwapState.CANCELED) {
                    this.swapLogger.info(swap, "processPastSwap(state=CREATED): invoice CANCELED after htlcReceived(), cancelling, invoice: " + swap.pr);
                    return "CANCEL";
                }
                return null;
            }
            if (swap.state === FromBtcLnSwapAbs_1.FromBtcLnSwapState.RECEIVED) {
                const isAuthorizationExpired = yield swapContract.isInitAuthorizationExpired(swap.data, swap);
                if (isAuthorizationExpired) {
                    const isCommited = yield swapContract.isCommited(swap.data);
                    if (!isCommited) {
                        this.swapLogger.info(swap, "processPastSwap(state=RECEIVED): swap not committed before authorization expiry, cancelling the LN invoice, invoice: " + swap.pr);
                        yield swap.setState(FromBtcLnSwapAbs_1.FromBtcLnSwapState.CANCELED);
                        return "CANCEL";
                    }
                    this.swapLogger.info(swap, "processPastSwap(state=RECEIVED): swap committed (detected from processPastSwap), invoice: " + swap.pr);
                    yield swap.setState(FromBtcLnSwapAbs_1.FromBtcLnSwapState.COMMITED);
                    yield this.saveSwapData(swap);
                }
            }
            if (swap.state === FromBtcLnSwapAbs_1.FromBtcLnSwapState.RECEIVED || swap.state === FromBtcLnSwapAbs_1.FromBtcLnSwapState.COMMITED) {
                if (!(yield swapContract.isExpired(signer.getAddress(), swap.data)))
                    return null;
                const isCommited = yield swapContract.isCommited(swap.data);
                if (isCommited) {
                    this.swapLogger.info(swap, "processPastSwap(state=COMMITED): swap timed out, refunding to self, invoice: " + swap.pr);
                    return "REFUND";
                }
                this.swapLogger.info(swap, "processPastSwap(state=RECEIVED): swap timed out, cancelling the LN invoice, invoice: " + swap.pr);
                return "CANCEL";
            }
            if (swap.state === FromBtcLnSwapAbs_1.FromBtcLnSwapState.CLAIMED)
                return "SETTLE";
            if (swap.state === FromBtcLnSwapAbs_1.FromBtcLnSwapState.CANCELED)
                return "CANCEL";
        });
    }
    refundSwaps(refundSwaps) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let refundSwap of refundSwaps) {
                const { swapContract, signer } = this.getChain(refundSwap.chainIdentifier);
                const unlock = refundSwap.lock(swapContract.refundTimeout);
                if (unlock == null)
                    continue;
                this.swapLogger.debug(refundSwap, "refundSwaps(): initiate refund of swap");
                yield swapContract.refund(signer, refundSwap.data, true, false, { waitForConfirmation: true });
                this.swapLogger.info(refundSwap, "refundsSwaps(): swap refunded, invoice: " + refundSwap.pr);
                yield refundSwap.setState(FromBtcLnSwapAbs_1.FromBtcLnSwapState.REFUNDED);
                unlock();
            }
        });
    }
    cancelInvoices(swaps) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let swap of swaps) {
                //Refund
                const paymentHash = swap.lnPaymentHash;
                try {
                    yield this.lightning.cancelHodlInvoice(paymentHash);
                    this.swapLogger.info(swap, "cancelInvoices(): invoice cancelled!");
                    yield this.removeSwapData(swap);
                }
                catch (e) {
                    this.swapLogger.error(swap, "cancelInvoices(): cannot cancel hodl invoice id", e);
                }
            }
        });
    }
    settleInvoices(swaps) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let swap of swaps) {
                try {
                    yield this.lightning.settleHodlInvoice(swap.secret);
                    if (swap.metadata != null)
                        swap.metadata.times.htlcSettled = Date.now();
                    yield this.removeSwapData(swap, FromBtcLnSwapAbs_1.FromBtcLnSwapState.SETTLED);
                    this.swapLogger.info(swap, "settleInvoices(): invoice settled, secret: " + swap.secret);
                }
                catch (e) {
                    this.swapLogger.error(swap, "settleInvoices(): cannot settle invoice", e);
                }
            }
        });
    }
    /**
     * Checks past swaps, refunds and deletes ones that are already expired.
     */
    processPastSwaps() {
        return __awaiter(this, void 0, void 0, function* () {
            const settleInvoices = [];
            const cancelInvoices = [];
            const refundSwaps = [];
            const queriedData = yield this.storageManager.query([
                {
                    key: "state",
                    value: [
                        FromBtcLnSwapAbs_1.FromBtcLnSwapState.CREATED,
                        FromBtcLnSwapAbs_1.FromBtcLnSwapState.RECEIVED,
                        FromBtcLnSwapAbs_1.FromBtcLnSwapState.COMMITED,
                        FromBtcLnSwapAbs_1.FromBtcLnSwapState.CLAIMED,
                        FromBtcLnSwapAbs_1.FromBtcLnSwapState.CANCELED,
                    ]
                }
            ]);
            for (let { obj: swap } of queriedData) {
                switch (yield this.processPastSwap(swap)) {
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
            yield this.refundSwaps(refundSwaps);
            yield this.cancelInvoices(cancelInvoices);
            yield this.settleInvoices(settleInvoices);
        });
    }
    processInitializeEvent(chainIdentifier, savedSwap, event) {
        return __awaiter(this, void 0, void 0, function* () {
            this.swapLogger.info(savedSwap, "SC: InitializeEvent: HTLC initialized by the client, invoice: " + savedSwap.pr);
            if (savedSwap.state === FromBtcLnSwapAbs_1.FromBtcLnSwapState.RECEIVED) {
                yield savedSwap.setState(FromBtcLnSwapAbs_1.FromBtcLnSwapState.COMMITED);
                yield this.saveSwapData(savedSwap);
            }
        });
    }
    processClaimEvent(chainIdentifier, savedSwap, event) {
        return __awaiter(this, void 0, void 0, function* () {
            //Claim
            //This is the important part, we need to catch the claim TX, else we may lose money
            const secret = Buffer.from(event.result, "hex");
            const paymentHash = (0, crypto_1.createHash)("sha256").update(secret).digest();
            const secretHex = secret.toString("hex");
            const paymentHashHex = paymentHash.toString("hex");
            if (savedSwap.lnPaymentHash !== paymentHashHex)
                return;
            this.swapLogger.info(savedSwap, "SC: ClaimEvent: swap HTLC successfully claimed by the client, invoice: " + savedSwap.pr);
            try {
                yield this.lightning.settleHodlInvoice(secretHex);
                this.swapLogger.info(savedSwap, "SC: ClaimEvent: invoice settled, secret: " + secretHex);
                savedSwap.secret = secretHex;
                if (savedSwap.metadata != null)
                    savedSwap.metadata.times.htlcSettled = Date.now();
                yield this.removeSwapData(savedSwap, FromBtcLnSwapAbs_1.FromBtcLnSwapState.SETTLED);
            }
            catch (e) {
                this.swapLogger.error(savedSwap, "SC: ClaimEvent: cannot settle invoice", e);
                savedSwap.secret = secretHex;
                yield savedSwap.setState(FromBtcLnSwapAbs_1.FromBtcLnSwapState.CLAIMED);
                yield this.saveSwapData(savedSwap);
            }
        });
    }
    processRefundEvent(chainIdentifier, savedSwap, event) {
        return __awaiter(this, void 0, void 0, function* () {
            this.swapLogger.info(savedSwap, "SC: RefundEvent: swap refunded to us, invoice: " + savedSwap.pr);
            try {
                yield this.lightning.cancelHodlInvoice(savedSwap.lnPaymentHash);
                this.swapLogger.info(savedSwap, "SC: RefundEvent: invoice cancelled");
                yield this.removeSwapData(savedSwap, FromBtcLnSwapAbs_1.FromBtcLnSwapState.REFUNDED);
            }
            catch (e) {
                this.swapLogger.error(savedSwap, "SC: RefundEvent: cannot cancel invoice", e);
                yield savedSwap.setState(FromBtcLnSwapAbs_1.FromBtcLnSwapState.CANCELED);
                // await PluginManager.swapStateChange(savedSwap);
                yield this.saveSwapData(savedSwap);
            }
        });
    }
    /**
     * Called when lightning HTLC is received, also signs an init transaction on the smart chain side, expiry of the
     *  smart chain authorization starts ticking as soon as this HTLC is received
     *
     * @param invoiceData
     * @param invoice
     */
    htlcReceived(invoiceData, invoice) {
        return __awaiter(this, void 0, void 0, function* () {
            this.swapLogger.debug(invoiceData, "htlcReceived(): invoice: ", invoice);
            if (invoiceData.metadata != null)
                invoiceData.metadata.times.htlcReceived = Date.now();
            const useToken = invoiceData.token;
            const escrowAmount = invoiceData.totalTokens;
            //Create abort controller for parallel fetches
            const abortController = new AbortController();
            //Pre-fetch data
            const balancePrefetch = this.getBalancePrefetch(invoiceData.chainIdentifier, useToken, abortController);
            const blockheightPrefetch = this.getBlockheightPrefetch(abortController);
            const signDataPrefetchPromise = this.getSignDataPrefetch(invoiceData.chainIdentifier, abortController);
            let expiryTimeout;
            try {
                //Check if we have enough liquidity to proceed
                yield this.checkBalance(escrowAmount, balancePrefetch, abortController.signal);
                if (invoiceData.metadata != null)
                    invoiceData.metadata.times.htlcBalanceChecked = Date.now();
                //Check if HTLC expiry is long enough
                expiryTimeout = yield this.checkHtlcExpiry(invoice, blockheightPrefetch, abortController.signal);
                if (invoiceData.metadata != null)
                    invoiceData.metadata.times.htlcTimeoutCalculated = Date.now();
            }
            catch (e) {
                if (!abortController.signal.aborted) {
                    if (invoiceData.state === FromBtcLnSwapAbs_1.FromBtcLnSwapState.CREATED)
                        yield this.cancelSwapAndInvoice(invoiceData);
                }
                throw e;
            }
            const { swapContract, signer } = this.getChain(invoiceData.chainIdentifier);
            //Create real swap data
            const payInvoiceObject = yield swapContract.createSwapData(base_1.ChainSwapType.HTLC, signer.getAddress(), invoiceData.token, useToken, escrowAmount, invoiceData.claimHash, new BN(0), new BN(Math.floor(Date.now() / 1000)).add(expiryTimeout), false, true, invoiceData.securityDeposit, new BN(0));
            abortController.signal.throwIfAborted();
            if (invoiceData.metadata != null)
                invoiceData.metadata.times.htlcSwapCreated = Date.now();
            //Sign swap data
            const sigData = yield swapContract.getInitSignature(signer, payInvoiceObject, this.config.authorizationTimeout, signDataPrefetchPromise == null ? null : yield signDataPrefetchPromise, invoiceData.feeRate);
            //No need to check abortController anymore since all pending promises are resolved by now
            if (invoiceData.metadata != null)
                invoiceData.metadata.times.htlcSwapSigned = Date.now();
            //Important to prevent race condition and issuing 2 signed init messages at the same time
            if (invoiceData.state === FromBtcLnSwapAbs_1.FromBtcLnSwapState.CREATED) {
                invoiceData.data = payInvoiceObject;
                invoiceData.prefix = sigData.prefix;
                invoiceData.timeout = sigData.timeout;
                invoiceData.signature = sigData.signature;
                //Setting the state variable is done outside the promise, so is done synchronously
                yield invoiceData.setState(FromBtcLnSwapAbs_1.FromBtcLnSwapState.RECEIVED);
                yield this.saveSwapData(invoiceData);
                return;
            }
        });
    }
    /**
     * Checks invoice description hash
     *
     * @param descriptionHash
     * @throws {DefinedRuntimeError} will throw an error if the description hash is invalid
     */
    checkDescriptionHash(descriptionHash) {
        if (descriptionHash != null) {
            if (typeof (descriptionHash) !== "string" || !Utils_1.HEX_REGEX.test(descriptionHash) || descriptionHash.length !== 64) {
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
    getBlockheightPrefetch(abortController) {
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
    sendPublicKeyAsync(responseStream) {
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
    getInvoicePaymentsTimeout(invoice) {
        let timeout = null;
        invoice.payments.forEach((curr) => {
            if (timeout == null || timeout > curr.timeout)
                timeout = curr.timeout;
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
    checkHtlcExpiry(invoice, blockheightPrefetch, signal) {
        return __awaiter(this, void 0, void 0, function* () {
            const timeout = this.getInvoicePaymentsTimeout(invoice);
            const current_block_height = yield blockheightPrefetch;
            signal.throwIfAborted();
            const blockDelta = new BN(timeout - current_block_height);
            const htlcExpiresTooSoon = blockDelta.lt(this.config.minCltv);
            if (htlcExpiresTooSoon) {
                throw {
                    code: 20002,
                    msg: "Not enough time to reliably process the swap",
                    data: {
                        requiredDelta: this.config.minCltv.toString(10),
                        actualDelta: blockDelta.toString(10)
                    }
                };
            }
            return this.config.minCltv.mul(this.config.bitcoinBlocktime.div(this.config.safetyFactor)).sub(this.config.gracePeriod);
        });
    }
    /**
     * Cancels the swap (CANCELED state) & also cancels the LN invoice (including all pending HTLCs)
     *
     * @param invoiceData
     */
    cancelSwapAndInvoice(invoiceData) {
        return __awaiter(this, void 0, void 0, function* () {
            if (invoiceData.state !== FromBtcLnSwapAbs_1.FromBtcLnSwapState.CREATED)
                return;
            yield invoiceData.setState(FromBtcLnSwapAbs_1.FromBtcLnSwapState.CANCELED);
            yield this.lightning.cancelHodlInvoice(invoiceData.lnPaymentHash);
            yield this.removeSwapData(invoiceData);
            this.swapLogger.info(invoiceData, "cancelSwapAndInvoice(): swap removed & invoice cancelled, invoice: ", invoiceData.pr);
        });
    }
    ;
    getDummySwapData(chainIdentifier, useToken, address, paymentHash) {
        const { swapContract, signer } = this.getChain(chainIdentifier);
        const dummyAmount = new BN((0, crypto_1.randomBytes)(3));
        return swapContract.createSwapData(base_1.ChainSwapType.HTLC, signer.getAddress(), address, useToken, dummyAmount, swapContract.getHashForHtlc(Buffer.from(paymentHash, "hex")).toString("hex"), new BN((0, crypto_1.randomBytes)(8)), new BN(Math.floor(Date.now() / 1000)), false, true, new BN((0, crypto_1.randomBytes)(2)), new BN(0));
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
            const invoice = yield this.lightning.getInvoice(paymentHash);
            if (invoice == null)
                throw {
                    _httpStatus: 200,
                    code: 10001,
                    msg: "Invoice expired/canceled"
                };
            const arr = invoice.description.split("-");
            let chainIdentifier;
            let address;
            if (arr.length > 1) {
                chainIdentifier = arr[0];
                address = arr[1];
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
            switch (invoice.status) {
                case "canceled":
                    throw {
                        _httpStatus: 200,
                        code: 10001,
                        msg: "Invoice expired/canceled"
                    };
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
        });
    }
    startRestServer(restServer) {
        restServer.use(this.path + "/createInvoice", (0, ServerParamDecoder_1.serverParamDecoder)(10 * 1000));
        restServer.post(this.path + "/createInvoice", (0, Utils_1.expressHandlerWrapper)((req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const metadata = { request: {}, times: {} };
            const chainIdentifier = (_a = req.query.chain) !== null && _a !== void 0 ? _a : this.chains.default;
            const { swapContract, signer } = this.getChain(chainIdentifier);
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
            const parsedBody = yield req.paramReader.getParams({
                address: (val) => val != null &&
                    typeof (val) === "string" &&
                    swapContract.isValidAddress(val) ? val : null,
                paymentHash: (val) => val != null &&
                    typeof (val) === "string" &&
                    val.length === 64 &&
                    Utils_1.HEX_REGEX.test(val) ? val : null,
                amount: SchemaVerifier_1.FieldTypeEnum.BN,
                token: (val) => val != null &&
                    typeof (val) === "string" &&
                    this.isTokenSupported(chainIdentifier, val) ? val : null,
                descriptionHash: SchemaVerifier_1.FieldTypeEnum.StringOptional,
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
            const useToken = parsedBody.token;
            //Check request params
            this.checkDescriptionHash(parsedBody.descriptionHash);
            const fees = yield this.preCheckAmounts(request, requestedAmount, useToken);
            metadata.times.requestChecked = Date.now();
            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;
            const abortController = this.getAbortController(responseStream);
            //Pre-fetch data
            const { pricePrefetchPromise, securityDepositPricePrefetchPromise } = this.getFromBtcPricePrefetches(chainIdentifier, useToken, abortController);
            const balancePrefetch = this.getBalancePrefetch(chainIdentifier, useToken, abortController);
            const channelsPrefetch = this.getChannelsPrefetch(abortController);
            const dummySwapData = yield this.getDummySwapData(chainIdentifier, useToken, parsedBody.address, parsedBody.paymentHash);
            abortController.signal.throwIfAborted();
            const baseSDPromise = this.getBaseSecurityDepositPrefetch(chainIdentifier, dummySwapData, abortController);
            //Asynchronously send the node's public key to the client
            this.sendPublicKeyAsync(responseStream);
            //Check valid amount specified (min/max)
            const { amountBD, swapFee, swapFeeInToken, totalInToken } = yield this.checkFromBtcAmount(request, requestedAmount, fees, useToken, abortController.signal, pricePrefetchPromise);
            metadata.times.priceCalculated = Date.now();
            //Check if we have enough funds to honor the request
            yield this.checkBalance(totalInToken, balancePrefetch, abortController.signal);
            yield this.checkInboundLiquidity(amountBD, channelsPrefetch, abortController.signal);
            metadata.times.balanceChecked = Date.now();
            //Create swap
            const hodlInvoiceObj = {
                description: chainIdentifier + "-" + parsedBody.address,
                cltvDelta: this.config.minCltv.add(new BN(5)).toNumber(),
                expiresAt: Date.now() + (this.config.invoiceTimeoutSeconds * 1000),
                id: parsedBody.paymentHash,
                mtokens: amountBD.mul(new BN(1000)),
                descriptionHash: parsedBody.descriptionHash
            };
            metadata.invoiceRequest = hodlInvoiceObj;
            const hodlInvoice = yield this.lightning.createHodlInvoice(hodlInvoiceObj);
            abortController.signal.throwIfAborted();
            metadata.times.invoiceCreated = Date.now();
            metadata.invoiceResponse = Object.assign({}, hodlInvoice);
            //Pre-compute the security deposit
            const expiryTimeout = this.config.minCltv.mul(this.config.bitcoinBlocktime.div(this.config.safetyFactor)).sub(this.config.gracePeriod);
            const totalSecurityDeposit = yield this.getSecurityDeposit(chainIdentifier, amountBD, swapFee, expiryTimeout, baseSDPromise, securityDepositPricePrefetchPromise, abortController.signal, metadata);
            metadata.times.securityDepositCalculated = Date.now();
            const createdSwap = new FromBtcLnSwapAbs_1.FromBtcLnSwapAbs(chainIdentifier, hodlInvoice.request, parsedBody.paymentHash, hodlInvoice.mtokens, swapFee, swapFeeInToken, parsedBody.address, useToken, totalInToken, swapContract.getHashForHtlc(Buffer.from(parsedBody.paymentHash, "hex")).toString("hex"), totalSecurityDeposit);
            metadata.times.swapCreated = Date.now();
            createdSwap.metadata = metadata;
            //Save the desired fee rate for the signature
            const feeRateObj = yield req.paramReader.getParams({
                feeRate: SchemaVerifier_1.FieldTypeEnum.String
            }).catch(e => null);
            abortController.signal.throwIfAborted();
            createdSwap.feeRate = (feeRateObj === null || feeRateObj === void 0 ? void 0 : feeRateObj.feeRate) != null && typeof (feeRateObj.feeRate) === "string" ? feeRateObj.feeRate : null;
            yield PluginManager_1.PluginManager.swapCreate(createdSwap);
            yield this.saveSwapData(createdSwap);
            this.swapLogger.info(createdSwap, "REST: /createInvoice: Created swap invoice: " + hodlInvoice.request + " amount: " + amountBD.toString(10));
            yield responseStream.writeParamsAndEnd({
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
        })));
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
            res.status(200).json({
                code: 10000,
                msg: "Success"
            });
        }));
        restServer.post(this.path + "/getInvoiceStatus", getInvoiceStatus);
        restServer.get(this.path + "/getInvoiceStatus", getInvoiceStatus);
        const getInvoicePaymentAuth = (0, Utils_1.expressHandlerWrapper)((req, res) => __awaiter(this, void 0, void 0, function* () {
            /**
             * paymentHash: string          payment hash of the invoice
             */
            const parsedBody = (0, SchemaVerifier_1.verifySchema)(Object.assign(Object.assign({}, req.body), req.query), {
                paymentHash: (val) => val != null &&
                    typeof (val) === "string" &&
                    val.length === 64 &&
                    Utils_1.HEX_REGEX.test(val) ? val : null,
            });
            const invoice = yield this.checkInvoiceStatus(parsedBody.paymentHash);
            const swap = yield this.storageManager.getData(parsedBody.paymentHash, null);
            if (swap == null)
                throw {
                    _httpStatus: 200,
                    code: 10001,
                    msg: "Invoice expired/canceled"
                };
            const { swapContract, signer } = this.getChain(swap.chainIdentifier);
            if (swap.state === FromBtcLnSwapAbs_1.FromBtcLnSwapState.RECEIVED) {
                if (yield swapContract.isInitAuthorizationExpired(swap.data, swap))
                    throw {
                        _httpStatus: 200,
                        code: 10001,
                        msg: "Invoice expired/canceled"
                    };
            }
            if (swap.state === FromBtcLnSwapAbs_1.FromBtcLnSwapState.CREATED) {
                try {
                    yield this.htlcReceived(swap, invoice);
                }
                catch (e) {
                    if ((0, Utils_1.isDefinedRuntimeError)(e))
                        e._httpStatus = 200;
                    throw e;
                }
                this.swapLogger.info(swap, "REST: /getInvoicePaymentAuth: swap processed through htlcReceived, invoice: " + swap.pr);
            }
            if (swap.state === FromBtcLnSwapAbs_1.FromBtcLnSwapState.CANCELED)
                throw {
                    _httpStatus: 200,
                    code: 10001,
                    msg: "Invoice expired/canceled"
                };
            if (swap.state === FromBtcLnSwapAbs_1.FromBtcLnSwapState.COMMITED)
                throw {
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
        }));
        restServer.post(this.path + "/getInvoicePaymentAuth", getInvoicePaymentAuth);
        restServer.get(this.path + "/getInvoicePaymentAuth", getInvoicePaymentAuth);
        this.logger.info("started at path: ", this.path);
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.loadData(FromBtcLnSwapAbs_1.FromBtcLnSwapAbs);
            //Check if all swaps contain a valid amount
            for (let { obj: swap } of yield this.storageManager.query([])) {
                if (swap.amount == null) {
                    const parsedPR = yield this.lightning.parsePaymentRequest(swap.pr);
                    swap.amount = parsedPR.mtokens.add(new BN(999)).div(new BN(1000));
                }
            }
            this.subscribeToEvents();
            yield PluginManager_1.PluginManager.serviceInitialize(this);
        });
    }
    getInfoData() {
        return {
            minCltv: this.config.minCltv.toNumber()
        };
    }
}
exports.FromBtcLnAbs = FromBtcLnAbs;
