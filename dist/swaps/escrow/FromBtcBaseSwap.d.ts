import { EscrowHandlerSwap } from "./EscrowHandlerSwap";
import { SwapData } from "@atomiqlabs/base";
export declare abstract class FromBtcBaseSwap<T extends SwapData = SwapData, S = any> extends EscrowHandlerSwap<T, S> {
    amount: bigint;
    protected constructor(chainIdentifier: string, amount: bigint, swapFee: bigint, swapFeeInToken: bigint);
    protected constructor(obj: any);
    getTotalInputAmount(): bigint;
    getOutputAmount(): bigint;
    getSwapFee(): {
        inInputToken: bigint;
        inOutputToken: bigint;
    };
    serialize(): any;
}
