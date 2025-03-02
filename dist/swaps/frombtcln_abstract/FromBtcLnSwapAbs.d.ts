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
    lnPaymentHash: string;
    readonly claimer: string;
    readonly token: string;
    readonly totalTokens: bigint;
    readonly claimHash: string;
    readonly securityDeposit: bigint;
    readonly depositToken: string;
    secret: string;
    constructor(chainIdentifier: string, pr: string, lnPaymentHash: string, amountMtokens: bigint, swapFee: bigint, swapFeeInToken: bigint, claimer: string, token: string, totalTokens: bigint, claimHash: string, securityDeposit: bigint, depositToken: string);
    constructor(obj: any);
    serialize(): any;
    getIdentifierHash(): string;
    getSequence(): bigint;
    isInitiated(): boolean;
    isFailed(): boolean;
    isSuccess(): boolean;
}
