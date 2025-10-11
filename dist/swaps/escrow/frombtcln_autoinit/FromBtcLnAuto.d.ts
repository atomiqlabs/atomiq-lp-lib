import { Express } from "express";
import { FromBtcLnAutoSwap, FromBtcLnAutoSwapState } from "./FromBtcLnAutoSwap";
import { MultichainData, SwapHandlerType } from "../../SwapHandler";
import { ISwapPrice } from "../../../prices/ISwapPrice";
import { ChainSwapType, ClaimEvent, InitializeEvent, RefundEvent, SwapData } from "@atomiqlabs/base";
import { IIntermediaryStorage } from "../../../storage/IIntermediaryStorage";
import { FromBtcBaseConfig, FromBtcBaseSwapHandler } from "../FromBtcBaseSwapHandler";
import { ILightningWallet } from "../../../wallets/ILightningWallet";
import { LightningAssertions } from "../../assertions/LightningAssertions";
export type FromBtcLnAutoConfig = FromBtcBaseConfig & {
    invoiceTimeoutSeconds?: number;
    minCltv: bigint;
    gracePeriod: bigint;
    gasTokenMax: {
        [chainId: string]: bigint;
    };
};
export type FromBtcLnAutoRequestType = {
    address: string;
    paymentHash: string;
    amount: bigint;
    token: string;
    gasToken: string;
    gasAmount: bigint;
    claimerBounty: bigint;
    descriptionHash?: string;
    exactOut?: boolean;
};
/**
 * Swap handler handling from BTCLN swaps using submarine swaps
 */
export declare class FromBtcLnAuto extends FromBtcBaseSwapHandler<FromBtcLnAutoSwap, FromBtcLnAutoSwapState> {
    readonly type = SwapHandlerType.FROM_BTCLN_AUTO;
    readonly swapType = ChainSwapType.HTLC;
    readonly inflightSwapStates: Set<FromBtcLnAutoSwapState>;
    activeSubscriptions: Set<string>;
    readonly config: FromBtcLnAutoConfig;
    readonly lightning: ILightningWallet;
    readonly LightningAssertions: LightningAssertions;
    constructor(storageDirectory: IIntermediaryStorage<FromBtcLnAutoSwap>, path: string, chains: MultichainData, lightning: ILightningWallet, swapPricing: ISwapPrice, config: FromBtcLnAutoConfig);
    protected processPastSwap(swap: FromBtcLnAutoSwap): Promise<"REFUND" | "SETTLE" | null>;
    protected refundSwaps(refundSwaps: FromBtcLnAutoSwap[]): Promise<void>;
    protected settleInvoices(swaps: FromBtcLnAutoSwap[]): Promise<void>;
    /**
     * Checks past swaps, refunds and deletes ones that are already expired.
     */
    protected processPastSwaps(): Promise<void>;
    protected processInitializeEvent(chainIdentifier: string, savedSwap: FromBtcLnAutoSwap, event: InitializeEvent<SwapData>): Promise<void>;
    protected processClaimEvent(chainIdentifier: string, savedSwap: FromBtcLnAutoSwap, event: ClaimEvent<SwapData>): Promise<void>;
    protected processRefundEvent(chainIdentifier: string, savedSwap: FromBtcLnAutoSwap, event: RefundEvent<SwapData>): Promise<void>;
    /**
     * Subscribe to a lightning network invoice
     *
     * @param swap
     */
    private subscribeToInvoice;
    /**
     * Called when lightning HTLC is received, also signs an init transaction on the smart chain side, expiry of the
     *  smart chain authorization starts ticking as soon as this HTLC is received
     *
     * @param invoiceData
     * @param invoice
     */
    private htlcReceived;
    private offerHtlc;
    /**
     * Checks invoice description hash
     *
     * @param descriptionHash
     * @throws {DefinedRuntimeError} will throw an error if the description hash is invalid
     */
    private checkDescriptionHash;
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
