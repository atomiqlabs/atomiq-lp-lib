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
    lnPaymentHash: string;
    readonly claimer: string;
    readonly token: string;
    readonly totalTokens: BN;
    readonly claimHash: string;
    readonly securityDeposit: BN;
    readonly depositToken: string;
    secret: string;
    constructor(chainIdentifier: string, pr: string, lnPaymentHash: string, amountMtokens: BN, swapFee: BN, swapFeeInToken: BN, claimer: string, token: string, totalTokens: BN, claimHash: string, securityDeposit: BN, depositToken: string);
    constructor(obj: any);
    serialize(): any;
    getIdentifierHash(): string;
    getSequence(): BN;
    isInitiated(): boolean;
    isFailed(): boolean;
    isSuccess(): boolean;
}
