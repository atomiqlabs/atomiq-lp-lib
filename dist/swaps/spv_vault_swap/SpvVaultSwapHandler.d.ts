import { MultichainData, SwapBaseConfig, SwapHandler, SwapHandlerType } from "../SwapHandler";
import { Express } from "express";
import { IBitcoinWallet } from "../../wallets/IBitcoinWallet";
import { BitcoinRpc, BtcBlock, ChainEvent, IStorageManager, SpvVaultClaimEvent, SwapData } from "@atomiqlabs/base";
import { IIntermediaryStorage } from "../../storage/IIntermediaryStorage";
import { ISwapPrice } from "../../prices/ISwapPrice";
import { SpvVaultSwap, SpvVaultSwapState } from "./SpvVaultSwap";
import { ISpvVaultSigner } from "../../wallets/ISpvVaultSigner";
import { SpvVault } from "./SpvVault";
import { FromBtcAmountAssertions } from "../assertions/FromBtcAmountAssertions";
import { SpvVaults } from "./SpvVaults";
export type SpvVaultSwapHandlerConfig = SwapBaseConfig & {
    vaultsCheckInterval: number;
    gasTokenMax: {
        [chainId: string]: bigint;
    };
};
export type SpvVaultSwapRequestType = {
    address: string;
    amount: bigint;
    token: string;
    gasAmount: bigint;
    gasToken: string;
    exactOut?: boolean;
};
export type SpvVaultPostQuote = {
    quoteId: string;
    psbtHex: string;
};
export declare class SpvVaultSwapHandler extends SwapHandler<SpvVaultSwap, SpvVaultSwapState> {
    readonly type: SwapHandlerType;
    readonly bitcoin: IBitcoinWallet;
    readonly bitcoinRpc: BitcoinRpc<BtcBlock>;
    readonly vaultSigner: ISpvVaultSigner;
    readonly outstandingQuotes: Map<string, SpvVaultSwap>;
    readonly AmountAssertions: FromBtcAmountAssertions;
    readonly Vaults: SpvVaults;
    config: SpvVaultSwapHandlerConfig;
    constructor(storageDirectory: IIntermediaryStorage<SpvVaultSwap>, vaultStorage: IStorageManager<SpvVault>, path: string, chainsData: MultichainData, swapPricing: ISwapPrice, bitcoin: IBitcoinWallet, bitcoinRpc: BitcoinRpc<BtcBlock>, spvVaultSigner: ISpvVaultSigner, config: SpvVaultSwapHandlerConfig);
    protected processClaimEvent(swap: SpvVaultSwap | null, event: SpvVaultClaimEvent): Promise<void>;
    /**
     * Chain event processor
     *
     * @param chainIdentifier
     * @param eventData
     */
    protected processEvent(chainIdentifier: string, eventData: ChainEvent<SwapData>[]): Promise<boolean>;
    /**
     * Initializes chain events subscription
     */
    protected subscribeToEvents(): void;
    startWatchdog(): Promise<void>;
    init(): Promise<void>;
    protected processPastSwap(swap: SpvVaultSwap): Promise<void>;
    protected processPastSwaps(): Promise<void>;
    protected getPricePrefetches(chainIdentifier: string, token: string, gasToken: string, abortController: AbortController): {
        pricePrefetchPromise: Promise<bigint>;
        gasTokenPricePrefetchPromise: Promise<bigint>;
    };
    startRestServer(restServer: Express): void;
    getInfoData(): any;
}
