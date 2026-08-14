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
    sending: boolean;
    readonly address: string;
    readonly satsPerVbyte: number;
    readonly nonce: bigint;
    readonly requiredConfirmations: number;
    readonly preferedConfirmationTarget: number;
    btcRawTx: string;
    txId: string;
    readonly pastTxIds: {
        [btcTxId: string]: string;
    };
    constructor(chainIdentifier: string, address: string, amount: bigint, swapFee: bigint, swapFeeInToken: bigint, networkFee: bigint, networkFeeInToken: bigint, satsPerVbyte: number, nonce: bigint, requiredConfirmations: number, preferedConfirmationTarget: number);
    constructor(obj: any);
    serialize(): any;
    isInitiated(): boolean;
    isFailed(): boolean;
    isSuccess(): boolean;
    getDestinationAddress(): string;
}
