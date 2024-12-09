import { SwapData } from "@atomiqlabs/base";
import { SwapHandlerSwap } from "./SwapHandlerSwap";
import * as BN from "bn.js";
export declare abstract class FromBtcBaseSwap<T extends SwapData, S = any> extends SwapHandlerSwap<T, S> {
    getInputAmount(): BN;
    abstract getTotalInputAmount(): BN;
    getOutputAmount(): BN;
    getSwapFee(): {
        inInputToken: BN;
        inOutputToken: BN;
    };
}
