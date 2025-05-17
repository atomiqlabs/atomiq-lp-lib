import { FromBtcTrustedSwap, FromBtcTrustedSwapState } from "./FromBtcTrustedSwap";
import { BitcoinRpc, BtcBlock, BtcTx } from "@atomiqlabs/base";
import { Express } from "express";
import { MultichainData, SwapBaseConfig, SwapHandler, SwapHandlerType } from "../../SwapHandler";
import { IIntermediaryStorage } from "../../../storage/IIntermediaryStorage";
import { ISwapPrice } from "../../../prices/ISwapPrice";
import { IBitcoinWallet } from "../../../wallets/IBitcoinWallet";
import { FromBtcAmountAssertions } from "../../assertions/FromBtcAmountAssertions";
export type FromBtcTrustedConfig = SwapBaseConfig & {
    doubleSpendCheckInterval: number;
    swapAddressExpiry: number;
    recommendFeeMultiplier?: number;
};
export type FromBtcTrustedRequestType = {
    address: string;
    amount: bigint;
    exactIn?: boolean;
    refundAddress?: string;
    token?: string;
};
export declare class FromBtcTrusted extends SwapHandler<FromBtcTrustedSwap, FromBtcTrustedSwapState> {
    readonly type = SwapHandlerType.FROM_BTC_TRUSTED;
    readonly config: FromBtcTrustedConfig;
    readonly bitcoin: IBitcoinWallet;
    readonly bitcoinRpc: BitcoinRpc<BtcBlock>;
    readonly subscriptions: Map<string, FromBtcTrustedSwap>;
    readonly doubleSpendWatchdogSwaps: Set<FromBtcTrustedSwap>;
    readonly refundedSwaps: Map<string, string>;
    readonly doubleSpentSwaps: Map<string, string>;
    readonly processedTxIds: Map<string, {
        scTxId: string;
        txId: string;
        adjustedAmount: bigint;
        adjustedTotal: bigint;
    }>;
    readonly AmountAssertions: FromBtcAmountAssertions;
    constructor(storageDirectory: IIntermediaryStorage<FromBtcTrustedSwap>, path: string, chains: MultichainData, bitcoin: IBitcoinWallet, swapPricing: ISwapPrice, bitcoinRpc: BitcoinRpc<BtcBlock>, config: FromBtcTrustedConfig);
    private getAllAncestors;
    private refundSwap;
    private burn;
    protected processPastSwap(swap: FromBtcTrustedSwap, tx: BtcTx | null, vout: number | null): Promise<void>;
    protected processPastSwaps(): Promise<void>;
    private isValidBitcoinAddress;
    startRestServer(restServer: Express): void;
    private checkDoubleSpends;
    private startDoubleSpendWatchdog;
    private listenToTxns;
    startWatchdog(): Promise<void>;
    init(): Promise<void>;
    getInfoData(): any;
}
