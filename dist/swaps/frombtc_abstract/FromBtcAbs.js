"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcAbs = void 0;
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
        this.config = {
            ...config,
            swapTsCsvDelta: BigInt(config.swapCsvDelta) * (config.bitcoinBlocktime / config.safetyFactor)
        };
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
        return swapContract.getHashForOnchain(parsedOutputScript, amount, this.config.confirmations, 0n);
    }
    /**
     * Processes past swap
     *
     * @param swap
     * @protected
     * @returns true if the swap should be refunded, false if nothing should be done
     */
    async processPastSwap(swap) {
        const { swapContract, signer } = this.getChain(swap.chainIdentifier);
        //Once authorization expires in CREATED state, the user can no more commit it on-chain
        if (swap.state === FromBtcSwapAbs_1.FromBtcSwapState.CREATED) {
            if (!await swapContract.isInitAuthorizationExpired(swap.data, swap))
                return false;
            const isCommited = await swapContract.isCommited(swap.data);
            if (isCommited) {
                this.swapLogger.info(swap, "processPastSwap(state=CREATED): swap was commited, but processed from watchdog, address: " + swap.address);
                await swap.setState(FromBtcSwapAbs_1.FromBtcSwapState.COMMITED);
                await this.saveSwapData(swap);
                return false;
            }
            this.swapLogger.info(swap, "processPastSwap(state=CREATED): removing past swap due to authorization expiry, address: " + swap.address);
            await this.bitcoin.addUnusedAddress(swap.address);
            await this.removeSwapData(swap, FromBtcSwapAbs_1.FromBtcSwapState.CANCELED);
            return false;
        }
        //Check if commited swap expired by now
        if (swap.state === FromBtcSwapAbs_1.FromBtcSwapState.COMMITED) {
            if (!await swapContract.isExpired(signer.getAddress(), swap.data))
                return false;
            const isCommited = await swapContract.isCommited(swap.data);
            if (isCommited) {
                this.swapLogger.info(swap, "processPastSwap(state=COMMITED): swap expired, will refund, address: " + swap.address);
                return true;
            }
            this.swapLogger.warn(swap, "processPastSwap(state=COMMITED): commited swap expired and not committed anymore (already refunded?), address: " + swap.address);
            await this.removeSwapData(swap, FromBtcSwapAbs_1.FromBtcSwapState.CANCELED);
            return false;
        }
    }
    /**
     * Checks past swaps, refunds and deletes ones that are already expired.
     */
    async processPastSwaps() {
        const queriedData = await this.storageManager.query([
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
            if (await this.processPastSwap(swap))
                refundSwaps.push(swap);
        }
        await this.refundSwaps(refundSwaps);
    }
    /**
     * Refunds all swaps (calls SC on-chain refund function)
     *
     * @param refundSwaps
     * @protected
     */
    async refundSwaps(refundSwaps) {
        for (let refundSwap of refundSwaps) {
            const { swapContract, signer } = this.getChain(refundSwap.chainIdentifier);
            const unlock = refundSwap.lock(swapContract.refundTimeout);
            if (unlock == null)
                continue;
            this.swapLogger.debug(refundSwap, "refundSwaps(): initiate refund of swap");
            await swapContract.refund(signer, refundSwap.data, true, false, { waitForConfirmation: true });
            this.swapLogger.info(refundSwap, "refundSwaps(): swap refunded, address: " + refundSwap.address);
            //The swap should be removed by the event handler
            await refundSwap.setState(FromBtcSwapAbs_1.FromBtcSwapState.REFUNDED);
            unlock();
        }
    }
    async processInitializeEvent(chainIdentifier, savedSwap, event) {
        this.swapLogger.info(savedSwap, "SC: InitializeEvent: swap initialized by the client, address: " + savedSwap.address);
        if (savedSwap.state === FromBtcSwapAbs_1.FromBtcSwapState.CREATED) {
            await savedSwap.setState(FromBtcSwapAbs_1.FromBtcSwapState.COMMITED);
            await this.saveSwapData(savedSwap);
        }
    }
    async processClaimEvent(chainIdentifier, savedSwap, event) {
        savedSwap.txId = Buffer.from(event.result, "hex").reverse().toString("hex");
        this.swapLogger.info(savedSwap, "SC: ClaimEvent: swap successfully claimed by the client, address: " + savedSwap.address);
        await this.removeSwapData(savedSwap, FromBtcSwapAbs_1.FromBtcSwapState.CLAIMED);
    }
    async processRefundEvent(chainIdentifier, savedSwap, event) {
        savedSwap.txIds.refund = event.meta?.txId;
        this.swapLogger.info(event, "SC: RefundEvent: swap refunded, address: " + savedSwap.address);
        await this.bitcoin.addUnusedAddress(savedSwap.address);
        await this.removeSwapData(savedSwap, FromBtcSwapAbs_1.FromBtcSwapState.REFUNDED);
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
    async getClaimerBounty(req, expiry, signal) {
        const parsedClaimerBounty = await req.paramReader.getParams({
            claimerBounty: {
                feePerBlock: SchemaVerifier_1.FieldTypeEnum.BigInt,
                safetyFactor: SchemaVerifier_1.FieldTypeEnum.BigInt,
                startTimestamp: SchemaVerifier_1.FieldTypeEnum.BigInt,
                addBlock: SchemaVerifier_1.FieldTypeEnum.BigInt,
                addFee: SchemaVerifier_1.FieldTypeEnum.BigInt,
            },
        }).catch(e => null);
        signal.throwIfAborted();
        if (parsedClaimerBounty == null || parsedClaimerBounty.claimerBounty == null) {
            throw {
                code: 20043,
                msg: "Invalid claimerBounty"
            };
        }
        const tsDelta = expiry - parsedClaimerBounty.claimerBounty.startTimestamp;
        const blocksDelta = tsDelta / this.config.bitcoinBlocktime * parsedClaimerBounty.claimerBounty.safetyFactor;
        const totalBlock = blocksDelta + parsedClaimerBounty.claimerBounty.addBlock;
        return parsedClaimerBounty.claimerBounty.addFee + (totalBlock * parsedClaimerBounty.claimerBounty.feePerBlock);
    }
    getDummySwapData(chainIdentifier, useToken, address) {
        const { swapContract, signer } = this.getChain(chainIdentifier);
        const dummyAmount = BigInt(Math.floor(Math.random() * 0x1000000));
        return swapContract.createSwapData(base_1.ChainSwapType.CHAIN, signer.getAddress(), address, useToken, dummyAmount, swapContract.getHashForOnchain((0, crypto_1.randomBytes)(32), dummyAmount, 3, null).toString("hex"), base_1.BigIntBufferUtils.fromBuffer((0, crypto_1.randomBytes)(8)), BigInt(Math.floor(Date.now() / 1000)) + this.config.swapTsCsvDelta, false, true, BigInt(Math.floor(Math.random() * 0x10000)), BigInt(Math.floor(Math.random() * 0x10000)));
    }
    /**
     * Sets up required listeners for the REST server
     *
     * @param restServer
     */
    startRestServer(restServer) {
        restServer.use(this.path + "/getAddress", (0, ServerParamDecoder_1.serverParamDecoder)(10 * 1000));
        restServer.post(this.path + "/getAddress", (0, Utils_1.expressHandlerWrapper)(async (req, res) => {
            const metadata = { request: {}, times: {} };
            const chainIdentifier = req.query.chain ?? this.chains.default;
            const { swapContract, signer } = this.getChain(chainIdentifier);
            const depositToken = req.query.depositToken ?? swapContract.getNativeCurrencyAddress();
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
            const parsedBody = await req.paramReader.getParams({
                address: (val) => val != null &&
                    typeof (val) === "string" &&
                    swapContract.isValidAddress(val) ? val : null,
                amount: SchemaVerifier_1.FieldTypeEnum.BigInt,
                token: (val) => val != null &&
                    typeof (val) === "string" &&
                    this.isTokenSupported(chainIdentifier, val) ? val : null,
                sequence: SchemaVerifier_1.FieldTypeEnum.BigInt,
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
            const fees = await this.preCheckAmounts(request, requestedAmount, useToken);
            metadata.times.requestChecked = Date.now();
            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;
            const abortController = this.getAbortController(responseStream);
            //Pre-fetch data
            const { pricePrefetchPromise, gasTokenPricePrefetchPromise, depositTokenPricePrefetchPromise } = this.getFromBtcPricePrefetches(chainIdentifier, useToken, depositToken, abortController);
            const balancePrefetch = this.getBalancePrefetch(chainIdentifier, useToken, abortController);
            const signDataPrefetchPromise = this.getSignDataPrefetch(chainIdentifier, abortController, responseStream);
            const dummySwapData = await this.getDummySwapData(chainIdentifier, useToken, parsedBody.address);
            abortController.signal.throwIfAborted();
            const baseSDPromise = this.getBaseSecurityDepositPrefetch(chainIdentifier, dummySwapData, depositToken, gasTokenPricePrefetchPromise, depositTokenPricePrefetchPromise, abortController);
            //Check valid amount specified (min/max)
            const { amountBD, swapFee, swapFeeInToken, totalInToken } = await this.checkFromBtcAmount(request, requestedAmount, fees, useToken, abortController.signal, pricePrefetchPromise);
            metadata.times.priceCalculated = Date.now();
            //Check if we have enough funds to honor the request
            await this.checkBalance(totalInToken, balancePrefetch, abortController.signal);
            metadata.times.balanceChecked = Date.now();
            //Create swap receive bitcoin address
            const receiveAddress = await this.bitcoin.getAddress();
            abortController.signal.throwIfAborted();
            metadata.times.addressCreated = Date.now();
            const paymentHash = this.getHash(chainIdentifier, receiveAddress, amountBD);
            const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
            const expiryTimeout = this.config.swapTsCsvDelta;
            const expiry = currentTimestamp + expiryTimeout;
            //Calculate security deposit
            const totalSecurityDeposit = await this.getSecurityDeposit(chainIdentifier, amountBD, swapFee, expiryTimeout, baseSDPromise, depositToken, depositTokenPricePrefetchPromise, abortController.signal, metadata);
            metadata.times.securityDepositCalculated = Date.now();
            //Calculate claimer bounty
            const totalClaimerBounty = await this.getClaimerBounty(req, expiry, abortController.signal);
            metadata.times.claimerBountyCalculated = Date.now();
            //Create swap data
            const data = await swapContract.createSwapData(base_1.ChainSwapType.CHAIN, signer.getAddress(), parsedBody.address, useToken, totalInToken, paymentHash.toString("hex"), parsedBody.sequence, expiry, false, true, totalSecurityDeposit, totalClaimerBounty, depositToken);
            data.setExtraData(swapContract.getExtraData(this.bitcoin.toOutputScript(receiveAddress), amountBD, this.config.confirmations).toString("hex"));
            abortController.signal.throwIfAborted();
            metadata.times.swapCreated = Date.now();
            //Sign the swap
            const sigData = await this.getFromBtcSignatureData(chainIdentifier, data, req, abortController.signal, signDataPrefetchPromise);
            metadata.times.swapSigned = Date.now();
            const createdSwap = new FromBtcSwapAbs_1.FromBtcSwapAbs(chainIdentifier, receiveAddress, this.config.confirmations, amountBD, swapFee, swapFeeInToken);
            createdSwap.data = data;
            createdSwap.metadata = metadata;
            createdSwap.prefix = sigData.prefix;
            createdSwap.timeout = sigData.timeout;
            createdSwap.signature = sigData.signature;
            createdSwap.feeRate = sigData.feeRate;
            await PluginManager_1.PluginManager.swapCreate(createdSwap);
            await this.saveSwapData(createdSwap);
            this.swapLogger.info(createdSwap, "REST: /getAddress: Created swap address: " + receiveAddress + " amount: " + amountBD.toString(10));
            await responseStream.writeParamsAndEnd({
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
        }));
        this.logger.info("REST: Started at path: ", this.path);
    }
    /**
     * Initializes swap handler, loads data and subscribes to chain events
     */
    async init() {
        await this.loadData(FromBtcSwapAbs_1.FromBtcSwapAbs);
        this.subscribeToEvents();
        await PluginManager_1.PluginManager.serviceInitialize(this);
    }
    getInfoData() {
        return {
            confirmations: this.config.confirmations,
            cltv: this.config.swapCsvDelta,
            timestampCltv: Number(this.config.swapTsCsvDelta)
        };
    }
}
exports.FromBtcAbs = FromBtcAbs;
