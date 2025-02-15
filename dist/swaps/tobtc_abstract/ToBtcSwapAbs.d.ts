import * as BN from "bn.js";
import { SwapData } from "@atomiqlabs/base";
import { ToBtcBaseSwap } from "../ToBtcBaseSwap";
export declare enum ToBtcSwapState {
    REFUNDED = -3,
    CANCELED = -2,
    NON_PAYABLE = -1,
    SAVED = 0,
    COMMITED = 1,
    BTC_SENDING = 2,
    BTC_SENT = 3,
    CLAIMED = 4
}
export declare class ToBtcSwapAbs<T extends SwapData = SwapData> extends ToBtcBaseSwap<T, ToBtcSwapState> {
    readonly address: string;
    readonly satsPerVbyte: BN;
    readonly nonce: BN;
    readonly requiredConfirmations: number;
    readonly preferedConfirmationTarget: number;
    txId: string;
    constructor(chainIdentifier: string, address: string, amount: BN, swapFee: BN, swapFeeInToken: BN, networkFee: BN, networkFeeInToken: BN, satsPerVbyte: BN, nonce: BN, requiredConfirmations: number, preferedConfirmationTarget: number);
    constructor(obj: any);
    serialize(): any;
    isInitiated(): boolean;
    isFailed(): boolean;
    isSuccess(): boolean;
}
