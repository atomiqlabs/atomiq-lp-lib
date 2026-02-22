import { Lockable, SpvVaultClaimEvent, SpvVaultCloseEvent, SpvVaultData, SpvVaultDepositEvent, SpvVaultOpenEvent, SpvVaultTokenBalance, SpvWithdrawalTransactionData, StorageObject } from "@atomiqlabs/base";
export declare enum SpvVaultState {
    CLOSED = -1,
    BTC_INITIATED = 0,
    BTC_CONFIRMED = 1,
    OPENED = 2
}
export declare class SpvVault<D extends SpvWithdrawalTransactionData = SpvWithdrawalTransactionData & {
    sending?: boolean;
}, T extends SpvVaultData = SpvVaultData> extends Lockable implements StorageObject {
    readonly chainId: string;
    readonly initialUtxo: string;
    readonly btcAddress: string;
    readonly pendingWithdrawals: D[];
    readonly replacedWithdrawals: Map<number, D[]>;
    data: T;
    state: SpvVaultState;
    balances: SpvVaultTokenBalance[];
    scOpenTxs: {
        [txId: string]: string;
    };
    constructor(chainId: string, vault: T, btcAddress: string);
    constructor(obj: any);
    update(event: SpvVaultOpenEvent | SpvVaultDepositEvent | SpvVaultCloseEvent | SpvVaultClaimEvent): void;
    addWithdrawal(withdrawalData: D): void;
    removeWithdrawal(withdrawalData: D): boolean;
    doubleSpendPendingWithdrawal(withdrawalData: D): boolean;
    toRawAmounts(amounts: bigint[]): bigint[];
    fromRawAmounts(rawAmounts: bigint[]): bigint[];
    /**
     * Returns the vault balance after processing all currently confirmed (at least 1 btc confirmation) withdrawals
     */
    getConfirmedBalance(): SpvVaultTokenBalance[];
    serialize(): any;
    static _getIdentifier(chainId: string, data: SpvVaultData): string;
    getIdentifier(): string;
    /**
     * Returns the latest vault utxo
     */
    getLatestUtxo(): string;
    /**
     * Returns whether the vault is ready for the next swap
     */
    isReady(): boolean;
}
