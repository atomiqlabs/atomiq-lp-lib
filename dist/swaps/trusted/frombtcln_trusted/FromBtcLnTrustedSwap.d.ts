import { SwapHandlerSwap } from "../../SwapHandlerSwap";
export declare enum FromBtcLnTrustedSwapState {
    REFUNDED = -2,
    CANCELED = -1,
    CREATED = 0,
    RECEIVED = 1,
    SENT = 2,
    CONFIRMED = 3,
    SETTLED = 4
}
export declare class FromBtcLnTrustedSwap extends SwapHandlerSwap<FromBtcLnTrustedSwapState> {
    readonly pr: string;
    amount: bigint;
    readonly output: bigint;
    readonly dstAddress: string;
    readonly secret: string;
    readonly token: string;
    scRawTx: string;
    constructor(chainIdentifier: string, pr: string, inputMtokens: bigint, swapFee: bigint, swapFeeInToken: bigint, output: bigint, secret: string, dstAddress: string, token: string);
    constructor(obj: any);
    getToken(): string;
    getOutputAmount(): bigint;
    getSwapFee(): {
        inInputToken: bigint;
        inOutputToken: bigint;
    };
    getTotalInputAmount(): bigint;
    getSequence(): bigint;
    serialize(): any;
    isFailed(): boolean;
    isInitiated(): boolean;
    isSuccess(): boolean;
    getIdentifierHash(): string;
}
