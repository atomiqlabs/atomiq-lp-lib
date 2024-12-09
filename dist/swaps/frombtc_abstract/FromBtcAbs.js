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
exports.FromBtcAbs = void 0;
const BN = require("bn.js");
const lncli = require("ln-service");
const FromBtcSwapAbs_1 = require("./FromBtcSwapAbs");
const SwapHandler_1 = require("../SwapHandler");
const base_1 = require("@atomiqlabs/base");
const bitcoin = require("bitcoinjs-lib");
const crypto_1 = require("crypto");
const Utils_1 = require("../../utils/Utils");
const PluginManager_1 = require("../../plugins/PluginManager");
const SchemaVerifier_1 = require("../../utils/paramcoders/SchemaVerifier");
const ServerParamDecoder_1 = require("../../utils/paramcoders/server/ServerParamDecoder");
const FromBtcBaseSwapHandler_1 = require("../FromBtcBaseSwapHandler");
/**
 * Swap handler handling from BTC swaps using PTLCs (proof-time locked contracts) and btc relay (on-chain bitcoin SPV)
 */
class FromBtcAbs extends FromBtcBaseSwapHandler_1.FromBtcBaseSwapHandler {
    constructor(storageDirectory, path, chains, lnd, swapPricing, config) {
        super(storageDirectory, path, chains, lnd, swapPricing);
        this.type = SwapHandler_1.SwapHandlerType.FROM_BTC;
        const anyConfig = config;
        anyConfig.swapTsCsvDelta = new BN(config.swapCsvDelta).mul(config.bitcoinBlocktime.div(config.safetyFactor));
        this.config = anyConfig;
    }
    /**
     * Returns the TXO hash of the specific address and amount - sha256(u64le(amount) + outputScript(address))
     *
     * @param address
     * @param amount
     * @param bitcoinNetwork
     */
    getTxoHash(address, amount, bitcoinNetwork) {
        const parsedOutputScript = bitcoin.address.toOutputScript(address, bitcoinNetwork);
        return (0, crypto_1.createHash)("sha256").update(Buffer.concat([
            Buffer.from(amount.toArray("le", 8)),
            parsedOutputScript
        ])).digest();
    }
    /**
     * Returns the payment hash of the swap, takes swap nonce into account. Payment hash is chain-specific.
     *
     * @param chainIdentifier
     * @param address
     * @param amount
     */
    getHash(chainIdentifier, address, amount) {
        const parsedOutputScript = bitcoin.address.toOutputScript(address, this.config.bitcoinNetwork);
        const { swapContract } = this.getChain(chainIdentifier);
        return swapContract.getHashForOnchain(parsedOutputScript, amount, new BN(0));
    }
    /**
     * Processes past swap
     *
     * @param swap
     * @protected
     * @returns true if the swap should be refunded, false if nothing should be done
     */
    processPastSwap(swap) {
        return __awaiter(this, void 0, void 0, function* () {
            //Current time, minus maximum chain time skew
            const currentTime = new BN(Math.floor(Date.now() / 1000) - this.config.maxSkew);
            const { swapContract } = this.getChain(swap.chainIdentifier);
            //Once authorization expires in CREATED state, the user can no more commit it on-chain
            if (swap.state === FromBtcSwapAbs_1.FromBtcSwapState.CREATED) {
                const isExpired = swap.authorizationExpiry.lt(currentTime);
                if (!isExpired)
                    return false;
                const isCommited = yield swapContract.isCommited(swap.data);
                if (isCommited) {
                    this.swapLogger.info(swap, "processPastSwap(state=CREATED): swap was commited, but processed from watchdog, address: " + swap.address);
                    yield swap.setState(FromBtcSwapAbs_1.FromBtcSwapState.COMMITED);
                    yield this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
                    return false;
                }
                this.swapLogger.info(swap, "processPastSwap(state=CREATED): removing past swap due to authorization expiry, address: " + swap.address);
                yield this.removeSwapData(swap, FromBtcSwapAbs_1.FromBtcSwapState.CANCELED);
                return false;
            }
            const expiryTime = swap.data.getExpiry();
            //Check if commited swap expired by now
            if (swap.state === FromBtcSwapAbs_1.FromBtcSwapState.COMMITED) {
                const isExpired = expiryTime.lt(currentTime);
                if (!isExpired)
                    return false;
                const isCommited = yield swapContract.isCommited(swap.data);
                if (isCommited) {
                    this.swapLogger.info(swap, "processPastSwap(state=COMMITED): swap expired, will refund, address: " + swap.address);
                    return true;
                }
                this.swapLogger.warn(swap, "processPastSwap(state=COMMITED): commited swap expired and not committed anymore (already refunded?), address: " + swap.address);
                yield this.removeSwapData(swap, FromBtcSwapAbs_1.FromBtcSwapState.CANCELED);
                return false;
            }
        });
    }
    /**
     * Checks past swaps, refunds and deletes ones that are already expired.
     */
    processPastSwaps() {
        return __awaiter(this, void 0, void 0, function* () {
            const queriedData = yield this.storageManager.query([
                {
                    key: "state",
                    value: [
                        FromBtcSwapAbs_1.FromBtcSwapState.CREATED,
                        FromBtcSwapAbs_1.FromBtcSwapState.COMMITED
                    ]
                }
            ]);
            const refundSwaps = [];
            for (let swap of queriedData) {
                if (yield this.processPastSwap(swap))
                    refundSwaps.push(swap);
            }
            yield this.refundSwaps(refundSwaps);
        });
    }
    /**
     * Refunds all swaps (calls SC on-chain refund function)
     *
     * @param refundSwaps
     * @protected
     */
    refundSwaps(refundSwaps) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let refundSwap of refundSwaps) {
                const { swapContract, signer } = this.getChain(refundSwap.chainIdentifier);
                const unlock = refundSwap.lock(swapContract.refundTimeout);
                if (unlock == null)
                    continue;
                this.swapLogger.debug(refundSwap, "refundSwaps(): initiate refund of swap");
                yield swapContract.refund(signer, refundSwap.data, true, false, { waitForConfirmation: true });
                this.swapLogger.info(refundSwap, "refundSwaps(): swap refunded, address: " + refundSwap.address);
                //The swap should be removed by the event handler
                yield refundSwap.setState(FromBtcSwapAbs_1.FromBtcSwapState.REFUNDED);
                unlock();
            }
        });
    }
    processInitializeEvent(chainIdentifier, event) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            //Only process on-chain requests
            if (event.swapType !== base_1.ChainSwapType.CHAIN)
                return;
            const swapData = yield event.swapData();
            const { signer } = this.getChain(chainIdentifier);
            if (!swapData.isOfferer(signer.getAddress()))
                return;
            //Only process requests that don't pay in from the program
            if (swapData.isPayIn())
                return;
            const paymentHash = event.paymentHash;
            const savedSwap = yield this.storageManager.getData(paymentHash, event.sequence);
            if (savedSwap == null || savedSwap.chainIdentifier !== chainIdentifier)
                return;
            savedSwap.txIds.init = (_a = event.meta) === null || _a === void 0 ? void 0 : _a.txId;
            if (savedSwap.metadata != null)
                savedSwap.metadata.times.initTxReceived = Date.now();
            this.swapLogger.info(savedSwap, "SC: InitializeEvent: swap initialized by the client, address: " + savedSwap.address);
            if (savedSwap.state === FromBtcSwapAbs_1.FromBtcSwapState.CREATED) {
                yield savedSwap.setState(FromBtcSwapAbs_1.FromBtcSwapState.COMMITED);
                savedSwap.data = swapData;
                yield this.storageManager.saveData(paymentHash, event.sequence, savedSwap);
            }
        });
    }
    processClaimEvent(chainIdentifier, event) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            const paymentHashHex = event.paymentHash;
            const savedSwap = yield this.storageManager.getData(paymentHashHex, event.sequence);
            if (savedSwap == null || savedSwap.chainIdentifier !== chainIdentifier)
                return;
            savedSwap.txId = Buffer.from(event.secret, "hex").reverse().toString("hex");
            savedSwap.txIds.claim = (_a = event.meta) === null || _a === void 0 ? void 0 : _a.txId;
            if (savedSwap.metadata != null)
                savedSwap.metadata.times.claimTxReceived = Date.now();
            this.swapLogger.info(savedSwap, "SC: ClaimEvent: swap successfully claimed by the client, address: " + savedSwap.address);
            yield this.removeSwapData(savedSwap, FromBtcSwapAbs_1.FromBtcSwapState.CLAIMED);
        });
    }
    processRefundEvent(chainIdentifier, event) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            if (event.paymentHash == null)
                return;
            const savedSwap = yield this.storageManager.getData(event.paymentHash, event.sequence);
            if (savedSwap == null || savedSwap.chainIdentifier !== chainIdentifier)
                return;
            savedSwap.txIds.refund = (_a = event.meta) === null || _a === void 0 ? void 0 : _a.txId;
            this.swapLogger.info(event, "SC: RefundEvent: swap refunded, address: " + savedSwap.address);
            yield this.removeSwapData(savedSwap, FromBtcSwapAbs_1.FromBtcSwapState.REFUNDED);
        });
    }
    /**
     * Calculates the requested claimer bounty, based on client's request
     *
     * @param req
     * @param expiry
     * @param signal
     * @throws {DefinedRuntimeError} will throw an error if the plugin cancelled the request
     * @returns {Promise<BN>} resulting claimer bounty to be used with the swap
     */
    getClaimerBounty(req, expiry, signal) {
        return __awaiter(this, void 0, void 0, function* () {
            const parsedClaimerBounty = yield req.paramReader.getParams({
                claimerBounty: {
                    feePerBlock: SchemaVerifier_1.FieldTypeEnum.BN,
                    safetyFactor: SchemaVerifier_1.FieldTypeEnum.BN,
                    startTimestamp: SchemaVerifier_1.FieldTypeEnum.BN,
                    addBlock: SchemaVerifier_1.FieldTypeEnum.BN,
                    addFee: SchemaVerifier_1.FieldTypeEnum.BN,
                },
            }).catch(e => null);
            signal.throwIfAborted();
            if (parsedClaimerBounty == null || parsedClaimerBounty.claimerBounty == null) {
                throw {
                    code: 20043,
                    msg: "Invalid claimerBounty"
                };
            }
            const tsDelta = expiry.sub(parsedClaimerBounty.claimerBounty.startTimestamp);
            const blocksDelta = tsDelta.div(this.config.bitcoinBlocktime).mul(parsedClaimerBounty.claimerBounty.safetyFactor);
            const totalBlock = blocksDelta.add(parsedClaimerBounty.claimerBounty.addBlock);
            return parsedClaimerBounty.claimerBounty.addFee.add(totalBlock.mul(parsedClaimerBounty.claimerBounty.feePerBlock));
        });
    }
    getDummySwapData(chainIdentifier, useToken, address) {
        const { swapContract, signer } = this.getChain(chainIdentifier);
        return swapContract.createSwapData(base_1.ChainSwapType.CHAIN, signer.getAddress(), address, useToken, null, null, null, null, new BN(0), this.config.confirmations, false, true, null, null);
    }
    /**
     * Sets up required listeners for the REST server
     *
     * @param restServer
     */
    startRestServer(restServer) {
        restServer.use(this.path + "/getAddress", (0, ServerParamDecoder_1.serverParamDecoder)(10 * 1000));
        restServer.post(this.path + "/getAddress", (0, Utils_1.expressHandlerWrapper)((req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const metadata = { request: {}, times: {} };
            const chainIdentifier = (_a = req.query.chain) !== null && _a !== void 0 ? _a : this.chains.default;
            const { swapContract, signer } = this.getChain(chainIdentifier);
            metadata.times.requestReceived = Date.now();
            /**
             * address: string              solana address of the recipient
             * amount: string               amount (in sats) of the invoice
             * token: string                Desired token to use
             * exactOut: boolean            Whether the swap should be an exact out instead of exact in swap
             * sequence: BN                 Unique sequence number for the swap
             *
             *Sent later
             * claimerBounty: object        Data for calculating claimer bounty
             *  - feePerBlock: string           Fee per block to be synchronized with btc relay
             *  - safetyFactor: number          Safety factor to multiply required blocks (when using 10 min block time)
             *  - startTimestamp: string        UNIX seconds used for timestamp delta calc
             *  - addBlock: number              Additional blocks to add to the calculation
             *  - addFee: string                Additional fee to add to the final claimer bounty
             * feeRate: string              Fee rate to be used for init signature
             */
            const parsedBody = yield req.paramReader.getParams({
                address: (val) => val != null &&
                    typeof (val) === "string" &&
                    swapContract.isValidAddress(val) ? val : null,
                amount: SchemaVerifier_1.FieldTypeEnum.BN,
                token: (val) => val != null &&
                    typeof (val) === "string" &&
                    this.isTokenSupported(chainIdentifier, val) ? val : null,
                sequence: SchemaVerifier_1.FieldTypeEnum.BN,
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
            this.checkSequence(parsedBody.sequence);
            const fees = yield this.preCheckAmounts(request, requestedAmount, useToken);
            metadata.times.requestChecked = Date.now();
            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;
            const abortController = this.getAbortController(responseStream);
            //Pre-fetch data
            const { pricePrefetchPromise, securityDepositPricePrefetchPromise } = this.getFromBtcPricePrefetches(chainIdentifier, useToken, abortController);
            const balancePrefetch = this.getBalancePrefetch(chainIdentifier, useToken, abortController);
            const signDataPrefetchPromise = this.getSignDataPrefetch(chainIdentifier, abortController, responseStream);
            const dummySwapData = yield this.getDummySwapData(chainIdentifier, useToken, parsedBody.address);
            abortController.signal.throwIfAborted();
            const baseSDPromise = this.getBaseSecurityDepositPrefetch(chainIdentifier, dummySwapData, abortController);
            //Check valid amount specified (min/max)
            const { amountBD, swapFee, swapFeeInToken, totalInToken } = yield this.checkFromBtcAmount(request, requestedAmount, fees, useToken, abortController.signal, pricePrefetchPromise);
            metadata.times.priceCalculated = Date.now();
            //Check if we have enough funds to honor the request
            yield this.checkBalance(totalInToken, balancePrefetch, abortController.signal);
            metadata.times.balanceChecked = Date.now();
            //Create swap receive bitcoin address
            const { address: receiveAddress } = yield lncli.createChainAddress({
                lnd: this.LND,
                format: "p2wpkh"
            });
            abortController.signal.throwIfAborted();
            metadata.times.addressCreated = Date.now();
            const paymentHash = this.getHash(chainIdentifier, receiveAddress, amountBD);
            const currentTimestamp = new BN(Math.floor(Date.now() / 1000));
            const expiryTimeout = this.config.swapTsCsvDelta;
            const expiry = currentTimestamp.add(expiryTimeout);
            //Calculate security deposit
            const totalSecurityDeposit = yield this.getSecurityDeposit(chainIdentifier, amountBD, swapFee, expiryTimeout, baseSDPromise, securityDepositPricePrefetchPromise, abortController.signal, metadata);
            metadata.times.securityDepositCalculated = Date.now();
            //Calculate claimer bounty
            const totalClaimerBounty = yield this.getClaimerBounty(req, expiry, abortController.signal);
            metadata.times.claimerBountyCalculated = Date.now();
            //Create swap data
            const data = yield swapContract.createSwapData(base_1.ChainSwapType.CHAIN, signer.getAddress(), parsedBody.address, useToken, totalInToken, paymentHash.toString("hex"), parsedBody.sequence, expiry, new BN(0), this.config.confirmations, false, true, totalSecurityDeposit, totalClaimerBounty);
            data.setTxoHash(this.getTxoHash(receiveAddress, amountBD, this.config.bitcoinNetwork).toString("hex"));
            abortController.signal.throwIfAborted();
            metadata.times.swapCreated = Date.now();
            //Sign the swap
            const sigData = yield this.getFromBtcSignatureData(chainIdentifier, data, req, abortController.signal, signDataPrefetchPromise);
            metadata.times.swapSigned = Date.now();
            const createdSwap = new FromBtcSwapAbs_1.FromBtcSwapAbs(chainIdentifier, receiveAddress, amountBD, swapFee, swapFeeInToken);
            createdSwap.data = data;
            createdSwap.metadata = metadata;
            createdSwap.authorizationExpiry = new BN(sigData.timeout);
            yield PluginManager_1.PluginManager.swapCreate(createdSwap);
            yield this.storageManager.saveData(createdSwap.data.getHash(), createdSwap.data.getSequence(), createdSwap);
            this.swapLogger.info(createdSwap, "REST: /getAddress: Created swap address: " + receiveAddress + " amount: " + amountBD.toString(10));
            yield responseStream.writeParamsAndEnd({
                code: 20000,
                msg: "Success",
                data: {
                    amount: amountBD.toString(10),
                    btcAddress: receiveAddress,
                    address: signer.getAddress(),
                    swapFee: swapFeeInToken.toString(10),
                    total: totalInToken.toString(10),
                    data: data.serialize(),
                    prefix: sigData.prefix,
                    timeout: sigData.timeout,
                    signature: sigData.signature
                }
            });
        })));
        this.logger.info("REST: Started at path: ", this.path);
    }
    /**
     * Initializes swap handler, loads data and subscribes to chain events
     */
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.storageManager.loadData(FromBtcSwapAbs_1.FromBtcSwapAbs);
            this.subscribeToEvents();
            yield PluginManager_1.PluginManager.serviceInitialize(this);
        });
    }
    getInfoData() {
        return {
            confirmations: this.config.confirmations,
            cltv: this.config.swapCsvDelta,
            timestampCltv: this.config.swapTsCsvDelta.toNumber()
        };
    }
}
exports.FromBtcAbs = FromBtcAbs;
