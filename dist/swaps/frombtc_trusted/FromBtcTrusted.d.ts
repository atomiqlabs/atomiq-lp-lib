import { FromBtcBaseConfig, FromBtcBaseSwapHandler } from "../FromBtcBaseSwapHandler";
import { FromBtcTrustedSwap, FromBtcTrustedSwapState } from "./FromBtcTrustedSwap";
import { BitcoinRpc, BtcBlock, ClaimEvent, InitializeEvent, RefundEvent, SwapData } from "@atomiqlabs/base";
import { Express } from "express";
import { MultichainData, SwapHandlerType } from "../SwapHandler";
import * as BN from "bn.js";
import { IIntermediaryStorage } from "../../storage/IIntermediaryStorage";
import { AuthenticatedLnd, ChainTransaction } from "lightning";
import { ISwapPrice } from "../ISwapPrice";
import { networks } from "bitcoinjs-lib";
import { IBtcFeeEstimator } from "../../fees/IBtcFeeEstimator";
export type FromBtcTrustedConfig = FromBtcBaseConfig & {
    bitcoinNetwork: networks.Network;
    feeEstimator: IBtcFeeEstimator;
    doubleSpendCheckInterval: number;
    swapAddressExpiry: number;
    recommendFeeMultiplier?: number;
};
export type FromBtcTrustedRequestType = {
    address: string;
    amount: BN;
    exactOut?: boolean;
};
export declare class FromBtcTrusted extends FromBtcBaseSwapHandler<FromBtcTrustedSwap, FromBtcTrustedSwapState> {
    readonly type: SwapHandlerType;
    readonly config: FromBtcTrustedConfig;
    readonly bitcoinRpc: BitcoinRpc<BtcBlock>;
    readonly subscriptions: Map<string, FromBtcTrustedSwap>;
    readonly doubleSpendWatchdogSwaps: Set<FromBtcTrustedSwap>;
    readonly refundedSwaps: Map<string, string>;
    readonly doubleSpentSwaps: Map<string, string>;
    readonly processedTxIds: Map<string, {
        txId: string;
        adjustedAmount: BN;
        adjustedTotal: BN;
    }>;
    constructor(storageDirectory: IIntermediaryStorage<FromBtcTrustedSwap>, path: string, chains: MultichainData, lnd: AuthenticatedLnd, swapPricing: ISwapPrice, bitcoinRpc: BitcoinRpc<BtcBlock>, config: FromBtcTrustedConfig);
    private getAllAncestors;
    private refundSwap;
    private burn;
    protected processPastSwap(swap: FromBtcTrustedSwap, tx: ChainTransaction | null): Promise<void>;
    protected processPastSwaps(): Promise<void>;
    private isValidBitcoinAddress;
    startRestServer(restServer: Express): void;
    private checkDoubleSpends;
    private startDoubleSpendWatchdog;
    private listenToTxns;
    startWatchdog(): Promise<void>;
    init(): Promise<void>;
    getInfoData(): any;
    protected processClaimEvent(chainIdentifier: string, event: ClaimEvent<SwapData>): Promise<void>;
    protected processInitializeEvent(chainIdentifier: string, event: InitializeEvent<SwapData>): Promise<void>;
    protected processRefundEvent(chainIdentifier: string, event: RefundEvent<SwapData>): Promise<void>;
}
