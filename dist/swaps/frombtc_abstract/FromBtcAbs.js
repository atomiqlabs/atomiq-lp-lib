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
const FromBtcSwapAbs_1 = require("./FromBtcSwapAbs");
const SwapHandler_1 = require("../SwapHandler");
const base_1 = require("@atomiqlabs/base");
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
    constructor(storageDirectory, path, chains, bitcoin, swapPricing, config) {
        super(storageDirectory, path, chains, swapPricing);
        this.type = SwapHandler_1.SwapHandlerType.FROM_BTC;
        this.swapType = base_1.ChainSwapType.CHAIN;
        this.bitcoin = bitcoin;
        this.config = Object.assign(Object.assign({}, config), { swapTsCsvDelta: new BN(config.swapCsvDelta).mul(config.bitcoinBlocktime.div(config.safetyFactor)) });
    }
    /**
     * Returns the payment hash of the swap, takes swap nonce into account. Payment hash is chain-specific.
     *
     * @param chainIdentifier
     * @param address
     * @param amount
     */
    getHash(chainIdentifier, address, amount) {
        const parsedOutputScript = this.bitcoin.toOutputScript(address);
        const { swapContract } = this.getChain(chainIdentifier);
        return swapContract.getHashForOnchain(parsedOutputScript, amount, this.config.confirmations, new BN(0));
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
            const { swapContract, signer } = this.getChain(swap.chainIdentifier);
            //Once authorization expires in CREATED state, the user can no more commit it on-chain
            if (swap.state === FromBtcSwapAbs_1.FromBtcSwapState.CREATED) {
                if (!(yield swapContract.isInitAuthorizationExpired(swap.data, swap)))
                    return false;
                const isCommited = yield swapContract.isCommited(swap.data);
                if (isCommited) {
                    this.swapLogger.info(swap, "processPastSwap(state=CREATED): swap was commited, but processed from watchdog, address: " + swap.address);
                    yield swap.setState(FromBtcSwapAbs_1.FromBtcSwapState.COMMITED);
                    yield this.saveSwapData(swap);
                    return false;
                }
                this.swapLogger.info(swap, "processPastSwap(state=CREATED): removing past swap due to authorization expiry, address: " + swap.address);
                yield this.bitcoin.addUnusedAddress(swap.address);
                yield this.removeSwapData(swap, FromBtcSwapAbs_1.FromBtcSwapState.CANCELED);
                return false;
            }
            //Check if commited swap expired by now
            if (swap.state === FromBtcSwapAbs_1.FromBtcSwapState.COMMITED) {
                if (!(yield swapContract.isExpired(signer.getAddress(), swap.data)))
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
            for (let { obj: swap } of queriedData) {
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
    processInitializeEvent(chainIdentifier, savedSwap, event) {
        return __awaiter(this, void 0, void 0, function* () {
            this.swapLogger.info(savedSwap, "SC: InitializeEvent: swap initialized by the client, address: " + savedSwap.address);
            if (savedSwap.state === FromBtcSwapAbs_1.FromBtcSwapState.CREATED) {
                yield savedSwap.setState(FromBtcSwapAbs_1.FromBtcSwapState.COMMITED);
                yield this.saveSwapData(savedSwap);
            }
        });
    }
    processClaimEvent(chainIdentifier, savedSwap, event) {
        return __awaiter(this, void 0, void 0, function* () {
            savedSwap.txId = Buffer.from(event.result, "hex").reverse().toString("hex");
            this.swapLogger.info(savedSwap, "SC: ClaimEvent: swap successfully claimed by the client, address: " + savedSwap.address);
            yield this.removeSwapData(savedSwap, FromBtcSwapAbs_1.FromBtcSwapState.CLAIMED);
        });
    }
    processRefundEvent(chainIdentifier, savedSwap, event) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            savedSwap.txIds.refund = (_a = event.meta) === null || _a === void 0 ? void 0 : _a.txId;
            this.swapLogger.info(event, "SC: RefundEvent: swap refunded, address: " + savedSwap.address);
            yield this.bitcoin.addUnusedAddress(savedSwap.address);
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
        const dummyAmount = new BN((0, crypto_1.randomBytes)(3));
        return swapContract.createSwapData(base_1.ChainSwapType.CHAIN, signer.getAddress(), address, useToken, dummyAmount, swapContract.getHashForOnchain((0, crypto_1.randomBytes)(32), dummyAmount, 3, null).toString("hex"), new BN((0, crypto_1.randomBytes)(8)), new BN(Math.floor(Date.now() / 1000)).add(this.config.swapTsCsvDelta), false, true, new BN((0, crypto_1.randomBytes)(2)), new BN((0, crypto_1.randomBytes)(2)));
    }
    /**
     * Sets up required listeners for the REST server
     *
     * @param restServer
     */
    startRestServer(restServer) {
        restServer.use(this.path + "/getAddress", (0, ServerParamDecoder_1.serverParamDecoder)(10 * 1000));
        restServer.post(this.path + "/getAddress", (0, Utils_1.expressHandlerWrapper)((req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const metadata = { request: {}, times: {} };
            const chainIdentifier = (_a = req.query.chain) !== null && _a !== void 0 ? _a : this.chains.default;
            const { swapContract, signer } = this.getChain(chainIdentifier);
            const depositToken = (_b = req.query.depositToken) !== null && _b !== void 0 ? _b : swapContract.getNativeCurrencyAddress();
            this.checkAllowedDepositToken(chainIdentifier, depositToken);
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
            const { pricePrefetchPromise, gasTokenPricePrefetchPromise, depositTokenPricePrefetchPromise } = this.getFromBtcPricePrefetches(chainIdentifier, useToken, depositToken, abortController);
            const balancePrefetch = this.getBalancePrefetch(chainIdentifier, useToken, abortController);
            const signDataPrefetchPromise = this.getSignDataPrefetch(chainIdentifier, abortController, responseStream);
            const dummySwapData = yield this.getDummySwapData(chainIdentifier, useToken, parsedBody.address);
            abortController.signal.throwIfAborted();
            const baseSDPromise = this.getBaseSecurityDepositPrefetch(chainIdentifier, dummySwapData, depositToken, gasTokenPricePrefetchPromise, depositTokenPricePrefetchPromise, abortController);
            //Check valid amount specified (min/max)
            const { amountBD, swapFee, swapFeeInToken, totalInToken } = yield this.checkFromBtcAmount(request, requestedAmount, fees, useToken, abortController.signal, pricePrefetchPromise);
            metadata.times.priceCalculated = Date.now();
            //Check if we have enough funds to honor the request
            yield this.checkBalance(totalInToken, balancePrefetch, abortController.signal);
            metadata.times.balanceChecked = Date.now();
            //Create swap receive bitcoin address
            const receiveAddress = yield this.bitcoin.getAddress();
            abortController.signal.throwIfAborted();
            metadata.times.addressCreated = Date.now();
            const paymentHash = this.getHash(chainIdentifier, receiveAddress, amountBD);
            const currentTimestamp = new BN(Math.floor(Date.now() / 1000));
            const expiryTimeout = this.config.swapTsCsvDelta;
            const expiry = currentTimestamp.add(expiryTimeout);
            //Calculate security deposit
            const totalSecurityDeposit = yield this.getSecurityDeposit(chainIdentifier, amountBD, swapFee, expiryTimeout, baseSDPromise, depositToken, depositTokenPricePrefetchPromise, abortController.signal, metadata);
            metadata.times.securityDepositCalculated = Date.now();
            //Calculate claimer bounty
            const totalClaimerBounty = yield this.getClaimerBounty(req, expiry, abortController.signal);
            metadata.times.claimerBountyCalculated = Date.now();
            //Create swap data
            const data = yield swapContract.createSwapData(base_1.ChainSwapType.CHAIN, signer.getAddress(), parsedBody.address, useToken, totalInToken, paymentHash.toString("hex"), parsedBody.sequence, expiry, false, true, totalSecurityDeposit, totalClaimerBounty, depositToken);
            data.setExtraData(swapContract.getExtraData(this.bitcoin.toOutputScript(receiveAddress), amountBD, this.config.confirmations).toString("hex"));
            abortController.signal.throwIfAborted();
            metadata.times.swapCreated = Date.now();
            //Sign the swap
            const sigData = yield this.getFromBtcSignatureData(chainIdentifier, data, req, abortController.signal, signDataPrefetchPromise);
            metadata.times.swapSigned = Date.now();
            const createdSwap = new FromBtcSwapAbs_1.FromBtcSwapAbs(chainIdentifier, receiveAddress, this.config.confirmations, amountBD, swapFee, swapFeeInToken);
            createdSwap.data = data;
            createdSwap.metadata = metadata;
            createdSwap.prefix = sigData.prefix;
            createdSwap.timeout = sigData.timeout;
            createdSwap.signature = sigData.signature;
            createdSwap.feeRate = sigData.feeRate;
            yield PluginManager_1.PluginManager.swapCreate(createdSwap);
            yield this.saveSwapData(createdSwap);
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
                    confirmations: this.config.confirmations,
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
            yield this.loadData(FromBtcSwapAbs_1.FromBtcSwapAbs);
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
