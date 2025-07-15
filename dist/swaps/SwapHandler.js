"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapHandler = exports.SwapHandlerType = void 0;
const PluginManager_1 = require("../plugins/PluginManager");
const Utils_1 = require("../utils/Utils");
var SwapHandlerType;
(function (SwapHandlerType) {
    SwapHandlerType["TO_BTC"] = "TO_BTC";
    SwapHandlerType["FROM_BTC"] = "FROM_BTC";
    SwapHandlerType["TO_BTCLN"] = "TO_BTCLN";
    SwapHandlerType["FROM_BTCLN"] = "FROM_BTCLN";
    SwapHandlerType["FROM_BTCLN_TRUSTED"] = "FROM_BTCLN_TRUSTED";
    SwapHandlerType["FROM_BTC_TRUSTED"] = "FROM_BTC_TRUSTED";
    SwapHandlerType["FROM_BTC_SPV"] = "FROM_BTC_SPV";
    SwapHandlerType["FROM_BTCLN_AUTO"] = "FROM_BTCLN_AUTO";
})(SwapHandlerType = exports.SwapHandlerType || (exports.SwapHandlerType = {}));
/**
 * An abstract class defining a singular swap service
 */
class SwapHandler {
    constructor(storageDirectory, path, chainsData, swapPricing) {
        this.logger = (0, Utils_1.getLogger)(() => "SwapHandler(" + this.type + "): ");
        this.swapLogger = {
            debug: (swap, msg, ...args) => this.logger.debug(swap.getIdentifier() + ": " + msg, ...args),
            info: (swap, msg, ...args) => this.logger.info(swap.getIdentifier() + ": " + msg, ...args),
            warn: (swap, msg, ...args) => this.logger.warn(swap.getIdentifier() + ": " + msg, ...args),
            error: (swap, msg, ...args) => this.logger.error(swap.getIdentifier() + ": " + msg, ...args)
        };
        this.storageManager = storageDirectory;
        this.chains = chainsData;
        this.path = path;
        this.swapPricing = swapPricing;
        this.allowedTokens = {};
        for (let chainId in chainsData.chains) {
            this.allowedTokens[chainId] = new Set(chainsData.chains[chainId].allowedTokens);
        }
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
            await this.processPastSwaps().catch(e => this.logger.error("startWatchdog(): Error when processing past swaps: ", e));
            setTimeout(rerun, this.config.swapCheckInterval);
        };
        await rerun();
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
        await this.storageManager.removeData(swap.getIdentifierHash(), swap.getSequence());
    }
    async saveSwapData(swap) {
        await this.storageManager.saveData(swap.getIdentifierHash(), swap.getSequence(), swap);
    }
    /**
     * Checks if we have enough balance of the token in the swap vault
     *
     * @param totalInToken
     * @param balancePrefetch
     * @param signal
     * @throws {DefinedRuntimeError} will throw an error if there are not enough funds in the vault
     */
    async checkBalance(totalInToken, balancePrefetch, signal) {
        const balance = await balancePrefetch;
        if (signal != null)
            signal.throwIfAborted();
        if (balance == null || balance < totalInToken) {
            throw {
                code: 20002,
                msg: "Not enough liquidity"
            };
        }
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
            chainTokens
        };
    }
    getInitAuthorizationTimeout(chainIdentifier) {
        return this.config.initAuthorizationTimeouts?.[chainIdentifier] ?? this.config.initAuthorizationTimeout;
    }
}
exports.SwapHandler = SwapHandler;
