import { SwapData } from "@atomiqlabs/base";
import { SwapHandlerSwap } from "./SwapHandlerSwap";
import * as BN from "bn.js";
export declare abstract class FromBtcBaseSwap<T extends SwapData, S = any> extends SwapHandlerSwap<T, S> {
    amount: BN;
    protected constructor(chainIdentifier: string, amount: BN, swapFee: BN, swapFeeInToken: BN);
    protected constructor(obj: any);
    getInputAmount(): BN;
    getTotalInputAmount(): BN;
    getOutputAmount(): BN;
    getSwapFee(): {
        inInputToken: BN;
        inOutputToken: BN;
    };
    serialize(): any;
}
