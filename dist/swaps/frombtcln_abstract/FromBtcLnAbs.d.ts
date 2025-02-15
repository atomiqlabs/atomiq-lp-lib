import * as BN from "bn.js";
import { Express } from "express";
import { FromBtcLnSwapAbs, FromBtcLnSwapState } from "./FromBtcLnSwapAbs";
import { MultichainData, SwapHandlerType } from "../SwapHandler";
import { ISwapPrice } from "../ISwapPrice";
import { ChainSwapType, ClaimEvent, InitializeEvent, RefundEvent, SwapData } from "@atomiqlabs/base";
import { IIntermediaryStorage } from "../../storage/IIntermediaryStorage";
import { FromBtcBaseConfig } from "../FromBtcBaseSwapHandler";
import { FromBtcLnBaseSwapHandler } from "../FromBtcLnBaseSwapHandler";
import { ILightningWallet } from "../../wallets/ILightningWallet";
export type FromBtcLnConfig = FromBtcBaseConfig & {
    invoiceTimeoutSeconds?: number;
    minCltv: BN;
    gracePeriod: BN;
};
export type FromBtcLnRequestType = {
    address: string;
    paymentHash: string;
    amount: BN;
    token: string;
    descriptionHash?: string;
    exactOut?: boolean;
};
/**
 * Swap handler handling from BTCLN swaps using submarine swaps
 */
export declare class FromBtcLnAbs extends FromBtcLnBaseSwapHandler<FromBtcLnSwapAbs, FromBtcLnSwapState> {
    readonly type = SwapHandlerType.FROM_BTCLN;
    readonly swapType = ChainSwapType.HTLC;
    readonly config: FromBtcLnConfig;
    constructor(storageDirectory: IIntermediaryStorage<FromBtcLnSwapAbs>, path: string, chains: MultichainData, lightning: ILightningWallet, swapPricing: ISwapPrice, config: FromBtcLnConfig);
    protected processPastSwap(swap: FromBtcLnSwapAbs): Promise<"REFUND" | "SETTLE" | "CANCEL" | null>;
    protected refundSwaps(refundSwaps: FromBtcLnSwapAbs[]): Promise<void>;
    protected cancelInvoices(swaps: FromBtcLnSwapAbs[]): Promise<void>;
    protected settleInvoices(swaps: FromBtcLnSwapAbs[]): Promise<void>;
    /**
     * Checks past swaps, refunds and deletes ones that are already expired.
     */
    protected processPastSwaps(): Promise<void>;
    protected processInitializeEvent(chainIdentifier: string, savedSwap: FromBtcLnSwapAbs, event: InitializeEvent<SwapData>): Promise<void>;
    protected processClaimEvent(chainIdentifier: string, savedSwap: FromBtcLnSwapAbs, event: ClaimEvent<SwapData>): Promise<void>;
    protected processRefundEvent(chainIdentifier: string, savedSwap: FromBtcLnSwapAbs, event: RefundEvent<SwapData>): Promise<void>;
    /**
     * Called when lightning HTLC is received, also signs an init transaction on the smart chain side, expiry of the
     *  smart chain authorization starts ticking as soon as this HTLC is received
     *
     * @param invoiceData
     * @param invoice
     */
    private htlcReceived;
    /**
     * Checks invoice description hash
     *
     * @param descriptionHash
     * @throws {DefinedRuntimeError} will throw an error if the description hash is invalid
     */
    private checkDescriptionHash;
    /**
     * Starts LN channels pre-fetch
     *
     * @param abortController
     */
    private getBlockheightPrefetch;
    /**
     * Asynchronously sends the LN node's public key to the client, so he can pre-fetch the node's channels from 1ml api
     *
     * @param responseStream
     */
    private sendPublicKeyAsync;
    /**
     * Returns the CLTV timeout (blockheight) of the received HTLC corresponding to the invoice. If multiple HTLCs are
     *  received (MPP) it returns the lowest of the timeouts
     *
     * @param invoice
     */
    private getInvoicePaymentsTimeout;
    /**
     * Checks if the received HTLC's CLTV timeout is large enough to still process the swap
     *
     * @param invoice
     * @param blockheightPrefetch
     * @param signal
     * @throws {DefinedRuntimeError} Will throw if HTLC expires too soon and therefore cannot be processed
     * @returns expiry timeout in seconds
     */
    private checkHtlcExpiry;
    /**
     * Cancels the swap (CANCELED state) & also cancels the LN invoice (including all pending HTLCs)
     *
     * @param invoiceData
     */
    private cancelSwapAndInvoice;
    private getDummySwapData;
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
