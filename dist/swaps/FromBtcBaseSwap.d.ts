import { SwapData } from "@atomiqlabs/base";
import { SwapHandlerSwap } from "./SwapHandlerSwap";
export declare abstract class FromBtcBaseSwap<T extends SwapData, S = any> extends SwapHandlerSwap<T, S> {
    amount: bigint;
    protected constructor(chainIdentifier: string, amount: bigint, swapFee: bigint, swapFeeInToken: bigint);
    protected constructor(obj: any);
    getInputAmount(): bigint;
    getTotalInputAmount(): bigint;
    getOutputAmount(): bigint;
    getSwapFee(): {
        inInputToken: bigint;
        inOutputToken: bigint;
    };
    serialize(): any;
}
