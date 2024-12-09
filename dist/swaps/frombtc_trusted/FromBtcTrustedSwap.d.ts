import { SwapData } from "@atomiqlabs/base";
import { FromBtcBaseSwap } from "../FromBtcBaseSwap";
import * as BN from "bn.js";
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
    readonly sequence: BN;
    readonly btcAddress: string;
    readonly inputSats: BN;
    readonly dstAddress: string;
    readonly outputTokens: BN;
    readonly createdHeight: number;
    readonly expiresAt: number;
    readonly recommendedFee: number;
    refundAddress: string;
    adjustedInput: BN;
    adjustedOutput: BN;
    doubleSpent: boolean;
    scRawTx: string;
    rawTx: string;
    txFee: number;
    txSize: number;
    txId: string;
    vout: number;
    burnTxId: string;
    refundTxId: string;
    constructor(chainIdentifier: string, swapFee: BN, swapFeeInToken: BN, btcAddress: string, inputSats: BN, dstAddress: string, outputTokens: BN, createdHeight: number, expiresAt: number, recommendedFee: number, refundAddress: string);
    constructor(obj: any);
    serialize(): any;
    getHash(): string;
    getSequence(): BN;
    getOutputAmount(): BN;
    getTotalInputAmount(): BN;
    isFailed(): boolean;
    isInitiated(): boolean;
    isSuccess(): boolean;
}
