import * as BN from "bn.js";
import { SwapData } from "@atomiqlabs/base";
import { ToBtcBaseSwap } from "../ToBtcBaseSwap";
export declare enum ToBtcLnSwapState {
    REFUNDED = -3,
    CANCELED = -2,
    NON_PAYABLE = -1,
    SAVED = 0,
    COMMITED = 1,
    PAID = 2,
    CLAIMED = 3
}
export declare class ToBtcLnSwapAbs<T extends SwapData = SwapData> extends ToBtcBaseSwap<T, ToBtcLnSwapState> {
    readonly pr: string;
    readonly signatureExpiry: BN;
    secret: string;
    constructor(chainIdentifier: string, pr: string, swapFee: BN, swapFeeInToken: BN, quotedNetworkFee: BN, quotedNetworkFeeInToken: BN, signatureExpiry: BN);
    constructor(obj: any);
    serialize(): any;
    isInitiated(): boolean;
    isFailed(): boolean;
    isSuccess(): boolean;
    getOutputAmount(): BN;
}
