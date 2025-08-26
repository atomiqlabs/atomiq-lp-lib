import { SpvVault } from "./SpvVault";
import { BitcoinRpc, IStorageManager, SpvVaultClaimEvent, SpvVaultCloseEvent, SpvVaultDepositEvent, SpvVaultOpenEvent, SpvWithdrawalTransactionData } from "@atomiqlabs/base";
import { SpvVaultSwap } from "./SpvVaultSwap";
import { IBitcoinWallet } from "../../wallets/IBitcoinWallet";
import { ISpvVaultSigner } from "../../wallets/ISpvVaultSigner";
import { MultichainData } from "../SwapHandler";
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
    readonly chains: MultichainData;
    readonly logger: import("../../utils/Utils").LoggerType;
    constructor(vaultStorage: IStorageManager<SpvVault>, bitcoin: IBitcoinWallet, vaultSigner: ISpvVaultSigner, bitcoinRpc: BitcoinRpc<any>, chains: MultichainData, config: {
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
    listVaults(chainId?: string, token?: string): Promise<SpvVault<SpvWithdrawalTransactionData & {
        sending?: boolean;
    }, import("@atomiqlabs/base").SpvVaultData<SpvWithdrawalTransactionData>>[]>;
    fundVault(vault: SpvVault, tokenAmounts: bigint[]): Promise<string>;
    withdrawFromVault(vault: SpvVault, tokenAmounts: bigint[], feeRate?: number): Promise<string>;
    /**
     * Call this to check whether some of the previously replaced transactions got re-introduced to the mempool
     *
     * @param vault
     * @param save
     */
    checkVaultReplacedTransactions(vault: SpvVault, save?: boolean): Promise<boolean>;
    checkVaults(): Promise<void>;
    claimWithdrawals(vault: SpvVault, withdrawal: SpvWithdrawalTransactionData[]): Promise<boolean>;
    getVault(chainId: string, owner: string, vaultId: bigint): Promise<SpvVault<SpvWithdrawalTransactionData & {
        sending?: boolean;
    }, import("@atomiqlabs/base").SpvVaultData<SpvWithdrawalTransactionData>>>;
    /**
     * Returns a ready-to-use vault for a specific request
     *
     * @param chainIdentifier
     * @param totalSats
     * @param token
     * @param amount
     * @param gasToken
     * @param gasTokenAmount
     * @protected
     */
    findVaultForSwap(chainIdentifier: string, totalSats: bigint, token: string, amount: bigint, gasToken: string, gasTokenAmount: bigint): Promise<SpvVault | null>;
    saveVault(vault: SpvVault): Promise<void>;
    startVaultsWatchdog(): Promise<void>;
    init(): Promise<void>;
}
