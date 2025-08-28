"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToBtcAbs = void 0;
const ToBtcSwapAbs_1 = require("./ToBtcSwapAbs");
const SwapHandler_1 = require("../../SwapHandler");
const base_1 = require("@atomiqlabs/base");
const Utils_1 = require("../../../utils/Utils");
const PluginManager_1 = require("../../../plugins/PluginManager");
const crypto_1 = require("crypto");
const SchemaVerifier_1 = require("../../../utils/paramcoders/SchemaVerifier");
const ServerParamDecoder_1 = require("../../../utils/paramcoders/server/ServerParamDecoder");
const ToBtcBaseSwapHandler_1 = require("../ToBtcBaseSwapHandler");
const promise_queue_ts_1 = require("promise-queue-ts");
const BitcoinUtils_1 = require("../../../utils/BitcoinUtils");
const OUTPUT_SCRIPT_MAX_LENGTH = 200;
const MAX_PARALLEL_TX_PROCESSED = 10;
/**
 * Handler for to BTC swaps, utilizing PTLCs (proof-time locked contracts) using btc relay (on-chain bitcoin SPV)
 */
class ToBtcAbs extends ToBtcBaseSwapHandler_1.ToBtcBaseSwapHandler {
    constructor(storageDirectory, path, chainData, bitcoin, swapPricing, bitcoinRpc, config) {
        super(storageDirectory, path, chainData, swapPricing, config);
        this.type = SwapHandler_1.SwapHandlerType.TO_BTC;
        this.swapType = base_1.ChainSwapType.CHAIN_NONCED;
        this.activeSubscriptions = {};
        this.sendBtcQueue = new promise_queue_ts_1.PromiseQueue();
        this.bitcoinRpc = bitcoinRpc;
        this.bitcoin = bitcoin;
        this.config = config;
    }
    /**
     * Returns the payment hash of the swap, takes swap nonce into account. Payment hash is chain-specific.
     *
     * @param chainIdentifier
     * @param address
     * @param confirmations
     * @param nonce
     * @param amount
     */
    getHash(chainIdentifier, address, confirmations, nonce, amount) {
        const parsedOutputScript = this.bitcoin.toOutputScript(address);
        const { swapContract } = this.getChain(chainIdentifier);
        return swapContract.getHashForOnchain(parsedOutputScript, amount, confirmations, nonce);
    }
    /**
     * Tries to claim the swap after our transaction was confirmed
     *
     * @param tx
     * @param swap
     * @param vout
     */
    async tryClaimSwap(tx, swap, vout) {
        const { swapContract, signer } = this.getChain(swap.chainIdentifier);
        const blockHeader = await this.bitcoinRpc.getBlockHeader(tx.blockhash);
        //Set flag that we are sending the transaction already, so we don't end up with race condition
        const unlock = swap.lock(swapContract.claimWithTxDataTimeout);
        if (unlock == null)
            return false;
        try {
            this.swapLogger.debug(swap, "tryClaimSwap(): initiate claim of swap, height: " + blockHeader.getHeight() + " utxo: " + tx.txid + ":" + vout);
            const result = await swapContract.claimWithTxData(signer, swap.data, { ...tx, height: blockHeader.getHeight() }, swap.requiredConfirmations, vout, null, null, false, {
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
    }
    async processPastSwap(swap) {
        const { swapContract, signer } = this.getChain(swap.chainIdentifier);
        if (swap.state === ToBtcSwapAbs_1.ToBtcSwapState.SAVED) {
            const isSignatureExpired = await swapContract.isInitAuthorizationExpired(swap.data, swap);
            if (isSignatureExpired) {
                const isCommitted = await swapContract.isCommited(swap.data);
                if (!isCommitted) {
                    this.swapLogger.info(swap, "processPastSwap(state=SAVED): authorization expired & swap not committed, cancelling swap, address: " + swap.address);
                    await this.removeSwapData(swap, ToBtcSwapAbs_1.ToBtcSwapState.CANCELED);
                }
                else {
                    this.swapLogger.info(swap, "processPastSwap(state=SAVED): swap committed (detected from processPastSwap), address: " + swap.address);
                    await swap.setState(ToBtcSwapAbs_1.ToBtcSwapState.COMMITED);
                    await this.saveSwapData(swap);
                }
                return;
            }
        }
        if (swap.state === ToBtcSwapAbs_1.ToBtcSwapState.NON_PAYABLE || swap.state === ToBtcSwapAbs_1.ToBtcSwapState.SAVED) {
            if (await swapContract.isExpired(signer.getAddress(), swap.data)) {
                this.swapLogger.info(swap, "processPastSwap(state=NON_PAYABLE|SAVED): swap expired, cancelling, address: " + swap.address);
                await this.removeSwapData(swap, ToBtcSwapAbs_1.ToBtcSwapState.CANCELED);
                return;
            }
        }
        //Sanity check for sent swaps
        if (swap.state === ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENT) {
            const isCommited = await swapContract.isCommited(swap.data);
            if (!isCommited) {
                const status = await swapContract.getCommitStatus(signer.getAddress(), swap.data);
                if (status.type === base_1.SwapCommitStateType.PAID) {
                    this.swapLogger.info(swap, "processPastSwap(state=BTC_SENT): swap claimed (detected from processPastSwap), address: " + swap.address);
                    this.unsubscribePayment(swap);
                    swap.txIds ?? (swap.txIds = {});
                    swap.txIds.claim = await status.getClaimTxId();
                    await this.removeSwapData(swap, ToBtcSwapAbs_1.ToBtcSwapState.CLAIMED);
                }
                else if (status.type === base_1.SwapCommitStateType.EXPIRED) {
                    this.swapLogger.warn(swap, "processPastSwap(state=BTC_SENT): swap expired, but bitcoin was probably already sent, txId: " + swap.txId + " address: " + swap.address);
                    this.unsubscribePayment(swap);
                    swap.txIds ?? (swap.txIds = {});
                    swap.txIds.refund = status.getRefundTxId == null ? null : await status.getRefundTxId();
                    await this.removeSwapData(swap, ToBtcSwapAbs_1.ToBtcSwapState.REFUNDED);
                }
                return;
            }
        }
        if (swap.state === ToBtcSwapAbs_1.ToBtcSwapState.COMMITED || swap.state === ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENDING || swap.state === ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENT) {
            await this.processInitialized(swap);
            return;
        }
    }
    /**
     * Checks past swaps, deletes ones that are already expired.
     */
    async processPastSwaps() {
        const queriedData = await this.storageManager.query([
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
        for (let { obj: swap } of queriedData) {
            await this.processPastSwap(swap);
        }
    }
    async processBtcTx(swap, tx) {
        tx.confirmations = tx.confirmations || 0;
        //Check transaction has enough confirmations
        const hasEnoughConfirmations = tx.confirmations >= swap.requiredConfirmations;
        if (!hasEnoughConfirmations) {
            return false;
        }
        this.swapLogger.debug(swap, "processBtcTx(): address: " + swap.address + " amount: " + swap.amount.toString(10) + " btcTx: " + tx);
        //Search for required transaction output (vout)
        const outputScript = this.bitcoin.toOutputScript(swap.address);
        const vout = tx.outs.find(e => BigInt(e.value) === swap.amount && Buffer.from(e.scriptPubKey.hex, "hex").equals(outputScript));
        if (vout == null) {
            this.swapLogger.warn(swap, "processBtcTx(): cannot find correct vout," +
                " required output script: " + outputScript.toString("hex") +
                " required amount: " + swap.amount.toString(10) +
                " vouts: ", tx.outs);
            return false;
        }
        if (swap.metadata != null)
            swap.metadata.times.payTxConfirmed = Date.now();
        const success = await this.tryClaimSwap(tx, swap, vout.n);
        return success;
    }
    /**
     * Checks active sent out bitcoin transactions
     */
    async processBtcTxs() {
        const unsubscribeSwaps = [];
        let promises = [];
        for (let txId in this.activeSubscriptions) {
            const swap = this.activeSubscriptions[txId];
            //TODO: RBF the transaction if it's already taking too long to confirm
            promises.push((async () => {
                try {
                    let tx = await this.bitcoin.getWalletTransaction(txId);
                    if (tx == null)
                        return;
                    if (await this.processBtcTx(swap, tx)) {
                        this.swapLogger.info(swap, "processBtcTxs(): swap claimed successfully, txId: " + tx.txid + " address: " + swap.address);
                        unsubscribeSwaps.push(swap);
                    }
                }
                catch (e) {
                    this.swapLogger.error(swap, "processBtcTxs(): error processing btc transaction", e);
                }
            })());
            if (promises.length >= MAX_PARALLEL_TX_PROCESSED) {
                await Promise.all(promises);
                promises = [];
            }
        }
        await Promise.all(promises);
        unsubscribeSwaps.forEach(swap => {
            this.unsubscribePayment(swap);
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
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const tsDelta = swap.data.getExpiry() - currentTimestamp;
        const minRequiredCLTV = this.getExpiryFromCLTV(swap.preferedConfirmationTarget, swap.requiredConfirmations);
        const hasRequiredCLTVDelta = tsDelta >= minRequiredCLTV;
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
        const swapPaysEnoughNetworkFee = quotedSatsPerVbyte >= actualSatsPerVbyte;
        if (!swapPaysEnoughNetworkFee)
            throw {
                code: 90003,
                msg: "Fee changed too much!",
                data: {
                    quotedFee: quotedSatsPerVbyte.toString(10),
                    actualFee: actualSatsPerVbyte.toString(10)
                }
            };
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
        return this.sendBtcQueue.enqueue(async () => {
            //Run checks
            this.checkExpiresTooSoon(swap);
            if (swap.metadata != null)
                swap.metadata.times.payCLTVChecked = Date.now();
            const satsPerVbyte = await this.bitcoin.getFeeRate();
            this.checkCalculatedTxFee(swap.satsPerVbyte, BigInt(satsPerVbyte));
            if (swap.metadata != null)
                swap.metadata.times.payChainFee = Date.now();
            const signResult = await this.bitcoin.getSignedTransaction(swap.address, Number(swap.amount), satsPerVbyte, swap.nonce, Number(swap.satsPerVbyte));
            if (signResult == null)
                throw {
                    code: 90002,
                    msg: "Failed to create signed transaction (not enough funds?)"
                };
            if (swap.metadata != null)
                swap.metadata.times.paySignPSBT = Date.now();
            try {
                this.swapLogger.debug(swap, "sendBitcoinPayment(): signed raw transaction: " + signResult.raw);
                swap.txId = signResult.tx.id;
                swap.btcRawTx = signResult.raw;
                swap.setRealNetworkFee(BigInt(signResult.networkFee));
                swap.sending = true;
                await swap.setState(ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENDING);
                await this.saveSwapData(swap);
                await this.bitcoin.sendRawTransaction(signResult.raw);
                swap.sending = false;
            }
            catch (e) {
                swap.sending = false;
                throw e;
            }
            if (swap.metadata != null)
                swap.metadata.times.payTxSent = Date.now();
            this.swapLogger.info(swap, "sendBitcoinPayment(): btc transaction generated, signed & broadcasted, txId: " + swap.txId + " address: " + swap.address);
            await swap.setState(ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENT);
            await this.saveSwapData(swap);
        });
    }
    /**
     * Called after swap was successfully committed, will check if bitcoin tx is already sent, if not tries to send it and subscribes to it
     *
     * @param swap
     */
    async processInitialized(swap) {
        if (swap.state === ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENDING) {
            if (swap.sending)
                return;
            //Bitcoin transaction was signed (maybe also sent)
            const tx = await (0, BitcoinUtils_1.checkTransactionReplaced)(swap.txId, swap.btcRawTx, this.bitcoinRpc);
            const isTxSent = tx != null;
            if (!isTxSent) {
                //Reset the state to COMMITED
                this.swapLogger.info(swap, "processInitialized(state=BTC_SENDING): btc transaction not found, resetting to COMMITED state, txId: " + swap.txId + " address: " + swap.address);
                await swap.setState(ToBtcSwapAbs_1.ToBtcSwapState.COMMITED);
            }
            else {
                this.swapLogger.info(swap, "processInitialized(state=BTC_SENDING): btc transaction found, advancing to BTC_SENT state, txId: " + swap.txId + " address: " + swap.address);
                await swap.setState(ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENT);
                await this.saveSwapData(swap);
            }
        }
        if (swap.state === ToBtcSwapAbs_1.ToBtcSwapState.SAVED) {
            this.swapLogger.info(swap, "processInitialized(state=SAVED): advancing to COMMITED state, address: " + swap.address);
            await swap.setState(ToBtcSwapAbs_1.ToBtcSwapState.COMMITED);
            await this.saveSwapData(swap);
        }
        if (swap.state === ToBtcSwapAbs_1.ToBtcSwapState.COMMITED) {
            const unlock = swap.lock(60);
            if (unlock == null)
                return;
            this.swapLogger.debug(swap, "processInitialized(state=COMMITED): sending bitcoin transaction, address: " + swap.address);
            try {
                await this.sendBitcoinPayment(swap);
                this.swapLogger.info(swap, "processInitialized(state=COMMITED): btc transaction sent, address: " + swap.address);
            }
            catch (e) {
                if ((0, Utils_1.isDefinedRuntimeError)(e)) {
                    this.swapLogger.error(swap, "processInitialized(state=COMMITED): setting state to NON_PAYABLE due to send bitcoin payment error", e);
                    if (swap.metadata != null)
                        swap.metadata.payError = e;
                    await swap.setState(ToBtcSwapAbs_1.ToBtcSwapState.NON_PAYABLE);
                    await this.saveSwapData(swap);
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
    }
    async processInitializeEvent(chainIdentifier, swap, event) {
        this.swapLogger.info(swap, "SC: InitializeEvent: swap initialized by the client, address: " + swap.address);
        await this.processInitialized(swap);
    }
    async processClaimEvent(chainIdentifier, swap, event) {
        this.swapLogger.info(swap, "SC: ClaimEvent: swap successfully claimed to us, address: " + swap.address);
        //Also remove transaction from active subscriptions
        this.unsubscribePayment(swap);
        await this.removeSwapData(swap, ToBtcSwapAbs_1.ToBtcSwapState.CLAIMED);
    }
    async processRefundEvent(chainIdentifier, swap, event) {
        this.swapLogger.info(swap, "SC: RefundEvent: swap successfully refunded by the user, address: " + swap.address);
        //Also remove transaction from active subscriptions
        this.unsubscribePayment(swap);
        await this.removeSwapData(swap, ToBtcSwapAbs_1.ToBtcSwapState.REFUNDED);
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
        const cltv = this.config.minChainCltv + (BigInt(confirmations + confirmationTarget) * this.config.sendSafetyFactor);
        return this.config.gracePeriod + (this.config.bitcoinBlocktime * cltv * this.config.safetyFactor);
    }
    /**
     * Checks if the requested nonce is valid
     *
     * @param nonce
     * @throws {DefinedRuntimeError} will throw an error if the nonce is invalid
     */
    checkNonceValid(nonce) {
        if (nonce < 0 || nonce >= (2n ** 64n))
            throw {
                code: 20021,
                msg: "Invalid request body (nonce - cannot be parsed)"
            };
        const firstPart = nonce >> 24n;
        const maxAllowedValue = BigInt(Math.floor(Date.now() / 1000) - 600000000);
        if (firstPart > maxAllowedValue)
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
            parsedOutputScript = this.bitcoin.toOutputScript(address);
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
    async checkExpired(swap) {
        const { swapContract, signer } = this.getChain(swap.chainIdentifier);
        const isExpired = await swapContract.isExpired(signer.getAddress(), swap.data);
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
    async checkAndGetNetworkFee(address, amount) {
        let chainFeeResp = await this.bitcoin.estimateFee(address, Number(amount), null, this.config.networkFeeMultiplier);
        const hasEnoughFunds = chainFeeResp != null;
        if (!hasEnoughFunds)
            throw {
                code: 20002,
                msg: "Not enough liquidity"
            };
        return {
            networkFee: BigInt(chainFeeResp.networkFee),
            satsPerVbyte: BigInt(chainFeeResp.satsPerVbyte)
        };
    }
    startRestServer(restServer) {
        restServer.use(this.path + "/payInvoice", (0, ServerParamDecoder_1.serverParamDecoder)(10 * 1000));
        restServer.post(this.path + "/payInvoice", (0, Utils_1.expressHandlerWrapper)(async (req, res) => {
            const metadata = { request: {}, times: {} };
            const chainIdentifier = req.query.chain;
            const { swapContract, signer, chainInterface } = this.getChain(chainIdentifier);
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
            const parsedBody = await req.paramReader.getParams({
                address: SchemaVerifier_1.FieldTypeEnum.String,
                amount: SchemaVerifier_1.FieldTypeEnum.BigInt,
                confirmationTarget: SchemaVerifier_1.FieldTypeEnum.Number,
                confirmations: SchemaVerifier_1.FieldTypeEnum.Number,
                nonce: SchemaVerifier_1.FieldTypeEnum.BigInt,
                token: (val) => val != null &&
                    typeof (val) === "string" &&
                    this.isTokenSupported(chainIdentifier, val) ? val : null,
                offerer: (val) => val != null &&
                    typeof (val) === "string" &&
                    chainInterface.isValidAddress(val) ? val : null,
                exactIn: SchemaVerifier_1.FieldTypeEnum.BooleanOptional
            });
            if (parsedBody == null)
                throw {
                    code: 20100,
                    msg: "Invalid request body"
                };
            metadata.request = parsedBody;
            const requestedAmount = { input: !!parsedBody.exactIn, amount: parsedBody.amount, token: parsedBody.token };
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
            await this.checkVaultInitialized(chainIdentifier, parsedBody.token);
            const fees = await this.AmountAssertions.preCheckToBtcAmounts(this.type, request, requestedAmount);
            metadata.times.requestChecked = Date.now();
            //Initialize abort controller for the parallel async operations
            const abortController = (0, Utils_1.getAbortController)(responseStream);
            const { pricePrefetchPromise, signDataPrefetchPromise } = this.getToBtcPrefetches(chainIdentifier, useToken, responseStream, abortController);
            const { amountBD, networkFeeData, totalInToken, swapFee, swapFeeInToken, networkFeeInToken } = await this.AmountAssertions.checkToBtcAmount(this.type, request, { ...requestedAmount, pricePrefetch: pricePrefetchPromise }, fees, async (amount) => {
                metadata.times.amountsChecked = Date.now();
                const resp = await this.checkAndGetNetworkFee(parsedBody.address, amount);
                this.logger.debug("checkToBtcAmount(): network fee calculated, amount: " + amount.toString(10) + " fee: " + resp.networkFee.toString(10));
                metadata.times.chainFeeCalculated = Date.now();
                return resp;
            }, abortController.signal);
            metadata.times.priceCalculated = Date.now();
            const claimHash = this.getHash(chainIdentifier, parsedBody.address, parsedBody.confirmations, parsedBody.nonce, amountBD).toString("hex");
            //Add grace period another time, so the user has 1 hour to commit
            const expirySeconds = this.getExpiryFromCLTV(parsedBody.confirmationTarget, parsedBody.confirmations) + this.config.gracePeriod;
            const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
            const minRequiredExpiry = currentTimestamp + expirySeconds;
            const sequence = base_1.BigIntBufferUtils.fromBuffer((0, crypto_1.randomBytes)(8));
            const payObject = await swapContract.createSwapData(base_1.ChainSwapType.CHAIN_NONCED, parsedBody.offerer, signer.getAddress(), useToken, totalInToken, claimHash, sequence, minRequiredExpiry, true, false, 0n, 0n);
            abortController.signal.throwIfAborted();
            metadata.times.swapCreated = Date.now();
            const sigData = await this.getToBtcSignatureData(chainIdentifier, payObject, req, abortController.signal, signDataPrefetchPromise);
            metadata.times.swapSigned = Date.now();
            const createdSwap = new ToBtcSwapAbs_1.ToBtcSwapAbs(chainIdentifier, parsedBody.address, amountBD, swapFee, swapFeeInToken, networkFeeData.networkFee, networkFeeInToken, networkFeeData.satsPerVbyte, parsedBody.nonce, parsedBody.confirmations, parsedBody.confirmationTarget);
            createdSwap.data = payObject;
            createdSwap.metadata = metadata;
            createdSwap.prefix = sigData.prefix;
            createdSwap.timeout = sigData.timeout;
            createdSwap.signature = sigData.signature;
            createdSwap.feeRate = sigData.feeRate;
            await PluginManager_1.PluginManager.swapCreate(createdSwap);
            await this.saveSwapData(createdSwap);
            this.swapLogger.info(createdSwap, "REST: /payInvoice: created swap address: " + createdSwap.address + " amount: " + amountBD.toString(10));
            await responseStream.writeParamsAndEnd({
                code: 20000,
                msg: "Success",
                data: {
                    amount: amountBD.toString(10),
                    address: signer.getAddress(),
                    satsPervByte: networkFeeData.satsPerVbyte.toString(10),
                    networkFee: networkFeeInToken.toString(10),
                    swapFee: swapFeeInToken.toString(10),
                    totalFee: (swapFeeInToken + networkFeeInToken).toString(10),
                    total: totalInToken.toString(10),
                    minRequiredExpiry: minRequiredExpiry.toString(10),
                    data: payObject.serialize(),
                    prefix: sigData.prefix,
                    timeout: sigData.timeout,
                    signature: sigData.signature
                }
            });
        }));
        const getRefundAuthorization = (0, Utils_1.expressHandlerWrapper)(async (req, res) => {
            /**
             * paymentHash: string              Payment hash identifier of the swap
             * sequence: BN                     Sequence identifier of the swap
             */
            const parsedBody = (0, SchemaVerifier_1.verifySchema)({ ...req.body, ...req.query }, {
                paymentHash: (val) => val != null &&
                    typeof (val) === "string" &&
                    Utils_1.HEX_REGEX.test(val) ? val : null,
                sequence: SchemaVerifier_1.FieldTypeEnum.BigInt
            });
            if (parsedBody == null)
                throw {
                    code: 20100,
                    msg: "Invalid request body/query (paymentHash/sequence)"
                };
            this.checkSequence(parsedBody.sequence);
            const payment = await this.storageManager.getData(parsedBody.paymentHash, parsedBody.sequence);
            if (payment == null || payment.state === ToBtcSwapAbs_1.ToBtcSwapState.SAVED)
                throw {
                    _httpStatus: 200,
                    code: 20007,
                    msg: "Payment not found"
                };
            await this.checkExpired(payment);
            if (payment.state === ToBtcSwapAbs_1.ToBtcSwapState.COMMITED) {
                res.status(200).json({
                    code: 20008,
                    msg: "Payment processing"
                });
                return;
            }
            if (payment.state === ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENT || payment.state === ToBtcSwapAbs_1.ToBtcSwapState.BTC_SENDING) {
                res.status(200).json({
                    code: 20006,
                    msg: "Already paid",
                    data: {
                        txId: payment.txId
                    }
                });
                return;
            }
            const { swapContract, signer } = this.getChain(payment.chainIdentifier);
            if (payment.state === ToBtcSwapAbs_1.ToBtcSwapState.NON_PAYABLE) {
                const isCommited = await swapContract.isCommited(payment.data);
                if (!isCommited)
                    throw {
                        code: 20005,
                        msg: "Not committed"
                    };
                const refundResponse = await swapContract.getRefundSignature(signer, payment.data, this.config.refundAuthorizationTimeout);
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
        });
        restServer.post(this.path + "/getRefundAuthorization", getRefundAuthorization);
        restServer.get(this.path + "/getRefundAuthorization", getRefundAuthorization);
        this.logger.info("started at path: ", this.path);
    }
    /**
     * Starts watchdog checking sent bitcoin transactions
     */
    async startTxTimer() {
        let rerun;
        rerun = async () => {
            await this.processBtcTxs().catch(e => this.logger.error("startTxTimer(): call to processBtcTxs() errored", e));
            setTimeout(rerun, this.config.txCheckInterval);
        };
        await rerun();
    }
    async startWatchdog() {
        await super.startWatchdog();
        await this.startTxTimer();
    }
    async init() {
        await this.loadData(ToBtcSwapAbs_1.ToBtcSwapAbs);
        this.subscribeToEvents();
        await PluginManager_1.PluginManager.serviceInitialize(this);
    }
    getInfoData() {
        return {
            minCltv: Number(this.config.minChainCltv),
            minConfirmations: this.config.minConfirmations,
            maxConfirmations: this.config.maxConfirmations,
            minConfTarget: this.config.minConfTarget,
            maxConfTarget: this.config.maxConfTarget,
            maxOutputScriptLen: OUTPUT_SCRIPT_MAX_LENGTH
        };
    }
}
exports.ToBtcAbs = ToBtcAbs;
