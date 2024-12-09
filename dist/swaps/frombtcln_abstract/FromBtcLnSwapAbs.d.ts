import * as BN from "bn.js";
import { SwapData } from "@atomiqlabs/base";
import { FromBtcBaseSwap } from "../FromBtcBaseSwap";
export declare enum FromBtcLnSwapState {
    REFUNDED = -2,
    CANCELED = -1,
    CREATED = 0,
    RECEIVED = 1,
    COMMITED = 2,
    CLAIMED = 3,
    SETTLED = 4
}
export declare class FromBtcLnSwapAbs<T extends SwapData = SwapData> extends FromBtcBaseSwap<T, FromBtcLnSwapState> {
    readonly pr: string;
    nonce: number;
    prefix: string;
    timeout: string;
    signature: string;
    feeRate: string;
    secret: string;
    constructor(chainIdentifier: string, pr: string, swapFee: BN, swapFeeInToken: BN);
    constructor(obj: any);
    serialize(): any;
    getSequence(): BN;
    isInitiated(): boolean;
    isFailed(): boolean;
    isSuccess(): boolean;
    getTotalInputAmount(): BN;
}
