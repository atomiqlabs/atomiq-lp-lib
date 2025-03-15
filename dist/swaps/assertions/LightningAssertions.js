"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LightningAssertions = void 0;
class LightningAssertions {
    constructor(logger, lightning) {
        this.LIGHTNING_LIQUIDITY_CACHE_TIMEOUT = 5 * 1000;
        this.logger = logger;
        this.lightning = lightning;
    }
    /**
     * Checks if the prior payment with the same paymentHash exists
     *
     * @param paymentHash
     * @param abortSignal
     * @throws {DefinedRuntimeError} will throw an error if payment already exists
     */
    async checkPriorPayment(paymentHash, abortSignal) {
        const payment = await this.lightning.getPayment(paymentHash);
        if (payment != null)
            throw {
                code: 20010,
                msg: "Already processed"
            };
        abortSignal.throwIfAborted();
    }
    /**
     * Checks if the underlying LND backend has enough liquidity in channels to honor the swap
     *
     * @param amount
     * @param abortSignal
     * @param useCached Whether to use cached liquidity values
     * @throws {DefinedRuntimeError} will throw an error if there isn't enough liquidity
     */
    async checkLiquidity(amount, abortSignal, useCached = false) {
        if (!useCached || this.lightningLiquidityCache == null || this.lightningLiquidityCache.timestamp < Date.now() - this.LIGHTNING_LIQUIDITY_CACHE_TIMEOUT) {
            const channelBalances = await this.lightning.getLightningBalance();
            this.lightningLiquidityCache = {
                liquidity: channelBalances.localBalance,
                timestamp: Date.now()
            };
        }
        if (amount > this.lightningLiquidityCache.liquidity) {
            throw {
                code: 20002,
                msg: "Not enough liquidity"
            };
        }
        abortSignal.throwIfAborted();
    }
    /**
     * Checks if we have enough inbound liquidity to be able to receive an LN payment (without MPP)
     *
     * @param amountBD
     * @param channelsPrefetch
     * @param signal
     * @throws {DefinedRuntimeError} will throw an error if there isn't enough inbound liquidity to receive the LN payment
     */
    async checkInboundLiquidity(amountBD, channelsPrefetch, signal) {
        const channelsResponse = await channelsPrefetch;
        signal.throwIfAborted();
        let hasEnoughInboundLiquidity = false;
        channelsResponse.forEach(channel => {
            if (channel.remoteBalance >= amountBD)
                hasEnoughInboundLiquidity = true;
        });
        if (!hasEnoughInboundLiquidity) {
            throw {
                code: 20050,
                msg: "Not enough LN inbound liquidity"
            };
        }
    }
    /**
     * Starts LN channels pre-fetch
     *
     * @param abortController
     */
    getChannelsPrefetch(abortController) {
        return this.lightning.getChannels(true).catch(e => {
            this.logger.error("getChannelsPrefetch(): error", e);
            abortController.abort(e);
            return null;
        });
    }
}
exports.LightningAssertions = LightningAssertions;
