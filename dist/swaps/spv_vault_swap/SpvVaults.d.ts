import { SpvVault } from "./SpvVault";
import { BitcoinRpc, IStorageManager, SpvVaultClaimEvent, SpvVaultCloseEvent, SpvVaultDepositEvent, SpvVaultOpenEvent, SpvWithdrawalTransactionData } from "@atomiqlabs/base";
import { SpvVaultSwap } from "./SpvVaultSwap";
import { IBitcoinWallet } from "../../wallets/IBitcoinWallet";
import { ISpvVaultSigner } from "../../wallets/ISpvVaultSigner";
import { ChainData } from "../SwapHandler";
export declare const VAULT_DUST_AMOUNT = 600;
export declare class SpvVaults {
    readonly vaultStorage: IStorageManager<SpvVault>;
    readonly bitcoin: IBitcoinWallet;
    readonly vaultSigner: ISpvVaultSigner;
    readonly bitcoinRpc: BitcoinRpc<any>;
    readonly config: {
        vaultsCheckInterval: number;
        maxUnclaimedWithdrawals?: number;
    };
    readonly getChain: (chainId: string) => ChainData;
    readonly logger: {
        debug: (msg: string, ...args: any) => void;
        info: (msg: string, ...args: any) => void;
        warn: (msg: string, ...args: any) => void;
        error: (msg: string, ...args: any) => void;
    };
    constructor(vaultStorage: IStorageManager<SpvVault>, bitcoin: IBitcoinWallet, vaultSigner: ISpvVaultSigner, bitcoinRpc: BitcoinRpc<any>, getChain: (chainId: string) => ChainData, config: {
        vaultsCheckInterval: number;
        maxUnclaimedWithdrawals?: number;
    });
    processDepositEvent(vault: SpvVault, event: SpvVaultDepositEvent): Promise<void>;
    processOpenEvent(vault: SpvVault, event: SpvVaultOpenEvent): Promise<void>;
    processCloseEvent(vault: SpvVault, event: SpvVaultCloseEvent): Promise<void>;
    processClaimEvent(vault: SpvVault, swap: SpvVaultSwap | null, event: SpvVaultClaimEvent): Promise<void>;
    createVaults(chainId: string, count: number, token: string, confirmations?: number, feeRate?: number): Promise<{
        vaultsCreated: bigint[];
        btcTxId: string;
    }>;
    listVaults(chainId?: string, token?: string): Promise<SpvVault<SpvWithdrawalTransactionData, import("@atomiqlabs/base").SpvVaultData<SpvWithdrawalTransactionData>>[]>;
    fundVault(vault: SpvVault, tokenAmounts: bigint[]): Promise<string>;
    withdrawFromVault(vault: SpvVault, tokenAmounts: bigint[], feeRate?: number): Promise<string>;
    checkVaults(): Promise<void>;
    claimWithdrawals(vault: SpvVault, withdrawal: SpvWithdrawalTransactionData[]): Promise<boolean>;
    getVault(chainId: string, owner: string, vaultId: bigint): Promise<SpvVault<SpvWithdrawalTransactionData, import("@atomiqlabs/base").SpvVaultData<SpvWithdrawalTransactionData>>>;
    /**
     * Returns a ready-to-use vault for a specific request
     *
     * @param chainIdentifier
     * @param token
     * @param amount
     * @param gasToken
     * @param gasTokenAmount
     * @protected
     */
    findVaultForSwap(chainIdentifier: string, token: string, amount: bigint, gasToken: string, gasTokenAmount: bigint): Promise<SpvVault<SpvWithdrawalTransactionData> | null>;
    saveVault(vault: SpvVault): Promise<void>;
    startVaultsWatchdog(): Promise<void>;
    init(): Promise<void>;
}
