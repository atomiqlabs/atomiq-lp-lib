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
    readonly amount: BN;
    readonly satsPerVbyte: BN;
    readonly nonce: BN;
    readonly preferedConfirmationTarget: number;
    readonly signatureExpiry: BN;
    txId: string;
    constructor(chainIdentifier: string, address: string, amount: BN, swapFee: BN, swapFeeInToken: BN, networkFee: BN, networkFeeInToken: BN, satsPerVbyte: BN, nonce: BN, preferedConfirmationTarget: number, signatureExpiry: BN);
    constructor(obj: any);
    serialize(): any;
    isInitiated(): boolean;
    isFailed(): boolean;
    isSuccess(): boolean;
    getOutputAmount(): BN;
}
