import { SwapData } from "@atomiqlabs/base";
import { FromBtcBaseSwap } from "../FromBtcBaseSwap";
export declare enum FromBtcSwapState {
    REFUNDED = -2,
    CANCELED = -1,
    CREATED = 0,
    COMMITED = 1,
    CLAIMED = 2
}
export declare class FromBtcSwapAbs<T extends SwapData = SwapData> extends FromBtcBaseSwap<T, FromBtcSwapState> {
    readonly address: string;
    readonly confirmations: number;
    txId: string;
    constructor(chainIdentifier: string, address: string, confirmations: number, amount: bigint, swapFee: bigint, swapFeeInToken: bigint);
    constructor(obj: any);
    serialize(): any;
    isInitiated(): boolean;
    isFailed(): boolean;
    isSuccess(): boolean;
    getTotalInputAmount(): bigint;
}
