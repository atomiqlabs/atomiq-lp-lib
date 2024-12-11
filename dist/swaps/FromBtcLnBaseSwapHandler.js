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
    checkInboundLiquidity(amountBD, channelsPrefetch, signal) {
        return __awaiter(this, void 0, void 0, function* () {
            const channelsResponse = yield channelsPrefetch;
            signal.throwIfAborted();
            let hasEnoughInboundLiquidity = false;
            channelsResponse.forEach(channel => {
                if (channel.remoteBalance.gte(amountBD))
                    hasEnoughInboundLiquidity = true;
            });
            if (!hasEnoughInboundLiquidity) {
                throw {
                    code: 20050,
                    msg: "Not enough LN inbound liquidity"
                };
            }
        });
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
