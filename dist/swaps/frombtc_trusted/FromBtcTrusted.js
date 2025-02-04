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
exports.FromBtcTrusted = void 0;
const FromBtcBaseSwapHandler_1 = require("../FromBtcBaseSwapHandler");
const FromBtcTrustedSwap_1 = require("./FromBtcTrustedSwap");
const SwapHandler_1 = require("../SwapHandler");
const BN = require("bn.js");
const PluginManager_1 = require("../../plugins/PluginManager");
const Utils_1 = require("../../utils/Utils");
const SchemaVerifier_1 = require("../../utils/paramcoders/SchemaVerifier");
const ServerParamDecoder_1 = require("../../utils/paramcoders/server/ServerParamDecoder");
class FromBtcTrusted extends FromBtcBaseSwapHandler_1.FromBtcBaseSwapHandler {
    constructor(storageDirectory, path, chains, bitcoin, swapPricing, bitcoinRpc, config) {
        var _a;
        var _b;
        super(storageDirectory, path, chains, swapPricing);
        this.type = SwapHandler_1.SwapHandlerType.FROM_BTC_TRUSTED;
        this.subscriptions = new Map();
        this.doubleSpendWatchdogSwaps = new Set();
        this.refundedSwaps = new Map();
        this.doubleSpentSwaps = new Map();
        this.processedTxIds = new Map();
        this.config = config;
        (_a = (_b = this.config).recommendFeeMultiplier) !== null && _a !== void 0 ? _a : (_b.recommendFeeMultiplier = 1.25);
        this.bitcoin = bitcoin;
        this.bitcoinRpc = bitcoinRpc;
        for (let chainId in chains.chains) {
            this.allowedTokens[chainId] = new Set([chains.chains[chainId].swapContract.getNativeCurrencyAddress()]);
        }
    }
    getAllAncestors(tx) {
        return Promise.all(tx.ins.map(input => this.bitcoinRpc.getTransaction(input.txid).then(tx => {
            return { tx, vout: input.vout };
        })));
    }
    refundSwap(swap) {
        return __awaiter(this, void 0, void 0, function* () {
            if (swap.refundAddress == null) {
                if (swap.state !== FromBtcTrustedSwap_1.FromBtcTrustedSwapState.REFUNDABLE) {
                    yield swap.setState(FromBtcTrustedSwap_1.FromBtcTrustedSwapState.REFUNDABLE);
                    yield this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
                }
                return;
            }
            let unlock = swap.lock(30 * 1000);
            if (unlock == null)
                return;
            const feeRate = yield this.bitcoin.getFeeRate();
            const ourOutput = swap.btcTx.outs[swap.vout];
            const resp = yield this.bitcoin.drainAll(swap.refundAddress, [{
                    type: this.bitcoin.getAddressType(),
                    confirmations: swap.btcTx.confirmations,
                    outputScript: Buffer.from(ourOutput.scriptPubKey.hex, "hex"),
                    value: ourOutput.value,
                    txId: swap.btcTx.txid,
                    vout: swap.vout
                }], feeRate);
            if (resp == null) {
                this.swapLogger.error(swap, "refundSwap(): cannot refund swap because of dust limit, txId: " + swap.txId);
                unlock();
                return;
            }
            if (swap.metadata != null)
                swap.metadata.times.refundSignPSBT = Date.now();
            this.swapLogger.debug(swap, "refundSwap(): signed raw transaction: " + resp.raw);
            const refundTxId = resp.txId;
            swap.refundTxId = refundTxId;
            //Send the refund TX
            yield this.bitcoin.sendRawTransaction(resp.raw);
            this.swapLogger.debug(swap, "refundSwap(): sent refund transaction: " + refundTxId);
            this.refundedSwaps.set(swap.getHash(), refundTxId);
            yield this.removeSwapData(swap, FromBtcTrustedSwap_1.FromBtcTrustedSwapState.REFUNDED);
            unlock();
        });
    }
    burn(swap) {
        return __awaiter(this, void 0, void 0, function* () {
            const ourOutput = swap.btcTx.outs[swap.vout];
            //Check if we can even increase the feeRate by burning
            const txSize = 110;
            const burnTxFeeRate = Math.floor(ourOutput.value / txSize);
            const initialTxFeeRate = Math.ceil(swap.txFee / swap.txSize);
            if (burnTxFeeRate < initialTxFeeRate) {
                this.swapLogger.warn(swap, "burn(): cannot send burn transaction, pays too little fee, " +
                    "initialTxId: " + swap.txId + " initialTxFeeRate: " + initialTxFeeRate + " burnTxFeeRate: " + burnTxFeeRate);
                this.doubleSpentSwaps.set(swap.getHash(), null);
                yield this.removeSwapData(swap, FromBtcTrustedSwap_1.FromBtcTrustedSwapState.DOUBLE_SPENT);
                return;
            }
            //Construct PSBT
            const resp = yield this.bitcoin.burnAll([{
                    type: this.bitcoin.getAddressType(),
                    confirmations: swap.btcTx.confirmations,
                    outputScript: Buffer.from(ourOutput.scriptPubKey.hex, "hex"),
                    value: ourOutput.value,
                    txId: swap.btcTx.txid,
                    vout: swap.vout
                }]);
            if (swap.metadata != null)
                swap.metadata.times.burnSignPSBT = Date.now();
            this.swapLogger.debug(swap, "burn(): signed raw transaction: " + resp.raw);
            const burnTxId = resp.txId;
            swap.burnTxId = burnTxId;
            //Send the original TX + our burn TX as a package
            const sendTxns = [swap.btcTx.raw, resp.raw];
            //TODO: We should handle this in a better way
            try {
                yield this.bitcoinRpc.sendRawPackage(sendTxns);
                this.swapLogger.debug(swap, "burn(): sent burn transaction: " + burnTxId);
            }
            catch (e) {
                this.swapLogger.error(swap, "burn(): error sending burn package: ", e);
            }
            this.doubleSpentSwaps.set(swap.getHash(), burnTxId);
            yield this.removeSwapData(swap, FromBtcTrustedSwap_1.FromBtcTrustedSwapState.DOUBLE_SPENT);
        });
    }
    processPastSwap(swap, tx, vout) {
        return __awaiter(this, void 0, void 0, function* () {
            const foundVout = tx.outs[vout];
            const { swapContract, signer } = this.getChain(swap.chainIdentifier);
            const outputScript = this.bitcoin.toOutputScript(swap.btcAddress).toString("hex");
            if (swap.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.CREATED) {
                this.subscriptions.set(outputScript, swap);
                if (foundVout == null) {
                    //Check expiry
                    if (swap.expiresAt < Date.now()) {
                        this.subscriptions.delete(outputScript);
                        yield this.bitcoin.addUnusedAddress(swap.btcAddress);
                        yield this.removeSwapData(swap, FromBtcTrustedSwap_1.FromBtcTrustedSwapState.EXPIRED);
                        return;
                    }
                    return;
                }
                const sentSats = new BN(foundVout.value);
                if (sentSats.eq(swap.amount)) {
                    swap.adjustedInput = swap.amount;
                    swap.adjustedOutput = swap.outputTokens;
                }
                else {
                    //If lower than minimum then ignore
                    if (sentSats.lt(this.config.min))
                        return;
                    if (sentSats.gt(this.config.max)) {
                        swap.adjustedInput = sentSats;
                        swap.btcTx = tx;
                        swap.txId = tx.txid;
                        swap.vout = vout;
                        this.subscriptions.delete(outputScript);
                        yield this.refundSwap(swap);
                        return;
                    }
                    //Adjust the amount
                    swap.adjustedInput = sentSats;
                    swap.adjustedOutput = swap.outputTokens.mul(sentSats).div(swap.amount);
                }
                swap.btcTx = tx;
                swap.txId = tx.txid;
                swap.vout = vout;
                this.subscriptions.delete(outputScript);
                yield swap.setState(FromBtcTrustedSwap_1.FromBtcTrustedSwapState.RECEIVED);
                yield this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
            }
            if (swap.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.RECEIVED) {
                //Check if transaction still exists
                if (tx == null || foundVout == null || tx.txid !== swap.txId) {
                    yield swap.setState(FromBtcTrustedSwap_1.FromBtcTrustedSwapState.CREATED);
                    yield this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
                    return;
                }
                //Check if it is confirmed
                if (tx.confirmations > 0) {
                    yield swap.setState(FromBtcTrustedSwap_1.FromBtcTrustedSwapState.BTC_CONFIRMED);
                    yield this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
                }
                else {
                    //Check if it pays high enough fee AND has confirmed ancestors
                    const ancestors = yield this.getAllAncestors(tx);
                    const allAncestorsConfirmed = ancestors.reduce((prev, curr) => prev && curr.tx.confirmations > 0, true);
                    const totalInput = ancestors.reduce((prev, curr) => prev + curr.tx.outs[curr.vout].value, 0);
                    const totalOutput = tx.outs.reduce((prev, curr) => prev + curr.value, 0);
                    const fee = totalInput - totalOutput;
                    const feePerVbyte = Math.ceil(fee / tx.vsize);
                    if (allAncestorsConfirmed &&
                        (feePerVbyte >= swap.recommendedFee || feePerVbyte >= (yield this.bitcoin.getFeeRate()))) {
                        if (swap.state !== FromBtcTrustedSwap_1.FromBtcTrustedSwapState.RECEIVED)
                            return;
                        swap.txSize = tx.vsize;
                        swap.txFee = fee;
                        yield swap.setState(FromBtcTrustedSwap_1.FromBtcTrustedSwapState.BTC_CONFIRMED);
                        yield this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
                    }
                    else {
                        return;
                    }
                }
            }
            if (swap.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.REFUNDABLE) {
                if (swap.refundAddress != null) {
                    yield this.refundSwap(swap);
                    return;
                }
            }
            if (swap.doubleSpent || tx == null || foundVout == null || tx.txid !== swap.txId) {
                if (swap.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.REFUNDABLE) {
                    yield swap.setState(FromBtcTrustedSwap_1.FromBtcTrustedSwapState.CREATED);
                    return;
                }
                if (!swap.doubleSpent) {
                    swap.doubleSpent = true;
                    try {
                        yield this.burn(swap);
                        this.doubleSpendWatchdogSwaps.delete(swap);
                    }
                    catch (e) {
                        this.swapLogger.error(swap, "processPastSwap(): Error burning swap: ", e);
                        swap.doubleSpent = false;
                    }
                }
                return;
            }
            else {
                if (tx.confirmations <= 0 && !this.doubleSpendWatchdogSwaps.has(swap)) {
                    this.swapLogger.debug(swap, "processPastSwap(): Adding swap transaction to double spend watchdog list: ", swap.txId);
                    this.doubleSpendWatchdogSwaps.add(swap);
                }
            }
            if (tx.confirmations > 0 && this.doubleSpendWatchdogSwaps.delete(swap)) {
                this.swapLogger.debug(swap, "processPastSwap(): Removing confirmed swap transaction from double spend watchdog list: ", swap.txId);
            }
            if (swap.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.BTC_CONFIRMED) {
                //Send gas token
                const balance = swapContract.getBalance(signer.getAddress(), swapContract.getNativeCurrencyAddress(), false);
                try {
                    yield this.checkBalance(swap.adjustedOutput, balance, null);
                    if (swap.metadata != null)
                        swap.metadata.times.receivedBalanceChecked = Date.now();
                }
                catch (e) {
                    this.swapLogger.error(swap, "processPastSwap(): Error not enough balance: ", e);
                    yield this.refundSwap(swap);
                    return;
                }
                if (swap.state !== FromBtcTrustedSwap_1.FromBtcTrustedSwapState.BTC_CONFIRMED)
                    return;
                let unlock = swap.lock(30 * 1000);
                if (unlock == null)
                    return;
                const txns = yield swapContract.txsTransfer(signer.getAddress(), swapContract.getNativeCurrencyAddress(), swap.adjustedOutput, swap.dstAddress);
                yield swapContract.sendAndConfirm(signer, txns, true, null, false, (txId, rawTx) => __awaiter(this, void 0, void 0, function* () {
                    swap.txIds = { init: txId };
                    swap.scRawTx = rawTx;
                    if (swap.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.BTC_CONFIRMED) {
                        yield swap.setState(FromBtcTrustedSwap_1.FromBtcTrustedSwapState.SENT);
                        yield this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
                    }
                    if (unlock != null)
                        unlock();
                    unlock = null;
                }));
            }
            if (swap.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.SENT) {
                const txStatus = yield swapContract.getTxStatus(swap.scRawTx);
                switch (txStatus) {
                    case "not_found":
                        //Retry
                        swap.txIds = { init: null };
                        swap.scRawTx = null;
                        yield swap.setState(FromBtcTrustedSwap_1.FromBtcTrustedSwapState.RECEIVED);
                        yield this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
                        break;
                    case "reverted":
                        //Cancel invoice
                        yield this.refundSwap(swap);
                        this.swapLogger.info(swap, "processPastSwap(): transaction reverted, refunding btc on-chain: ", swap.btcAddress);
                        break;
                    case "success":
                        yield swap.setState(FromBtcTrustedSwap_1.FromBtcTrustedSwapState.CONFIRMED);
                        yield this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
                        break;
                }
            }
            if (swap.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.CONFIRMED) {
                this.processedTxIds.set(swap.getHash(), {
                    txId: swap.txId,
                    scTxId: swap.txIds.init,
                    adjustedAmount: swap.adjustedInput,
                    adjustedTotal: swap.adjustedOutput
                });
                if (tx.confirmations > 0)
                    yield this.removeSwapData(swap, FromBtcTrustedSwap_1.FromBtcTrustedSwapState.FINISHED);
            }
        });
    }
    processPastSwaps() {
        var _a, _b, _c;
        return __awaiter(this, void 0, void 0, function* () {
            const queriedData = yield this.storageManager.query([
                {
                    key: "state",
                    value: [
                        FromBtcTrustedSwap_1.FromBtcTrustedSwapState.REFUNDABLE,
                        FromBtcTrustedSwap_1.FromBtcTrustedSwapState.CREATED,
                        FromBtcTrustedSwap_1.FromBtcTrustedSwapState.RECEIVED,
                        FromBtcTrustedSwap_1.FromBtcTrustedSwapState.BTC_CONFIRMED,
                        FromBtcTrustedSwap_1.FromBtcTrustedSwapState.SENT,
                        FromBtcTrustedSwap_1.FromBtcTrustedSwapState.CONFIRMED
                    ]
                }
            ]);
            const startingBlockheight = queriedData.reduce((prev, swap) => Math.min(prev, swap.createdHeight), Infinity);
            if (startingBlockheight === Infinity)
                return;
            const transactions = yield this.bitcoin.getWalletTransactions(startingBlockheight);
            const map = new Map();
            transactions.forEach(tx => {
                tx.outs.forEach((out, vout) => {
                    const existing = map.get(out.scriptPubKey.hex);
                    if (existing == null) {
                        map.set(out.scriptPubKey.hex, [{ tx, vout }]);
                    }
                    else {
                        existing.push({ tx, vout });
                    }
                });
            });
            for (let swap of queriedData) {
                const outputScript = this.bitcoin.toOutputScript(swap.btcAddress).toString("hex");
                const txs = (_a = map.get(outputScript)) !== null && _a !== void 0 ? _a : [];
                try {
                    yield this.processPastSwap(swap, (_b = txs[0]) === null || _b === void 0 ? void 0 : _b.tx, (_c = txs[0]) === null || _c === void 0 ? void 0 : _c.vout);
                }
                catch (e) {
                    this.swapLogger.error(swap, "processPastSwaps(): Error ocurred while processing swap: ", e);
                }
            }
        });
    }
    isValidBitcoinAddress(address) {
        try {
            this.bitcoin.toOutputScript(address);
            return true;
        }
        catch (e) { }
        return false;
    }
    startRestServer(restServer) {
        const getAddress = (0, Utils_1.expressHandlerWrapper)((req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const metadata = { request: {}, times: {} };
            const chainIdentifier = (_a = req.query.chain) !== null && _a !== void 0 ? _a : this.chains.default;
            const { swapContract, signer } = this.getChain(chainIdentifier);
            metadata.times.requestReceived = Date.now();
            /**
             * address: string              solana address of the recipient
             * refundAddress?: string       bitcoin address to use in case of refund
             * amount: string               amount (in lamports/smart chain base units) of the invoice
             * exactOut: boolean            whether to create and exact output swap
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
            const refundAddressData = req.paramReader.getExistingParamsOrNull({
                refundAddress: (val) => val != null &&
                    typeof (val) === "string" &&
                    this.isValidBitcoinAddress(val) ? val : null
            });
            const refundAddress = refundAddressData === null || refundAddressData === void 0 ? void 0 : refundAddressData.refundAddress;
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
            //Check valid amount specified (min/max)
            const { amountBD, swapFee, swapFeeInToken, totalInToken } = yield this.checkFromBtcAmount(request, requestedAmount, fees, useToken, abortController.signal, pricePrefetchPromise);
            metadata.times.priceCalculated = Date.now();
            //Make sure we have MORE THAN ENOUGH to honor the swap request
            yield this.checkBalance(totalInToken.mul(new BN(4)), balancePrefetch, abortController.signal);
            metadata.times.balanceChecked = Date.now();
            const blockHeight = yield this.bitcoin.getBlockheight();
            const feeRate = yield this.bitcoin.getFeeRate();
            const recommendedFee = Math.ceil(feeRate * this.config.recommendFeeMultiplier);
            if (recommendedFee === 0)
                throw {
                    _httpStatus: 500,
                    code: 21100,
                    msg: "Cannot estimate bitcoin fee!"
                };
            metadata.times.feeEstimated = Date.now();
            const receiveAddress = yield this.bitcoin.getAddress();
            const outputScript = this.bitcoin.toOutputScript(receiveAddress).toString("hex");
            abortController.signal.throwIfAborted();
            metadata.times.addressCreated = Date.now();
            const createdSwap = new FromBtcTrustedSwap_1.FromBtcTrustedSwap(chainIdentifier, swapFee, swapFeeInToken, receiveAddress, amountBD, parsedBody.address, totalInToken, blockHeight, Date.now() + (this.config.swapAddressExpiry * 1000), recommendedFee, refundAddress);
            metadata.times.swapCreated = Date.now();
            createdSwap.metadata = metadata;
            yield PluginManager_1.PluginManager.swapCreate(createdSwap);
            yield this.storageManager.saveData(createdSwap.getHash(), createdSwap.getSequence(), createdSwap);
            this.subscriptions.set(outputScript, createdSwap);
            this.swapLogger.info(createdSwap, "REST: /getAddress: Created swap address: " + createdSwap.btcAddress + " amount: " + amountBD.toString(10));
            yield responseStream.writeParamsAndEnd({
                msg: "Success",
                code: 10000,
                data: {
                    paymentHash: createdSwap.getHash(),
                    sequence: createdSwap.getSequence().toString(10),
                    btcAddress: receiveAddress,
                    amountSats: amountBD.toString(10),
                    swapFeeSats: swapFee.toString(10),
                    swapFee: swapFeeInToken.toString(10),
                    total: totalInToken.toString(10),
                    intermediaryKey: signer.getAddress(),
                    recommendedFee,
                    expiresAt: createdSwap.expiresAt
                }
            });
        }));
        restServer.use(this.path + "/getAddress", (0, ServerParamDecoder_1.serverParamDecoder)(10 * 1000));
        restServer.post(this.path + "/getAddress", getAddress);
        const getInvoiceStatus = (0, Utils_1.expressHandlerWrapper)((req, res) => __awaiter(this, void 0, void 0, function* () {
            /**
             * paymentHash: string          payment hash of the invoice
             * sequence: BN                 secret sequence for the swap,
             */
            const parsedBody = (0, SchemaVerifier_1.verifySchema)(req.query, {
                paymentHash: (val) => val != null &&
                    typeof (val) === "string" &&
                    val.length === 64 &&
                    Utils_1.HEX_REGEX.test(val) ? val : null,
                sequence: SchemaVerifier_1.FieldTypeEnum.BN,
            });
            if (parsedBody == null)
                throw {
                    code: 20100,
                    msg: "Invalid request"
                };
            const processedTxData = this.processedTxIds.get(parsedBody.paymentHash);
            if (processedTxData != null)
                throw {
                    _httpStatus: 200,
                    code: 10000,
                    msg: "Success, tx confirmed",
                    data: {
                        adjustedAmount: processedTxData.adjustedAmount.toString(10),
                        adjustedTotal: processedTxData.adjustedTotal.toString(10),
                        txId: processedTxData.txId,
                        scTxId: processedTxData.scTxId
                    }
                };
            const refundTxId = this.refundedSwaps.get(parsedBody.paymentHash);
            if (refundTxId != null)
                throw {
                    _httpStatus: 200,
                    code: 10014,
                    msg: "Refunded",
                    data: {
                        txId: refundTxId
                    }
                };
            const doubleSpendTxId = this.doubleSpentSwaps.get(parsedBody.paymentHash);
            if (doubleSpendTxId != null)
                throw {
                    _httpStatus: 200,
                    code: 10015,
                    msg: "Double spend detected, deposit burned",
                    data: {
                        txId: doubleSpendTxId
                    }
                };
            const invoiceData = yield this.storageManager.getData(parsedBody.paymentHash, parsedBody.sequence);
            if (invoiceData == null)
                throw {
                    _httpStatus: 200,
                    code: 10001,
                    msg: "Swap expired/canceled"
                };
            if (invoiceData.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.CREATED)
                throw {
                    _httpStatus: 200,
                    code: 10010,
                    msg: "Bitcoin yet unpaid"
                };
            if (invoiceData.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.RECEIVED)
                throw {
                    _httpStatus: 200,
                    code: 10011,
                    msg: "Bitcoin received, payment processing",
                    data: {
                        adjustedAmount: invoiceData.adjustedInput.toString(10),
                        adjustedTotal: invoiceData.adjustedOutput.toString(10),
                        txId: invoiceData.txId
                    }
                };
            if (invoiceData.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.BTC_CONFIRMED)
                throw {
                    _httpStatus: 200,
                    code: 10013,
                    msg: "Bitcoin accepted, payment processing",
                    data: {
                        adjustedAmount: invoiceData.adjustedInput.toString(10),
                        adjustedTotal: invoiceData.adjustedOutput.toString(10),
                        txId: invoiceData.txId
                    }
                };
            if (invoiceData.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.SENT)
                throw {
                    _httpStatus: 200,
                    code: 10012,
                    msg: "Tx sent",
                    data: {
                        adjustedAmount: invoiceData.adjustedInput.toString(10),
                        adjustedTotal: invoiceData.adjustedOutput.toString(10),
                        txId: invoiceData.txId,
                        scTxId: invoiceData.txIds.init
                    }
                };
            if (invoiceData.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.CONFIRMED || invoiceData.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.FINISHED)
                throw {
                    _httpStatus: 200,
                    code: 10000,
                    msg: "Success, tx confirmed",
                    data: {
                        adjustedAmount: invoiceData.adjustedInput.toString(10),
                        adjustedTotal: invoiceData.adjustedOutput.toString(10),
                        txId: invoiceData.txId,
                        scTxId: invoiceData.txIds.init
                    }
                };
            if (invoiceData.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.REFUNDABLE)
                throw {
                    _httpStatus: 200,
                    code: 10016,
                    msg: "Refundable",
                    data: {
                        adjustedAmount: invoiceData.adjustedInput.toString(10)
                    }
                };
        }));
        restServer.get(this.path + "/getAddressStatus", getInvoiceStatus);
        const setRefundAddress = (0, Utils_1.expressHandlerWrapper)((req, res) => __awaiter(this, void 0, void 0, function* () {
            /**
             * paymentHash: string          payment hash of the invoice
             * sequence: BN                 secret sequence for the swap,
             * refundAddress: string        valid bitcoin address to be used for refunds
             */
            const parsedBody = (0, SchemaVerifier_1.verifySchema)(Object.assign(Object.assign({}, req.body), req.query), {
                paymentHash: (val) => val != null &&
                    typeof (val) === "string" &&
                    val.length === 64 &&
                    Utils_1.HEX_REGEX.test(val) ? val : null,
                sequence: SchemaVerifier_1.FieldTypeEnum.BN,
                refundAddress: (val) => val != null &&
                    typeof (val) === "string" &&
                    this.isValidBitcoinAddress(val) ? val : null
            });
            if (parsedBody == null)
                throw {
                    code: 20100,
                    msg: "Invalid request"
                };
            const invoiceData = yield this.storageManager.getData(parsedBody.paymentHash, null);
            if (invoiceData == null || !invoiceData.getSequence().eq(parsedBody.sequence))
                throw {
                    code: 10001,
                    msg: "Swap not found"
                };
            if (invoiceData.refundAddress != null)
                throw {
                    code: 10080,
                    msg: "Refund address already set!",
                    data: {
                        refundAddress: invoiceData.refundAddress
                    }
                };
            invoiceData.refundAddress = parsedBody.refundAddress;
            if (invoiceData.state === FromBtcTrustedSwap_1.FromBtcTrustedSwapState.REFUNDABLE) {
                this.refundSwap(invoiceData).catch(e => {
                    this.swapLogger.error(invoiceData, "/setRefundAddress: Failed to refund!");
                });
            }
            throw {
                _httpStatus: 200,
                code: 10000,
                msg: "Refund address set"
            };
        }));
        restServer.get(this.path + "/setRefundAddress", setRefundAddress);
        restServer.post(this.path + "/setRefundAddress", setRefundAddress);
        this.logger.info("started at path: ", this.path);
    }
    checkDoubleSpends() {
        return __awaiter(this, void 0, void 0, function* () {
            for (let swap of this.doubleSpendWatchdogSwaps.keys()) {
                const tx = yield this.bitcoin.getWalletTransaction(swap.txId);
                if (tx == null) {
                    this.swapLogger.debug(swap, "checkDoubleSpends(): Swap was double spent, burning... - original txId: " + swap.txId);
                    this.processPastSwap(swap, null, null);
                }
            }
        });
    }
    startDoubleSpendWatchdog() {
        return __awaiter(this, void 0, void 0, function* () {
            let rerun;
            rerun = () => __awaiter(this, void 0, void 0, function* () {
                yield this.checkDoubleSpends().catch(e => console.error(e));
                setTimeout(rerun, this.config.doubleSpendCheckInterval);
            });
            yield rerun();
        });
    }
    listenToTxns() {
        this.bitcoin.subscribeToWalletTransactions((btcTx) => {
            for (let out of btcTx.outs) {
                const savedSwap = this.subscriptions.get(out.scriptPubKey.hex);
                if (savedSwap == null)
                    continue;
                this.processPastSwap(savedSwap, btcTx, out.n);
                return;
            }
        });
    }
    startWatchdog() {
        const _super = Object.create(null, {
            startWatchdog: { get: () => super.startWatchdog }
        });
        return __awaiter(this, void 0, void 0, function* () {
            yield _super.startWatchdog.call(this);
            yield this.startDoubleSpendWatchdog();
        });
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.storageManager.loadData(FromBtcTrustedSwap_1.FromBtcTrustedSwap);
            this.listenToTxns();
            yield PluginManager_1.PluginManager.serviceInitialize(this);
        });
    }
    getInfoData() {
        return {};
    }
    processClaimEvent(chainIdentifier, event) {
        return Promise.resolve(undefined);
    }
    processInitializeEvent(chainIdentifier, event) {
        return Promise.resolve(undefined);
    }
    processRefundEvent(chainIdentifier, event) {
        return Promise.resolve(undefined);
    }
}
exports.FromBtcTrusted = FromBtcTrusted;
