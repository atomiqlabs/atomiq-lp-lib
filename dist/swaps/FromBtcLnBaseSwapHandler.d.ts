import { SwapHandlerSwap } from "./SwapHandlerSwap";
import { SwapData } from "@atomiqlabs/base";
import { FromBtcBaseSwapHandler } from "./FromBtcBaseSwapHandler";
import * as BN from "bn.js";
export declare abstract class FromBtcLnBaseSwapHandler<V extends SwapHandlerSwap<SwapData, S>, S> extends FromBtcBaseSwapHandler<V, S> {
    /**
     * Checks if we have enough inbound liquidity to be able to receive an LN payment (without MPP)
     *
     * @param amountBD
     * @param channelsPrefetch
     * @param signal
     * @throws {DefinedRuntimeError} will throw an error if there isn't enough inbound liquidity to receive the LN payment
     */
    protected checkInboundLiquidity(amountBD: BN, channelsPrefetch: Promise<{
        channels: any[];
    }>, signal: AbortSignal): Promise<void>;
    /**
     * Starts LN channels pre-fetch
     *
     * @param abortController
     */
    protected getChannelsPrefetch(abortController: AbortController): Promise<{
        channels: any[];
    }>;
}
