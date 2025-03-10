import { BtcTx, SwapData } from "@atomiqlabs/base";
import { FromBtcBaseSwap } from "../FromBtcBaseSwap";
export declare enum FromBtcTrustedSwapState {
    DOUBLE_SPENT = -4,
    REFUNDED = -3,
    REFUNDABLE = -2,
    EXPIRED = -1,
    CREATED = 0,
    RECEIVED = 1,
    BTC_CONFIRMED = 2,
    SENT = 3,
    CONFIRMED = 4,
    FINISHED = 5
}
export declare class FromBtcTrustedSwap<T extends SwapData = SwapData> extends FromBtcBaseSwap<T, FromBtcTrustedSwapState> {
    readonly sequence: bigint;
    readonly btcAddress: string;
    readonly dstAddress: string;
    readonly outputTokens: bigint;
    readonly createdHeight: number;
    readonly expiresAt: number;
    readonly recommendedFee: number;
    readonly token: string;
    refundAddress: string;
    adjustedInput: bigint;
    adjustedOutput: bigint;
    doubleSpent: boolean;
    scRawTx: string;
    btcTx: BtcTx;
    txFee: number;
    txSize: number;
    txId: string;
    vout: number;
    burnTxId: string;
    refundTxId: string;
    constructor(chainIdentifier: string, swapFee: bigint, swapFeeInToken: bigint, btcAddress: string, inputSats: bigint, dstAddress: string, outputTokens: bigint, createdHeight: number, expiresAt: number, recommendedFee: number, refundAddress: string, token: string);
    constructor(obj: any);
    serialize(): any;
    getClaimHash(): string;
    getSequence(): bigint;
    getToken(): string;
    getOutputAmount(): bigint;
    getTotalInputAmount(): bigint;
    isFailed(): boolean;
    isInitiated(): boolean;
    isSuccess(): boolean;
}
