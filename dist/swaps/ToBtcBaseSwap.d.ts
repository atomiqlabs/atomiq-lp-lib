import { SwapHandlerSwap } from "./SwapHandlerSwap";
import { SwapData } from "@atomiqlabs/base";
import * as BN from "bn.js";
export declare abstract class ToBtcBaseSwap<T extends SwapData = SwapData, S = any> extends SwapHandlerSwap<T, S> {
    amount: BN;
    quotedNetworkFee: BN;
    readonly quotedNetworkFeeInToken: BN;
    realNetworkFee: BN;
    realNetworkFeeInToken: BN;
    protected constructor(chainIdentifier: string, amount: BN, swapFee: BN, swapFeeInToken: BN, quotedNetworkFee: BN, quotedNetworkFeeInToken: BN);
    protected constructor(obj: any);
    serialize(): any;
    setRealNetworkFee(networkFeeInBtc: BN): void;
    getInputAmount(): BN;
    getTotalInputAmount(): BN;
    getSwapFee(): {
        inInputToken: BN;
        inOutputToken: BN;
    };
    /**
     * Returns quoted (expected) network fee, denominated in input & output tokens (the fee is paid only once, it is
     *  just represented here in both denomination for ease of use)
     */
    getQuotedNetworkFee(): {
        inInputToken: BN;
        inOutputToken: BN;
    };
    /**
     * Returns real network fee paid for the swap, denominated in input & output tokens (the fee is paid only once, it is
     *  just represented here in both denomination for ease of use)
     */
    getRealNetworkFee(): {
        inInputToken: BN;
        inOutputToken: BN;
    };
    getOutputAmount(): BN;
}
