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
exports.ToBtcAbs = void 0;
const BN = require("bn.js");
const bitcoin = require("bitcoinjs-lib");
const lncli = require("ln-service");
const ToBtcSwapAbs_1 = require("./ToBtcSwapAbs");
const SwapHandler_1 = require("../SwapHandler");
const base_1 = require("@atomiqlabs/base");
const Utils_1 = require("../../utils/Utils");
const PluginManager_1 = require("../../plugins/PluginManager");
const coinselect2_1 = require("../../utils/coinselect2");
const utils_1 = require("../../utils/coinselect2/utils");
const crypto_1 = require("crypto");
const SchemaVerifier_1 = require("../../utils/paramcoders/SchemaVerifier");
const ServerParamDecoder_1 = require("../../utils/paramcoders/server/ServerParamDecoder");
const ToBtcBaseSwapHandler_1 = require("../ToBtcBaseSwapHandler");
const promise_queue_ts_1 = require("promise-queue-ts");
const OUTPUT_SCRIPT_MAX_LENGTH = 200;
/**
 * Handler for to BTC swaps, utilizing PTLCs (proof-time locked contracts) using btc relay (on-chain bitcoin SPV)
 */
class ToBtcAbs extends ToBtcBaseSwapHandler_1.ToBtcBaseSwapHandler {
    constructor(storageDirectory, path, chainData, lnd, swapPricing, bitcoinRpc, config) {
        super(storageDirectory, path, chainData, lnd, swapPricing);
        this.CONFIRMATIONS_REQUIRED = 1;
        this.ADDRESS_FORMAT_MAP = {
            "p2wpkh": "p2wpkh",
            "np2wpkh": "p2sh-p2wpkh",
            "p2tr": "p2tr"
        };
        this.LND_CHANGE_OUTPUT_TYPE = "p2tr";
        this.UTXO_CACHE_TIMEOUT = 5 * 1000;
        this.CHANNEL_COUNT_CACHE_TIMEOUT = 30 * 1000;
        this.type = SwapHandler_1.SwapHandlerType.TO_BTC;
        this.activeSubscriptions = {};
        this.sendBtcQueue = new promise_queue_ts_1.PromiseQueue();
        this.bitcoinRpc = bitcoinRpc;
        this.config = config;
        this.config.onchainReservedPerChannel = this.config.onchainReservedPerChannel || 40000;
    }
    /**
     * Returns the payment hash of the swap, takes swap nonce into account. Payment hash is chain-specific.
     *
     * @param chainIdentifier
     * @param address
     * @param nonce
     * @param amount
     * @param bitcoinNetwork
     */
    getHash(chainIdentifier, address, nonce, amount, bitcoinNetwork) {
        const parsedOutputScript = bitcoin.address.toOutputScript(address, bitcoinNetwork);
        const { swapContract } = this.getChain(chainIdentifier);
        return swapContract.getHashForOnchain(parsedOutputScript, amount, nonce);
    }
    /**
     * Returns spendable UTXOs, these are either confirmed UTXOs, or unconfirmed ones that are either whitelisted,
     *  or created by our transactions (and therefore only we could doublespend)
     *
     * @private
     */
    getSpendableUtxos() {
        return __awaiter(this, void 0, void 0, function* () {
            const resBlockheight = yield lncli.getHeight({
                lnd: this.LND
            });
            const blockheight = resBlockheight.current_block_height;
            const resChainTxns = yield lncli.getChainTransactions({
                lnd: this.LND,
                after: blockheight - this.CONFIRMATIONS_REQUIRED
            });
            const selfUTXOs = PluginManager_1.PluginManager.getWhitelistedTxIds();
            const transactions = resChainTxns.transactions;
            for (let tx of transactions) {
                if (tx.is_outgoing) {
                    selfUTXOs.add(tx.id);
                }
            }
            const resUtxos = yield lncli.getUtxos({
                lnd: this.LND
            });
            return resUtxos.utxos.filter(utxo => utxo.confirmation_count >= this.CONFIRMATIONS_REQUIRED || selfUTXOs.has(utxo.transaction_id));
        });
    }
    /**
     * Returns utxo pool to be used by the coinselection algorithm
     *
     * @private
     */
    getUtxoPool(useCached = false) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!useCached || this.cachedUtxos == null || this.cachedUtxos.timestamp < Date.now() - this.UTXO_CACHE_TIMEOUT) {
                const utxos = yield this.getSpendableUtxos();
                let totalSpendable = 0;
                const utxoPool = utxos.map(utxo => {
                    totalSpendable += utxo.tokens;
                    return {
                        vout: utxo.transaction_vout,
                        txId: utxo.transaction_id,
                        value: utxo.tokens,
                        type: this.ADDRESS_FORMAT_MAP[utxo.address_format],
                        outputScript: Buffer.from(utxo.output_script, "hex"),
                        address: utxo.address,
                        confirmations: utxo.confirmation_count
                    };
                });
                this.cachedUtxos = {
                    utxos: utxoPool,
                    timestamp: Date.now()
                };
                this.logger.info("getUtxoPool(): total spendable value: " + totalSpendable + " num utxos: " + utxoPool.length);
            }
            return this.cachedUtxos.utxos;
        });
    }
    /**
     * Checks whether a coinselect result leaves enough funds to cover potential lightning anchor transaction fees
     *
     * @param utxoPool
     * @param obj
     * @param satsPerVbyte
     * @param useCached Whether to use a cached channel count
     * @param initialOutputLength
     * @private
     * @returns true if alright, false if the coinselection doesn't leave enough funds for anchor fees
     */
    isLeavingEnoughForLightningAnchors(utxoPool, obj, satsPerVbyte, useCached = false, initialOutputLength = 1) {
        return __awaiter(this, void 0, void 0, function* () {
            if (obj.inputs == null || obj.outputs == null)
                return false;
            const spentInputs = new Set();
            obj.inputs.forEach(txIn => {
                spentInputs.add(txIn.txId + ":" + txIn.vout);
            });
            let leavesValue = new BN(0);
            utxoPool.forEach(val => {
                const utxoEconomicalValue = new BN(val.value).sub(satsPerVbyte.mul(new BN(utils_1.utils.inputBytes(val).length)));
                if (
                //Utxo not spent
                !spentInputs.has(val.txId + ":" + val.vout) &&
                    //Only economical utxos at current fees
                    !utxoEconomicalValue.isNeg()) {
                    leavesValue = leavesValue.add(utxoEconomicalValue);
                }
            });
            if (obj.outputs.length > initialOutputLength) {
                const changeUtxo = obj.outputs[obj.outputs.length - 1];
                leavesValue = leavesValue.add(new BN(changeUtxo.value).sub(satsPerVbyte.mul(new BN(utils_1.utils.inputBytes(changeUtxo).length))));
            }
            if (!useCached || this.cachedChannelCount == null || this.cachedChannelCount.timestamp < Date.now() - this.CHANNEL_COUNT_CACHE_TIMEOUT) {
                const { channels } = yield lncli.getChannels({ lnd: this.LND });
                this.cachedChannelCount = {
                    count: channels.length,
                    timestamp: Date.now()
                };
            }
            return leavesValue.gt(new BN(this.config.onchainReservedPerChannel).mul(new BN(this.cachedChannelCount.count)));
        });
    }
    /**
     * Gets the change address from the underlying LND instance
     *
     * @private
     */
    getChangeAddress() {
        return new Promise((resolve, reject) => {
            this.LND.wallet.nextAddr({
                type: 4,
                change: true
            }, (err, res) => {
                if (err != null) {
                    reject([503, 'UnexpectedErrGettingNextAddr', { err }]);
                    return;
                }
                resolve(res.addr);
            });
        });
    }
    /**
     * Computes bitcoin on-chain network fee, takes channel reserve & network fee multiplier into consideration
     *
     * @param targetAddress Bitcoin address to send the funds to
     * @param targetAmount Amount of funds to send to the address
     * @param estimate Whether the chain fee should be just estimated and therefore cached utxo set could be used
     * @param multiplierPPM Multiplier for the sats/vB returned from the fee estimator in PPM (parts per million)
     * @private
     * @returns Fee estimate & inputs/outputs to use when constructing transaction, or null in case of not enough funds
     */
    getChainFee(targetAddress, targetAmount, estimate = false, multiplierPPM) {
        return __awaiter(this, void 0, void 0, function* () {
            let feeRate = this.config.feeEstimator == null
                ? yield lncli.getChainFeeRate({ lnd: this.LND })
                    .then(res => res.tokens_per_vbyte)
                    .catch(e => this.logger.error("getChainFee(): LND getChainFeeRate error", e))
                : yield this.config.feeEstimator.estimateFee();
            if (feeRate == null)
                return null;
            let satsPerVbyte = new BN(Math.ceil(feeRate));
            if (multiplierPPM != null)
                satsPerVbyte = satsPerVbyte.mul(multiplierPPM).div(new BN(1000000));
            const utxoPool = yield this.getUtxoPool(estimate);
            let obj = (0, coinselect2_1.coinSelect)(utxoPool, [{
                    address: targetAddress,
                    value: targetAmount,
                    script: bitcoin.address.toOutputScript(targetAddress, this.config.bitcoinNetwork)
                }], satsPerVbyte.toNumber(), this.LND_CHANGE_OUTPUT_TYPE);
            if (obj.inputs == null || obj.outputs == null)
                return null;
            if (!(yield this.isLeavingEnoughForLightningAnchors(utxoPool, obj, satsPerVbyte, estimate)))
                return null;
            this.logger.info("getChainFee(): fee estimated," +
                " target: " + targetAddress +
                " amount: " + targetAmount.toString(10) +
                " fee: " + obj.fee +
                " sats/vB: " + satsPerVbyte +
                " inputs: " + obj.inputs.length +
                " outputs: " + obj.outputs.length +
                " multiplier: " + (multiplierPPM == null ? 1 : multiplierPPM.toNumber() / 1000000));
            return {
                networkFee: new BN(obj.fee),
                satsPerVbyte,
                outputs: obj.outputs,
                inputs: obj.inputs
            };
        });
    }
    /**
     * Tries to claim the swap after our transaction was confirmed
     *
     * @param tx
     * @param payment
     * @param vout
     */
    tryClaimSwap(tx, swap, vout) {
        return __awaiter(this, void 0, void 0, function* () {
            const { swapContract, signer } = this.getChain(swap.chainIdentifier);
            const blockHeader = yield this.bitcoinRpc.getBlockHeader(tx.blockhash);
            //Set flag that we are sending the transaction already, so we don't end up with race condition
            const unlock = swap.lock(swapContract.claimWithTxDataTimeout);
            if (unlock == null)
                return false;
            try {
                this.swapLogger.debug(swap, "tryClaimSwap(): initiate claim of swap, height: " + blockHeader.getHeight() + " utxo: " + tx.txid + ":" + vout);
                const result = yield swapContract.claimWithTxData(signer, swap.data, blockHeader.getHeight(), tx, vout, null, null, false, {
                    waitForConfirmation: true
                });
                this.swapLogger.info(swap, "tryClaimSwap(): swap claimed successfully, height: " + blockHeader.getHeight() + " utxo: " + tx.txid + ":" + vout + " address: " + swap.address);
                if (swap.metadata != null)
                    swap.metadata.times.txClaimed = Date.now();
                unlock();
                return true;
            }
            catch (e) {
                this.swapLogger.error(swap, "tryClaimSwap(): error occurred claiming swap, height: " + blockHeader.getHeight() + " utxo: " + tx.txid + ":" + vout + " address: " + swap.address, e);
                return false;
            }
        });
    }
    processPastSwap(swap) {
        return __awaiter(this, void 0, void 0, function* () {
            const { swapContract, signer } = this.getChain(swap.chainIdentifier);
            const timestamp = new BN(Math.floor(Date.now() / 1000)).sub(new BN(this.config.maxSkew));
            if (swap.state === ToBtcSwapAbs_1.ToBtcSwapState.SAVED && swap.signatureExpiry != null) {
                const isSignatureExpired = swap.signatureExpiry.lt(timestamp);
                if (isSignatureExpired) {
                    const isCommitted = yield swapContract.isCommited(swap.data);
                    if (!isCommitted) {
                        this.swapLogger.info(swap, "processPastSwap(state=SAVED): authorization expired & swap not committed, cancelling swap, address: " + swap.address);
                        yield this.removeSwapData(swap, ToBtcSwapAbs_1.ToBtcSwapState.CANCELED);
                    }
                    else {
                        this.swapLogger.info(swap, "processPastSwap(state=SAVED): swap committed (detected from processPastSwap), address: " + swap.address);
                        yield swap.setState(ToBtcSwapAbs_1.ToBtcSwapState.COMMITED);
                        yield this.storageManager.saveData(swap.getHash(), swap.data.getSequence(), swap);
                    }
                    return;
                }
            }
            if (swap.state === ToBtcSwapAbs_1.ToBtcSwapState.NON_PAYABLE || swap.state === ToBtcSwapAbs_1.ToBtcSwapState.SAVED) {
                const isSwapExpired = swap.data.getExpiry().lt(timestamp);
                if (isSwapExpired) {
                    this.swapLogger.info(swap, "processPastSwap(state=NON_PAYABLE|SAVED): swap expired, cancelling, address: " + swap.address);
                    yield this.removeSwapData(swap, ToBtcSwapAbs_1.ToBtcSwapState.CANCELED);
                    return;
                }
            }
            //Sanity check for sent swaps
            if (swap.state === ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENT) {
                const isCommited = yield swapContract.isCommited(swap.data);
                if (!isCommited) {
                    const status = yield swapContract.getCommitStatus(signer.getAddress(), swap.data);
                    if (status === base_1.SwapCommitStatus.PAID) {
                        this.swapLogger.info(swap, "processPastSwap(state=BTC_SENT): swap claimed (detected from processPastSwap), address: " + swap.address);
                        this.unsubscribePayment(swap);
                        yield this.removeSwapData(swap, ToBtcSwapAbs_1.ToBtcSwapState.CLAIMED);
                    }
                    else if (status === base_1.SwapCommitStatus.EXPIRED) {
                        this.swapLogger.warn(swap, "processPastSwap(state=BTC_SENT): swap expired, but bitcoin was probably already sent, txId: " + swap.txId + " address: " + swap.address);
                        this.unsubscribePayment(swap);
                        yield this.removeSwapData(swap, ToBtcSwapAbs_1.ToBtcSwapState.REFUNDED);
                    }
                    return;
                }
            }
            if (swap.state === ToBtcSwapAbs_1.ToBtcSwapState.COMMITED || swap.state === ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENDING || swap.state === ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENT) {
                yield this.processInitialized(swap);
                return;
            }
        });
    }
    /**
     * Checks past swaps, deletes ones that are already expired.
     */
    processPastSwaps() {
        return __awaiter(this, void 0, void 0, function* () {
            const queriedData = yield this.storageManager.query([
                {
                    key: "state",
                    values: [
                        ToBtcSwapAbs_1.ToBtcSwapState.SAVED,
                        ToBtcSwapAbs_1.ToBtcSwapState.NON_PAYABLE,
                        ToBtcSwapAbs_1.ToBtcSwapState.COMMITED,
                        ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENDING,
                        ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENT,
                    ]
                }
            ]);
            for (let swap of queriedData) {
                yield this.processPastSwap(swap);
            }
        });
    }
    processBtcTx(swap, tx) {
        return __awaiter(this, void 0, void 0, function* () {
            tx.confirmations = tx.confirmations || 0;
            //Check transaction has enough confirmations
            const hasEnoughConfirmations = tx.confirmations >= swap.data.getConfirmations();
            if (!hasEnoughConfirmations) {
                return false;
            }
            this.swapLogger.debug(swap, "processBtcTx(): address: " + swap.address + " amount: " + swap.amount.toString(10) + " btcTx: " + tx);
            //Search for required transaction output (vout)
            const outputScript = bitcoin.address.toOutputScript(swap.address, this.config.bitcoinNetwork);
            const vout = tx.outs.find(e => new BN(e.value).eq(swap.amount) && Buffer.from(e.scriptPubKey.hex, "hex").equals(outputScript));
            if (vout == null) {
                this.swapLogger.warn(swap, "processBtcTx(): cannot find correct vout," +
                    " required output script: " + outputScript.toString("hex") +
                    " required amount: " + swap.amount.toString(10) +
                    " vouts: ", tx.outs);
                return false;
            }
            if (swap.metadata != null)
                swap.metadata.times.payTxConfirmed = Date.now();
            const success = yield this.tryClaimSwap(tx, swap, vout.n);
            return success;
        });
    }
    /**
     * Checks active sent out bitcoin transactions
     */
    processBtcTxs() {
        return __awaiter(this, void 0, void 0, function* () {
            const unsubscribeSwaps = [];
            for (let txId in this.activeSubscriptions) {
                const swap = this.activeSubscriptions[txId];
                //TODO: RBF the transaction if it's already taking too long to confirm
                try {
                    let tx = yield this.bitcoinRpc.getTransaction(txId);
                    if (tx == null)
                        continue;
                    if (yield this.processBtcTx(swap, tx)) {
                        this.swapLogger.info(swap, "processBtcTxs(): swap claimed successfully, txId: " + tx.txid + " address: " + swap.address);
                        unsubscribeSwaps.push(swap);
                    }
                }
                catch (e) {
                    this.swapLogger.error(swap, "processBtcTxs(): error processing btc transaction", e);
                }
            }
            unsubscribeSwaps.forEach(swap => {
                this.unsubscribePayment(swap);
            });
        });
    }
    /**
     * Subscribes to and periodically checks txId used to send out funds for the swap for enough confirmations
     *
     * @param payment
     */
    subscribeToPayment(payment) {
        this.swapLogger.info(payment, "subscribeToPayment(): subscribing to swap, txId: " + payment.txId + " address: " + payment.address);
        this.activeSubscriptions[payment.txId] = payment;
    }
    unsubscribePayment(payment) {
        if (payment.txId != null) {
            if (this.activeSubscriptions[payment.txId] != null) {
                this.swapLogger.info(payment, "unsubscribePayment(): unsubscribing swap, txId: " + payment.txId + " address: " + payment.address);
                delete this.activeSubscriptions[payment.txId];
            }
        }
    }
    /**
     * Checks if expiry time on the swap leaves us enough room to send a transaction and for the transaction to confirm
     *
     * @param swap
     * @private
     * @throws DefinedRuntimeError will throw an error in case there isn't enough time for us to send a BTC payout tx
     */
    checkExpiresTooSoon(swap) {
        const currentTimestamp = new BN(Math.floor(Date.now() / 1000));
        const tsDelta = swap.data.getExpiry().sub(currentTimestamp);
        const minRequiredCLTV = this.getExpiryFromCLTV(swap.preferedConfirmationTarget, swap.data.getConfirmations());
        const hasRequiredCLTVDelta = tsDelta.gte(minRequiredCLTV);
        if (!hasRequiredCLTVDelta)
            throw {
                code: 90001,
                msg: "TS delta too low",
                data: {
                    required: minRequiredCLTV.toString(10),
                    actual: tsDelta.toString(10)
                }
            };
    }
    /**
     * Checks if the actual fee for the swap is no higher than the quoted estimate
     *
     * @param quotedSatsPerVbyte
     * @param actualSatsPerVbyte
     * @private
     * @throws DefinedRuntimeError will throw an error in case the actual fee is higher than quoted fee
     */
    checkCalculatedTxFee(quotedSatsPerVbyte, actualSatsPerVbyte) {
        const swapPaysEnoughNetworkFee = quotedSatsPerVbyte.gte(actualSatsPerVbyte);
        if (!swapPaysEnoughNetworkFee)
            throw {
                code: 90003,
                msg: "Fee changed too much!",
                data: {
                    quotedFee: actualSatsPerVbyte.toString(10),
                    actualFee: quotedSatsPerVbyte.toString(10)
                }
            };
    }
    /**
     * Runs sanity check on the calculated fee for the transaction
     *
     * @param psbt
     * @param tx
     * @param maxAllowedSatsPerVbyte
     * @param actualSatsPerVbyte
     * @private
     * @throws {Error} Will throw an error if the fee sanity check doesn't pass
     */
    checkPsbtFee(psbt, tx, maxAllowedSatsPerVbyte, actualSatsPerVbyte) {
        const txFee = new BN(psbt.getFee());
        //Sanity check on sats/vB
        const maxAllowedFee = new BN(tx.virtualSize())
            //Considering the extra output was not added, because was detrminetal
            .add(new BN(utils_1.utils.outputBytes({ type: this.LND_CHANGE_OUTPUT_TYPE })))
            //Multiply by maximum allowed feerate
            .mul(maxAllowedSatsPerVbyte)
            //Possibility that extra output was not added due to it being lower than dust
            .add(new BN(utils_1.utils.dustThreshold({ type: this.LND_CHANGE_OUTPUT_TYPE })));
        if (txFee.gt(maxAllowedFee))
            throw new Error("Generated tx fee too high: " + JSON.stringify({
                maxAllowedFee: maxAllowedFee.toString(10),
                actualFee: txFee.toString(10),
                psbtHex: psbt.toHex(),
                maxAllowedSatsPerVbyte: maxAllowedSatsPerVbyte.toString(10),
                actualSatsPerVbyte: actualSatsPerVbyte.toString(10)
            }));
        return txFee;
    }
    /**
     * Create PSBT for swap payout from coinselection result
     *
     * @param address
     * @param amount
     * @param escrowNonce
     * @param coinselectResult
     * @private
     */
    getPsbt(address, amount, escrowNonce, coinselectResult) {
        return __awaiter(this, void 0, void 0, function* () {
            let psbt = new bitcoin.Psbt();
            //Apply nonce
            const nonceBuffer = Buffer.from(escrowNonce.toArray("be", 8));
            const locktimeBN = new BN(nonceBuffer.slice(0, 5), "be");
            let locktime = locktimeBN.toNumber() + 500000000;
            psbt.setLocktime(locktime);
            const sequenceBN = new BN(nonceBuffer.slice(5, 8), "be");
            const sequence = 0xFE000000 + sequenceBN.toNumber();
            psbt.addInputs(coinselectResult.inputs.map(input => {
                return {
                    hash: input.txId,
                    index: input.vout,
                    witnessUtxo: {
                        script: input.outputScript,
                        value: input.value
                    },
                    sighashType: 0x01,
                    sequence
                };
            }));
            psbt.addOutput({
                script: bitcoin.address.toOutputScript(address, this.config.bitcoinNetwork),
                value: amount.toNumber()
            });
            //Add change output
            if (coinselectResult.outputs.length > 1)
                psbt.addOutput({
                    script: bitcoin.address.toOutputScript(yield this.getChangeAddress(), this.config.bitcoinNetwork),
                    value: coinselectResult.outputs[1].value
                });
            return psbt;
        });
    }
    /**
     * Signs provided PSBT and also returns a raw signed transaction
     *
     * @param psbt
     * @private
     */
    signPsbt(psbt) {
        return __awaiter(this, void 0, void 0, function* () {
            const signedPsbt = yield lncli.signPsbt({
                lnd: this.LND,
                psbt: psbt.toHex()
            });
            return {
                psbt: bitcoin.Psbt.fromHex(signedPsbt.psbt),
                rawTx: signedPsbt.transaction
            };
        });
    }
    /**
     * Sends raw bitcoin transaction
     *
     * @param rawTx
     * @private
     */
    sendRawTransaction(rawTx) {
        return __awaiter(this, void 0, void 0, function* () {
            yield lncli.broadcastChainTransaction({
                lnd: this.LND,
                transaction: rawTx
            });
        });
    }
    /**
     * Sends a bitcoin transaction to payout BTC for a swap
     *
     * @param swap
     * @private
     * @throws DefinedRuntimeError will throw an error in case the payment cannot be initiated
     */
    sendBitcoinPayment(swap) {
        //Make sure that bitcoin payouts are processed sequentially to avoid race conditions between multiple payouts,
        // e.g. that 2 payouts share the same input and would effectively double-spend each other
        return this.sendBtcQueue.enqueue(() => __awaiter(this, void 0, void 0, function* () {
            //Run checks
            this.checkExpiresTooSoon(swap);
            if (swap.metadata != null)
                swap.metadata.times.payCLTVChecked = Date.now();
            const coinselectResult = yield this.getChainFee(swap.address, swap.amount.toNumber());
            if (coinselectResult == null)
                throw {
                    code: 90002,
                    msg: "Failed to run coinselect algorithm (not enough funds?)"
                };
            if (swap.metadata != null)
                swap.metadata.times.payChainFee = Date.now();
            this.checkCalculatedTxFee(swap.satsPerVbyte, coinselectResult.satsPerVbyte);
            //Construct payment PSBT
            let unsignedPsbt = yield this.getPsbt(swap.address, swap.amount, swap.data.getEscrowNonce(), coinselectResult);
            this.swapLogger.debug(swap, "sendBitcoinPayment(): generated psbt: " + unsignedPsbt.toHex());
            //Sign the PSBT
            const { psbt, rawTx } = yield this.signPsbt(unsignedPsbt);
            if (swap.metadata != null)
                swap.metadata.times.paySignPSBT = Date.now();
            this.swapLogger.debug(swap, "sendBitcoinPayment(): signed raw transaction: " + rawTx);
            const tx = bitcoin.Transaction.fromHex(rawTx);
            const txFee = this.checkPsbtFee(psbt, tx, swap.satsPerVbyte, coinselectResult.satsPerVbyte);
            swap.txId = tx.getId();
            swap.setRealNetworkFee(txFee);
            yield swap.setState(ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENDING);
            yield this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
            yield this.sendRawTransaction(rawTx);
            if (swap.metadata != null)
                swap.metadata.times.payTxSent = Date.now();
            this.swapLogger.info(swap, "sendBitcoinPayment(): btc transaction generated, signed & broadcasted, txId: " + tx.getId() + " address: " + swap.address);
            //Invalidate the UTXO cache
            this.cachedUtxos = null;
            yield swap.setState(ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENT);
            yield this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
        }));
    }
    /**
     * Called after swap was successfully committed, will check if bitcoin tx is already sent, if not tries to send it and subscribes to it
     *
     * @param swap
     */
    processInitialized(swap) {
        return __awaiter(this, void 0, void 0, function* () {
            if (swap.state === ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENDING) {
                //Bitcoin transaction was signed (maybe also sent)
                const tx = yield this.bitcoinRpc.getTransaction(swap.txId);
                const isTxSent = tx != null;
                if (!isTxSent) {
                    //Reset the state to COMMITED
                    this.swapLogger.info(swap, "processInitialized(state=BTC_SENDING): btc transaction not found, resetting to COMMITED state, txId: " + swap.txId + " address: " + swap.address);
                    yield swap.setState(ToBtcSwapAbs_1.ToBtcSwapState.COMMITED);
                }
                else {
                    this.swapLogger.info(swap, "processInitialized(state=BTC_SENDING): btc transaction found, advancing to BTC_SENT state, txId: " + swap.txId + " address: " + swap.address);
                    yield swap.setState(ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENT);
                    yield this.storageManager.saveData(swap.getHash(), swap.data.getSequence(), swap);
                }
            }
            if (swap.state === ToBtcSwapAbs_1.ToBtcSwapState.SAVED) {
                this.swapLogger.info(swap, "processInitialized(state=SAVED): advancing to COMMITED state, address: " + swap.address);
                yield swap.setState(ToBtcSwapAbs_1.ToBtcSwapState.COMMITED);
                yield this.storageManager.saveData(swap.getHash(), swap.data.getSequence(), swap);
            }
            if (swap.state === ToBtcSwapAbs_1.ToBtcSwapState.COMMITED) {
                const unlock = swap.lock(60);
                if (unlock == null)
                    return;
                this.swapLogger.debug(swap, "processInitialized(state=COMMITED): sending bitcoin transaction, address: " + swap.address);
                try {
                    yield this.sendBitcoinPayment(swap);
                    this.swapLogger.info(swap, "processInitialized(state=COMMITED): btc transaction sent, address: " + swap.address);
                }
                catch (e) {
                    if ((0, Utils_1.isDefinedRuntimeError)(e)) {
                        this.swapLogger.error(swap, "processInitialized(state=COMMITED): setting state to NON_PAYABLE due to send bitcoin payment error", e);
                        if (swap.metadata != null)
                            swap.metadata.payError = e;
                        yield swap.setState(ToBtcSwapAbs_1.ToBtcSwapState.NON_PAYABLE);
                        yield this.storageManager.saveData(swap.getHash(), swap.data.getSequence(), swap);
                    }
                    else {
                        this.swapLogger.error(swap, "processInitialized(state=COMMITED): send bitcoin payment error", e);
                        throw e;
                    }
                }
                unlock();
            }
            if (swap.state === ToBtcSwapAbs_1.ToBtcSwapState.NON_PAYABLE)
                return;
            this.subscribeToPayment(swap);
        });
    }
    processInitializeEvent(chainIdentifier, event) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            if (event.swapType !== base_1.ChainSwapType.CHAIN_NONCED)
                return;
            const paymentHash = event.paymentHash;
            const swap = yield this.storageManager.getData(paymentHash, event.sequence);
            if (swap == null || swap.chainIdentifier !== chainIdentifier)
                return;
            swap.txIds.init = (_a = event.meta) === null || _a === void 0 ? void 0 : _a.txId;
            if (swap.metadata != null)
                swap.metadata.times.txReceived = Date.now();
            this.swapLogger.info(swap, "SC: InitializeEvent: swap initialized by the client, address: " + swap.address);
            yield this.processInitialized(swap);
        });
    }
    processClaimEvent(chainIdentifier, event) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            const paymentHash = event.paymentHash;
            const swap = yield this.storageManager.getData(paymentHash, event.sequence);
            if (swap == null || swap.chainIdentifier !== chainIdentifier)
                return;
            swap.txIds.claim = (_a = event.meta) === null || _a === void 0 ? void 0 : _a.txId;
            this.swapLogger.info(swap, "SC: ClaimEvent: swap successfully claimed to us, address: " + swap.address);
            //Also remove transaction from active subscriptions
            this.unsubscribePayment(swap);
            yield this.removeSwapData(swap, ToBtcSwapAbs_1.ToBtcSwapState.CLAIMED);
        });
    }
    processRefundEvent(chainIdentifier, event) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            const paymentHash = event.paymentHash;
            const swap = yield this.storageManager.getData(paymentHash, event.sequence);
            if (swap == null || swap.chainIdentifier !== chainIdentifier)
                return;
            swap.txIds.refund = (_a = event.meta) === null || _a === void 0 ? void 0 : _a.txId;
            this.swapLogger.info(swap, "SC: RefundEvent: swap successfully refunded by the user, address: " + swap.address);
            //Also remove transaction from active subscriptions
            this.unsubscribePayment(swap);
            yield this.removeSwapData(swap, ToBtcSwapAbs_1.ToBtcSwapState.REFUNDED);
        });
    }
    /**
     * Returns required expiry delta for swap params
     *
     * @param confirmationTarget
     * @param confirmations
     */
    getExpiryFromCLTV(confirmationTarget, confirmations) {
        //Blocks = 10 + (confirmations + confirmationTarget)*2
        //Time = 3600 + (600*blocks*2)
        const cltv = this.config.minChainCltv.add(new BN(confirmations).add(new BN(confirmationTarget)).mul(this.config.sendSafetyFactor));
        return this.config.gracePeriod.add(this.config.bitcoinBlocktime.mul(cltv).mul(this.config.safetyFactor));
    }
    /**
     * Checks if the requested nonce is valid
     *
     * @param nonce
     * @throws {DefinedRuntimeError} will throw an error if the nonce is invalid
     */
    checkNonceValid(nonce) {
        if (nonce.isNeg() || nonce.gte(new BN(2).pow(new BN(64))))
            throw {
                code: 20021,
                msg: "Invalid request body (nonce - cannot be parsed)"
            };
        const nonceBuffer = Buffer.from(nonce.toArray("be", 8));
        const firstPart = new BN(nonceBuffer.slice(0, 5), "be");
        const maxAllowedValue = new BN(Math.floor(Date.now() / 1000) - 600000000);
        if (firstPart.gt(maxAllowedValue))
            throw {
                code: 20022,
                msg: "Invalid request body (nonce - too high)"
            };
    }
    /**
     * Checks if confirmation target is within configured bounds
     *
     * @param confirmationTarget
     * @throws {DefinedRuntimeError} will throw an error if the confirmationTarget is out of bounds
     */
    checkConfirmationTarget(confirmationTarget) {
        if (confirmationTarget > this.config.maxConfTarget)
            throw {
                code: 20023,
                msg: "Invalid request body (confirmationTarget - too high)"
            };
        if (confirmationTarget < this.config.minConfTarget)
            throw {
                code: 20024,
                msg: "Invalid request body (confirmationTarget - too low)"
            };
    }
    /**
     * Checks if the required confirmations are within configured bounds
     *
     * @param confirmations
     * @throws {DefinedRuntimeError} will throw an error if the confirmations are out of bounds
     */
    checkRequiredConfirmations(confirmations) {
        if (confirmations > this.config.maxConfirmations)
            throw {
                code: 20025,
                msg: "Invalid request body (confirmations - too high)"
            };
        if (confirmations < this.config.minConfirmations)
            throw {
                code: 20026,
                msg: "Invalid request body (confirmations - too low)"
            };
    }
    /**
     * Checks the validity of the provided address, also checks if the resulting output script isn't too large
     *
     * @param address
     * @throws {DefinedRuntimeError} will throw an error if the address is invalid
     */
    checkAddress(address) {
        let parsedOutputScript;
        try {
            parsedOutputScript = bitcoin.address.toOutputScript(address, this.config.bitcoinNetwork);
        }
        catch (e) {
            throw {
                code: 20031,
                msg: "Invalid request body (address - cannot be parsed)"
            };
        }
        if (parsedOutputScript.length > OUTPUT_SCRIPT_MAX_LENGTH)
            throw {
                code: 20032,
                msg: "Invalid request body (address's output script - too long)"
            };
    }
    /**
     * Checks if the swap is expired, taking into consideration on-chain time skew
     *
     * @param swap
     * @throws {DefinedRuntimeError} will throw an error if the swap is expired
     */
    checkExpired(swap) {
        const isExpired = swap.data.getExpiry().lt(new BN(Math.floor(Date.now() / 1000)).sub(new BN(this.config.maxSkew)));
        if (isExpired)
            throw {
                _httpStatus: 200,
                code: 20010,
                msg: "Payment expired"
            };
    }
    /**
     * Checks & returns the network fee needed for a transaction
     *
     * @param address
     * @param amount
     * @throws {DefinedRuntimeError} will throw an error if there are not enough BTC funds
     */
    checkAndGetNetworkFee(address, amount) {
        return __awaiter(this, void 0, void 0, function* () {
            let chainFeeResp = yield this.getChainFee(address, amount.toNumber(), true, this.config.networkFeeMultiplierPPM);
            const hasEnoughFunds = chainFeeResp != null;
            if (!hasEnoughFunds)
                throw {
                    code: 20002,
                    msg: "Not enough liquidity"
                };
            return chainFeeResp;
        });
    }
    startRestServer(restServer) {
        restServer.use(this.path + "/payInvoice", (0, ServerParamDecoder_1.serverParamDecoder)(10 * 1000));
        restServer.post(this.path + "/payInvoice", (0, Utils_1.expressHandlerWrapper)((req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const metadata = { request: {}, times: {} };
            const chainIdentifier = (_a = req.query.chain) !== null && _a !== void 0 ? _a : this.chains.default;
            const { swapContract, signer } = this.getChain(chainIdentifier);
            metadata.times.requestReceived = Date.now();
            /**
             *Sent initially:
             * address: string                      Bitcoin destination address
             * amount: string                       Amount to send (in satoshis)
             * confirmationTarget: number           Desired confirmation target for the swap, how big of a fee should be assigned to TX
             * confirmations: number                Required number of confirmations for us to claim the swap
             * nonce: string                        Nonce for the swap (used for replay protection)
             * token: string                        Desired token to use
             * offerer: string                      Address of the caller
             * exactIn: boolean                     Whether the swap should be an exact in instead of exact out swap
             *
             *Sent later:
             * feeRate: string                      Fee rate to use for the init signature
             */
            const parsedBody = yield req.paramReader.getParams({
                address: SchemaVerifier_1.FieldTypeEnum.String,
                amount: SchemaVerifier_1.FieldTypeEnum.BN,
                confirmationTarget: SchemaVerifier_1.FieldTypeEnum.Number,
                confirmations: SchemaVerifier_1.FieldTypeEnum.Number,
                nonce: SchemaVerifier_1.FieldTypeEnum.BN,
                token: (val) => val != null &&
                    typeof (val) === "string" &&
                    this.isTokenSupported(chainIdentifier, val) ? val : null,
                offerer: (val) => val != null &&
                    typeof (val) === "string" &&
                    swapContract.isValidAddress(val) ? val : null,
                exactIn: SchemaVerifier_1.FieldTypeEnum.BooleanOptional
            });
            if (parsedBody == null)
                throw {
                    code: 20100,
                    msg: "Invalid request body"
                };
            metadata.request = parsedBody;
            const requestedAmount = { input: !!parsedBody.exactIn, amount: parsedBody.amount };
            const request = {
                chainIdentifier,
                raw: req,
                parsed: parsedBody,
                metadata
            };
            const useToken = parsedBody.token;
            const responseStream = res.responseStream;
            this.checkNonceValid(parsedBody.nonce);
            this.checkConfirmationTarget(parsedBody.confirmationTarget);
            this.checkRequiredConfirmations(parsedBody.confirmations);
            this.checkAddress(parsedBody.address);
            yield this.checkVaultInitialized(chainIdentifier, parsedBody.token);
            const fees = yield this.preCheckAmounts(request, requestedAmount, useToken);
            metadata.times.requestChecked = Date.now();
            //Initialize abort controller for the parallel async operations
            const abortController = this.getAbortController(responseStream);
            const { pricePrefetchPromise, signDataPrefetchPromise } = this.getToBtcPrefetches(chainIdentifier, useToken, responseStream, abortController);
            const { amountBD, networkFeeData, totalInToken, swapFee, swapFeeInToken, networkFeeInToken } = yield this.checkToBtcAmount(request, requestedAmount, fees, useToken, (amount) => __awaiter(this, void 0, void 0, function* () {
                metadata.times.amountsChecked = Date.now();
                const resp = yield this.checkAndGetNetworkFee(parsedBody.address, amount);
                metadata.times.chainFeeCalculated = Date.now();
                return resp;
            }), abortController.signal, pricePrefetchPromise);
            metadata.times.priceCalculated = Date.now();
            const paymentHash = this.getHash(chainIdentifier, parsedBody.address, parsedBody.nonce, amountBD, this.config.bitcoinNetwork).toString("hex");
            //Add grace period another time, so the user has 1 hour to commit
            const expirySeconds = this.getExpiryFromCLTV(parsedBody.confirmationTarget, parsedBody.confirmations).add(new BN(this.config.gracePeriod));
            const currentTimestamp = new BN(Math.floor(Date.now() / 1000));
            const minRequiredExpiry = currentTimestamp.add(expirySeconds);
            const sequence = new BN((0, crypto_1.randomBytes)(8));
            const payObject = yield swapContract.createSwapData(base_1.ChainSwapType.CHAIN_NONCED, parsedBody.offerer, signer.getAddress(), useToken, totalInToken, paymentHash, sequence, minRequiredExpiry, parsedBody.nonce, parsedBody.confirmations, true, false, new BN(0), new BN(0));
            abortController.signal.throwIfAborted();
            metadata.times.swapCreated = Date.now();
            const sigData = yield this.getToBtcSignatureData(chainIdentifier, payObject, req, abortController.signal, signDataPrefetchPromise);
            metadata.times.swapSigned = Date.now();
            const createdSwap = new ToBtcSwapAbs_1.ToBtcSwapAbs(chainIdentifier, parsedBody.address, amountBD, swapFee, swapFeeInToken, networkFeeData.networkFee, networkFeeInToken, networkFeeData.satsPerVbyte, parsedBody.nonce, parsedBody.confirmationTarget, new BN(sigData.timeout));
            createdSwap.data = payObject;
            createdSwap.metadata = metadata;
            yield PluginManager_1.PluginManager.swapCreate(createdSwap);
            yield this.storageManager.saveData(paymentHash, sequence, createdSwap);
            this.swapLogger.info(createdSwap, "REST: /payInvoice: created swap address: " + createdSwap.address + " amount: " + amountBD.toString(10));
            yield responseStream.writeParamsAndEnd({
                code: 20000,
                msg: "Success",
                data: {
                    amount: amountBD.toString(10),
                    address: signer.getAddress(),
                    satsPervByte: networkFeeData.satsPerVbyte.toString(10),
                    networkFee: networkFeeInToken.toString(10),
                    swapFee: swapFeeInToken.toString(10),
                    totalFee: swapFeeInToken.add(networkFeeInToken).toString(10),
                    total: totalInToken.toString(10),
                    minRequiredExpiry: minRequiredExpiry.toString(10),
                    data: payObject.serialize(),
                    prefix: sigData.prefix,
                    timeout: sigData.timeout,
                    signature: sigData.signature
                }
            });
        })));
        const getRefundAuthorization = (0, Utils_1.expressHandlerWrapper)((req, res) => __awaiter(this, void 0, void 0, function* () {
            /**
             * paymentHash: string              Payment hash identifier of the swap
             * sequence: BN                     Sequence identifier of the swap
             */
            const parsedBody = (0, SchemaVerifier_1.verifySchema)(Object.assign(Object.assign({}, req.body), req.query), {
                paymentHash: (val) => val != null &&
                    typeof (val) === "string" &&
                    val.length === 64 &&
                    Utils_1.HEX_REGEX.test(val) ? val : null,
                sequence: SchemaVerifier_1.FieldTypeEnum.BN
            });
            if (parsedBody == null)
                throw {
                    code: 20100,
                    msg: "Invalid request body/query (paymentHash/sequence)"
                };
            this.checkSequence(parsedBody.sequence);
            const payment = yield this.storageManager.getData(parsedBody.paymentHash, parsedBody.sequence);
            if (payment == null || payment.state === ToBtcSwapAbs_1.ToBtcSwapState.SAVED)
                throw {
                    _httpStatus: 200,
                    code: 20007,
                    msg: "Payment not found"
                };
            const { swapContract, signer } = this.getChain(payment.chainIdentifier);
            this.checkExpired(payment);
            if (payment.state === ToBtcSwapAbs_1.ToBtcSwapState.COMMITED)
                throw {
                    _httpStatus: 200,
                    code: 20008,
                    msg: "Payment processing"
                };
            if (payment.state === ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENT || payment.state === ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENDING)
                throw {
                    _httpStatus: 200,
                    code: 20006,
                    msg: "Already paid",
                    data: {
                        txId: payment.txId
                    }
                };
            if (payment.state === ToBtcSwapAbs_1.ToBtcSwapState.NON_PAYABLE) {
                const isCommited = yield swapContract.isCommited(payment.data);
                if (!isCommited)
                    throw {
                        code: 20005,
                        msg: "Not committed"
                    };
                const refundResponse = yield swapContract.getRefundSignature(signer, payment.data, this.config.authorizationTimeout);
                //Double check the state after promise result
                if (payment.state !== ToBtcSwapAbs_1.ToBtcSwapState.NON_PAYABLE)
                    throw {
                        code: 20005,
                        msg: "Not committed"
                    };
                this.swapLogger.info(payment, "REST: /getRefundAuthorization: returning refund authorization, because swap is in NON_PAYABLE state, address: " + payment.address);
                res.status(200).json({
                    code: 20000,
                    msg: "Success",
                    data: {
                        address: signer.getAddress(),
                        prefix: refundResponse.prefix,
                        timeout: refundResponse.timeout,
                        signature: refundResponse.signature
                    }
                });
                return;
            }
            throw {
                _httpStatus: 500,
                code: 20009,
                msg: "Invalid payment status"
            };
        }));
        restServer.post(this.path + "/getRefundAuthorization", getRefundAuthorization);
        restServer.get(this.path + "/getRefundAuthorization", getRefundAuthorization);
        this.logger.info("started at path: ", this.path);
    }
    /**
     * Starts watchdog checking sent bitcoin transactions
     */
    startTxTimer() {
        return __awaiter(this, void 0, void 0, function* () {
            let rerun;
            rerun = () => __awaiter(this, void 0, void 0, function* () {
                yield this.processBtcTxs().catch(e => this.logger.error("startTxTimer(): call to processBtcTxs() errored", e));
                setTimeout(rerun, this.config.txCheckInterval);
            });
            yield rerun();
        });
    }
    startWatchdog() {
        const _super = Object.create(null, {
            startWatchdog: { get: () => super.startWatchdog }
        });
        return __awaiter(this, void 0, void 0, function* () {
            yield _super.startWatchdog.call(this);
            yield this.startTxTimer();
        });
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.storageManager.loadData(ToBtcSwapAbs_1.ToBtcSwapAbs);
            this.subscribeToEvents();
            yield PluginManager_1.PluginManager.serviceInitialize(this);
        });
    }
    getInfoData() {
        return {
            minCltv: this.config.minChainCltv.toNumber(),
            minConfirmations: this.config.minConfirmations,
            maxConfirmations: this.config.maxConfirmations,
            minConfTarget: this.config.minConfTarget,
            maxConfTarget: this.config.maxConfTarget,
            maxOutputScriptLen: OUTPUT_SCRIPT_MAX_LENGTH
        };
    }
}
exports.ToBtcAbs = ToBtcAbs;
