"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapHandler = exports.SwapHandlerType = void 0;
const base_1 = require("@atomiqlabs/base");
const SwapHandlerSwap_1 = require("./SwapHandlerSwap");
const PluginManager_1 = require("../plugins/PluginManager");
const IPlugin_1 = require("../plugins/IPlugin");
var SwapHandlerType;
(function (SwapHandlerType) {
    SwapHandlerType["TO_BTC"] = "TO_BTC";
    SwapHandlerType["FROM_BTC"] = "FROM_BTC";
    SwapHandlerType["TO_BTCLN"] = "TO_BTCLN";
    SwapHandlerType["FROM_BTCLN"] = "FROM_BTCLN";
    SwapHandlerType["FROM_BTCLN_TRUSTED"] = "FROM_BTCLN_TRUSTED";
    SwapHandlerType["FROM_BTC_TRUSTED"] = "FROM_BTC_TRUSTED";
})(SwapHandlerType = exports.SwapHandlerType || (exports.SwapHandlerType = {}));
/**
 * An abstract class defining a singular swap service
 */
class SwapHandler {
    constructor(storageDirectory, path, chainsData, swapPricing) {
        this.escrowHashMap = new Map();
        this.logger = {
            debug: (msg, ...args) => console.debug("SwapHandler(" + this.type + "): " + msg, ...args),
            info: (msg, ...args) => console.info("SwapHandler(" + this.type + "): " + msg, ...args),
            warn: (msg, ...args) => console.warn("SwapHandler(" + this.type + "): " + msg, ...args),
            error: (msg, ...args) => console.error("SwapHandler(" + this.type + "): " + msg, ...args)
        };
        this.swapLogger = {
            debug: (swap, msg, ...args) => this.logger.debug(this.getIdentifier(swap) + ": " + msg, ...args),
            info: (swap, msg, ...args) => this.logger.info(this.getIdentifier(swap) + ": " + msg, ...args),
            warn: (swap, msg, ...args) => this.logger.warn(this.getIdentifier(swap) + ": " + msg, ...args),
            error: (swap, msg, ...args) => this.logger.error(this.getIdentifier(swap) + ": " + msg, ...args)
        };
        this.storageManager = storageDirectory;
        this.chains = chainsData;
        if (this.chains.chains[this.chains.default] == null)
            throw new Error("Invalid default chain specified");
        this.path = path;
        this.swapPricing = swapPricing;
        this.allowedTokens = {};
        for (let chainId in chainsData.chains) {
            this.allowedTokens[chainId] = new Set(chainsData.chains[chainId].allowedTokens);
        }
    }
    getDefaultChain() {
        return this.chains.chains[this.chains.default];
    }
    getChain(identifier) {
        if (this.chains.chains[identifier] == null)
            throw {
                code: 20200,
                msg: "Invalid chain specified!"
            };
        return this.chains.chains[identifier];
    }
    /**
     * Starts the watchdog checking past swaps for expiry or claim eligibility.
     */
    async startWatchdog() {
        let rerun;
        rerun = async () => {
            await this.processPastSwaps().catch(e => console.error(e));
            setTimeout(rerun, this.config.swapCheckInterval);
        };
        await rerun();
    }
    /**
     * Chain event processor
     *
     * @param chainIdentifier
     * @param eventData
     */
    async processEvent(chainIdentifier, eventData) {
        if (this.swapType == null)
            return true;
        for (let event of eventData) {
            if (event instanceof base_1.InitializeEvent) {
                if (event.swapType !== this.swapType)
                    continue;
                const swap = this.getSwapByEscrowHash(chainIdentifier, event.escrowHash);
                if (swap == null)
                    continue;
                swap.txIds.init = event.meta?.txId;
                if (swap.metadata != null)
                    swap.metadata.times.initTxReceived = Date.now();
                await this.processInitializeEvent(chainIdentifier, swap, event);
            }
            else if (event instanceof base_1.ClaimEvent) {
                const swap = this.getSwapByEscrowHash(chainIdentifier, event.escrowHash);
                if (swap == null)
                    continue;
                swap.txIds.claim = event.meta?.txId;
                if (swap.metadata != null)
                    swap.metadata.times.claimTxReceived = Date.now();
                await this.processClaimEvent(chainIdentifier, swap, event);
            }
            else if (event instanceof base_1.RefundEvent) {
                const swap = this.getSwapByEscrowHash(chainIdentifier, event.escrowHash);
                if (swap == null)
                    continue;
                swap.txIds.refund = event.meta?.txId;
                if (swap.metadata != null)
                    swap.metadata.times.refundTxReceived = Date.now();
                await this.processRefundEvent(chainIdentifier, swap, event);
            }
        }
        return true;
    }
    /**
     * Initializes chain events subscription
     */
    subscribeToEvents() {
        for (let key in this.chains.chains) {
            this.chains.chains[key].chainEvents.registerListener((events) => this.processEvent(key, events));
        }
        this.logger.info("SC: Events: subscribed to smartchain events");
    }
    async loadData(ctor) {
        await this.storageManager.loadData(ctor);
        //Check if all swaps contain a valid amount
        for (let { obj: swap, hash, sequence } of await this.storageManager.query([])) {
            if (hash !== swap.getIdentifierHash() || sequence !== (swap.getSequence() ?? 0n)) {
                this.swapLogger.info(swap, "loadData(): Swap storage key or sequence mismatch, fixing," +
                    " old hash: " + hash + " new hash: " + swap.getIdentifierHash() +
                    " old seq: " + sequence.toString(10) + " new seq: " + (swap.getSequence() ?? 0n).toString(10));
                await this.storageManager.removeData(hash, sequence);
                await this.storageManager.saveData(swap.getIdentifierHash(), swap.getSequence(), swap);
            }
            this.saveSwapToEscrowHashMap(swap);
        }
    }
    async removeSwapData(hashOrSwap, sequenceOrUltimateState) {
        let swap;
        if (typeof (hashOrSwap) === "string") {
            if (typeof (sequenceOrUltimateState) !== "bigint")
                throw new Error("Sequence must be a BN instance!");
            swap = await this.storageManager.getData(hashOrSwap, sequenceOrUltimateState);
        }
        else {
            swap = hashOrSwap;
            if (sequenceOrUltimateState != null && typeof (sequenceOrUltimateState) !== "bigint")
                await swap.setState(sequenceOrUltimateState);
        }
        if (swap != null)
            await PluginManager_1.PluginManager.swapRemove(swap);
        this.swapLogger.debug(swap, "removeSwapData(): removing swap final state: " + swap.state);
        this.removeSwapFromEscrowHashMap(swap);
        await this.storageManager.removeData(swap.getIdentifierHash(), swap.getSequence());
    }
    async saveSwapData(swap) {
        this.saveSwapToEscrowHashMap(swap);
        await this.storageManager.saveData(swap.getIdentifierHash(), swap.getSequence(), swap);
    }
    saveSwapToEscrowHashMap(swap) {
        if (swap.data != null)
            this.escrowHashMap.set(swap.chainIdentifier + "_" + swap.getEscrowHash(), swap);
    }
    removeSwapFromEscrowHashMap(swap) {
        if (swap.data != null)
            this.escrowHashMap.delete(swap.chainIdentifier + "_" + swap.data.getEscrowHash());
    }
    getSwapByEscrowHash(chainIdentifier, escrowHash) {
        return this.escrowHashMap.get(chainIdentifier + "_" + escrowHash);
    }
    /**
     * Checks whether the bitcoin amount is within specified min/max bounds
     *
     * @param amount
     * @protected
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    checkBtcAmountInBounds(amount) {
        if (amount < this.config.min) {
            throw {
                code: 20003,
                msg: "Amount too low!",
                data: {
                    min: this.config.min.toString(10),
                    max: this.config.max.toString(10)
                }
            };
        }
        if (amount > this.config.max) {
            throw {
                code: 20004,
                msg: "Amount too high!",
                data: {
                    min: this.config.min.toString(10),
                    max: this.config.max.toString(10)
                }
            };
        }
    }
    /**
     * Handles and throws plugin errors
     *
     * @param res Response as returned from the PluginManager.onHandlePost{To,From}BtcQuote
     * @protected
     * @throws {DefinedRuntimeError} will throw an error if the response is an error
     */
    handlePluginErrorResponses(res) {
        if ((0, IPlugin_1.isQuoteThrow)(res))
            throw {
                code: 29999,
                msg: res.message
            };
        if ((0, IPlugin_1.isQuoteAmountTooHigh)(res))
            throw {
                code: 20004,
                msg: "Amount too high!",
                data: {
                    min: res.data.min.toString(10),
                    max: res.data.max.toString(10)
                }
            };
        if ((0, IPlugin_1.isQuoteAmountTooLow)(res))
            throw {
                code: 20003,
                msg: "Amount too low!",
                data: {
                    min: res.data.min.toString(10),
                    max: res.data.max.toString(10)
                }
            };
    }
    /**
     * Creates an abort controller that extends the responseStream's abort signal
     *
     * @param responseStream
     */
    getAbortController(responseStream) {
        const abortController = new AbortController();
        if (responseStream == null || responseStream.getAbortSignal == null)
            return abortController;
        const responseStreamAbortController = responseStream.getAbortSignal();
        responseStreamAbortController.addEventListener("abort", () => abortController.abort(responseStreamAbortController.reason));
        return abortController;
    }
    /**
     * Starts a pre-fetch for signature data
     *
     * @param chainIdentifier
     * @param abortController
     * @param responseStream
     */
    getSignDataPrefetch(chainIdentifier, abortController, responseStream) {
        const { swapContract } = this.getChain(chainIdentifier);
        let signDataPrefetchPromise = swapContract.preFetchBlockDataForSignatures != null ? swapContract.preFetchBlockDataForSignatures().catch(e => {
            this.logger.error("getSignDataPrefetch(): signDataPrefetch: ", e);
            abortController.abort(e);
            return null;
        }) : null;
        if (signDataPrefetchPromise != null && responseStream != null) {
            signDataPrefetchPromise = signDataPrefetchPromise.then(val => val == null || abortController.signal.aborted ? null : responseStream.writeParams({
                signDataPrefetch: val
            }).then(() => val).catch(e => {
                this.logger.error("getSignDataPrefetch(): signDataPreFetch: error when sending sign data to the client: ", e);
                abortController.abort(e);
                return null;
            }));
        }
        return signDataPrefetchPromise;
    }
    getIdentifierFromEvent(event) {
        const foundSwap = this.escrowHashMap.get(event.escrowHash);
        if (foundSwap != null) {
            return foundSwap.getIdentifier();
        }
        return "UNKNOWN_" + event.escrowHash;
    }
    getIdentifierFromSwapData(swapData) {
        if (swapData.getSequence == null)
            return swapData.getClaimHash();
        return swapData.getClaimHash() + "_" + swapData.getSequence().toString(16);
    }
    getIdentifier(swap) {
        if (swap instanceof SwapHandlerSwap_1.SwapHandlerSwap) {
            return swap.getIdentifier();
        }
        if (swap instanceof base_1.SwapEvent) {
            return this.getIdentifierFromEvent(swap);
        }
        return this.getIdentifierFromSwapData(swap);
    }
    /**
     * Checks if the sequence number is between 0-2^64
     *
     * @param sequence
     * @throws {DefinedRuntimeError} will throw an error if sequence number is out of bounds
     */
    checkSequence(sequence) {
        if (sequence < 0n || sequence >= 2n ** 64n) {
            throw {
                code: 20060,
                msg: "Invalid sequence"
            };
        }
    }
    /**
     * Checks whether a given token is supported on a specified chain
     *
     * @param chainId
     * @param token
     * @protected
     */
    isTokenSupported(chainId, token) {
        const chainTokens = this.allowedTokens[chainId];
        if (chainTokens == null)
            return false;
        return chainTokens.has(token);
    }
    getInfo() {
        const chainTokens = {};
        for (let chainId in this.allowedTokens) {
            chainTokens[chainId] = Array.from(this.allowedTokens[chainId]);
        }
        return {
            swapFeePPM: Number(this.config.feePPM),
            swapBaseFee: Number(this.config.baseFee),
            min: Number(this.config.min),
            max: Number(this.config.max),
            data: this.getInfoData(),
            tokens: Array.from(this.allowedTokens[this.chains.default]),
            chainTokens
        };
    }
    getInitAuthorizationTimeout(chainIdentifier) {
        return this.config.initAuthorizationTimeouts?.[chainIdentifier] ?? this.config.initAuthorizationTimeout;
    }
}
exports.SwapHandler = SwapHandler;
