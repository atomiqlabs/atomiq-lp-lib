import { SwapHandlerSwap } from "../SwapHandlerSwap";
import { SpvVault } from "./SpvVault";
export declare enum SpvVaultSwapState {
    FAILED = -3,
    DOUBLE_SPENT = -2,
    EXPIRED = -1,
    CREATED = 0,
    SIGNED = 1,
    SENT = 2,
    BTC_CONFIRMED = 3,
    CLAIMED = 4
}
export declare class SpvVaultSwap extends SwapHandlerSwap<SpvVaultSwapState> {
    sending: boolean;
    readonly quoteId: string;
    readonly vaultOwner: string;
    readonly vaultId: bigint;
    readonly vaultUtxo: string;
    readonly vaultAddress: string;
    readonly expiry: number;
    readonly tokenMultiplier: bigint;
    readonly gasTokenMultiplier: bigint;
    readonly tokenSwapFee: bigint;
    readonly tokenSwapFeeInToken: bigint;
    readonly gasSwapFee: bigint;
    readonly gasSwapFeeInToken: bigint;
    readonly btcFeeRate: number;
    readonly btcAddress: string;
    readonly recipient: string;
    readonly amountBtc: bigint;
    readonly amountToken: bigint;
    readonly amountGasToken: bigint;
    readonly rawAmountToken: bigint;
    readonly rawAmountGasToken: bigint;
    readonly callerFeeShare: bigint;
    readonly frontingFeeShare: bigint;
    readonly executionFeeShare: bigint;
    readonly token: string;
    readonly gasToken: string;
    btcTxId: string;
    constructor(chainIdentifier: string, quoteId: string, expiry: number, vault: SpvVault, vaultUtxo: string, btcAddress: string, btcFeeRate: number, recipient: string, amountBtc: bigint, amountToken: bigint, amountGasToken: bigint, swapFee: bigint, swapFeeInToken: bigint, gasSwapFee: bigint, gasSwapFeeInToken: bigint, callerFeeShare: bigint, frontingFeeShare: bigint, executionFeeShare: bigint, token: string, gasToken: string);
    constructor(data: any);
    serialize(): any;
    getIdentifierHash(): string;
    getOutputGasAmount(): bigint;
    getOutputAmount(): bigint;
    getTotalOutputAmount(): bigint;
    getTotalOutputGasAmount(): bigint;
    getSequence(): bigint | null;
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
    getTotalInputAmount(): bigint;
    isFailed(): boolean;
    isInitiated(): boolean;
    isSuccess(): boolean;
}
