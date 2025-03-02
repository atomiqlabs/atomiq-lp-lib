"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcLnBaseSwapHandler = void 0;
const FromBtcBaseSwapHandler_1 = require("./FromBtcBaseSwapHandler");
class FromBtcLnBaseSwapHandler extends FromBtcBaseSwapHandler_1.FromBtcBaseSwapHandler {
    constructor(storageDirectory, path, chains, lightning, swapPricing) {
        super(storageDirectory, path, chains, swapPricing);
        this.lightning = lightning;
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
exports.FromBtcLnBaseSwapHandler = FromBtcLnBaseSwapHandler;
