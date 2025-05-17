import { Express } from "express";
import { FromBtcLnTrustedSwap, FromBtcLnTrustedSwapState } from "./FromBtcLnTrustedSwap";
import { ISwapPrice } from "../../../prices/ISwapPrice";
import { MultichainData, SwapBaseConfig, SwapHandler, SwapHandlerType } from "../../SwapHandler";
import { IIntermediaryStorage } from "../../../storage/IIntermediaryStorage";
import { ILightningWallet } from "../../../wallets/ILightningWallet";
import { FromBtcAmountAssertions } from "../../assertions/FromBtcAmountAssertions";
import { LightningAssertions } from "../../assertions/LightningAssertions";
export type SwapForGasServerConfig = SwapBaseConfig & {
    minCltv: bigint;
    invoiceTimeoutSeconds?: number;
};
export type FromBtcLnTrustedRequestType = {
    address: string;
    amount: bigint;
    exactIn?: boolean;
    token?: string;
};
/**
 * Swap handler handling from BTCLN swaps using submarine swaps
 */
export declare class FromBtcLnTrusted extends SwapHandler<FromBtcLnTrustedSwap, FromBtcLnTrustedSwapState> {
    readonly type = SwapHandlerType.FROM_BTCLN_TRUSTED;
    activeSubscriptions: Map<string, AbortController>;
    processedTxIds: Map<string, string>;
    readonly config: SwapForGasServerConfig;
    readonly lightning: ILightningWallet;
    readonly LightningAssertions: LightningAssertions;
    readonly AmountAssertions: FromBtcAmountAssertions;
    constructor(storageDirectory: IIntermediaryStorage<FromBtcLnTrustedSwap>, path: string, chains: MultichainData, lightning: ILightningWallet, swapPricing: ISwapPrice, config: SwapForGasServerConfig);
    /**
     * Unsubscribe from the pending lightning network invoice
     *
     * @param paymentHash
     * @private
     */
    private unsubscribeInvoice;
    /**
     * Subscribe to a pending lightning network invoice
     *
     * @param invoiceData
     */
    private subscribeToInvoice;
    /**
     *
     * @param swap
     * @protected
     * @returns {Promise<boolean>} Whether the invoice should be cancelled
     */
    protected processPastSwap(swap: FromBtcLnTrustedSwap): Promise<boolean>;
    protected cancelInvoices(swaps: FromBtcLnTrustedSwap[]): Promise<void>;
    /**
     * Checks past swaps, refunds and deletes ones that are already expired.
     */
    protected processPastSwaps(): Promise<void>;
    private cancelSwapAndInvoice;
    /**
     * Saves the state of received HTLC of the lightning payment
     *
     * @param invoiceData
     * @param invoice
     */
    private htlcReceived;
    /**
     *
     * Checks if the lightning invoice is in HELD state (htlcs received but yet unclaimed)
     *
     * @param paymentHash
     * @throws {DefinedRuntimeError} Will throw if the lightning invoice is not found, or if it isn't in the HELD state
     * @returns the fetched lightning invoice
     */
    private checkInvoiceStatus;
    startRestServer(restServer: Express): void;
    init(): Promise<void>;
    getInfoData(): any;
}
