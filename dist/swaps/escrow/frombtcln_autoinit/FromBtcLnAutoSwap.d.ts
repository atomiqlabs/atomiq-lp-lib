import { SwapData } from "@atomiqlabs/base";
import { FromBtcBaseSwap } from "../FromBtcBaseSwap";
export declare enum FromBtcLnAutoSwapState {
    REFUNDED = -2,
    CANCELED = -1,
    CREATED = 0,
    RECEIVED = 1,
    TXS_SENT = 2,
    COMMITED = 3,
    CLAIMED = 4,
    SETTLED = 5
}
export declare class FromBtcLnAutoSwap<T extends SwapData = SwapData> extends FromBtcBaseSwap<T, FromBtcLnAutoSwapState> {
    readonly pr: string;
    readonly lnPaymentHash: string;
    readonly claimHash: string;
    readonly claimer: string;
    readonly token: string;
    readonly gasToken: string;
    readonly amountToken: bigint;
    readonly amountGasToken: bigint;
    readonly tokenSwapFee: bigint;
    readonly tokenSwapFeeInToken: bigint;
    readonly gasSwapFee: bigint;
    readonly gasSwapFeeInToken: bigint;
    readonly claimerBounty: bigint;
    secret: string;
    constructor(chainIdentifier: string, pr: string, lnPaymentHash: string, claimHash: string, amountMtokens: bigint, claimer: string, token: string, gasToken: string, amountToken: bigint, amountGasToken: bigint, tokenSwapFee: bigint, tokenSwapFeeInToken: bigint, gasSwapFee: bigint, gasSwapFeeInToken: bigint, claimerBounty: bigint);
    constructor(obj: any);
    serialize(): any;
    getClaimHash(): string;
    getIdentifierHash(): string;
    getOutputGasAmount(): bigint;
    getOutputAmount(): bigint;
    getTotalOutputAmount(): bigint;
    getTotalOutputGasAmount(): bigint;
    getSequence(): bigint;
    getSwapFee(): {
        inInputToken: bigint;
        inOutputToken: bigint;
    };
    getTokenSwapFee(): {
        inInputToken: bigint;
        inOutputToken: bigint;
    };
    getGasSwapFee(): {
        inInputToken: bigint;
        inOutputToken: bigint;
    };
    getToken(): string;
    getGasToken(): string;
    isInitiated(): boolean;
    isFailed(): boolean;
    isSuccess(): boolean;
}
