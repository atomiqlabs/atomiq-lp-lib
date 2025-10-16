import { Express } from "express";
import { ToBtcLnSwapAbs, ToBtcLnSwapState } from "./ToBtcLnSwapAbs";
import { MultichainData, SwapHandlerType } from "../../SwapHandler";
import { ISwapPrice } from "../../../prices/ISwapPrice";
import { ChainSwapType, ClaimEvent, InitializeEvent, RefundEvent, SwapData } from "@atomiqlabs/base";
import { IIntermediaryStorage } from "../../../storage/IIntermediaryStorage";
import { ToBtcBaseConfig, ToBtcBaseSwapHandler } from "../ToBtcBaseSwapHandler";
import { ILightningWallet, ParsedPaymentRequest } from "../../../wallets/ILightningWallet";
import { LightningAssertions } from "../../assertions/LightningAssertions";
export type ToBtcLnConfig = ToBtcBaseConfig & {
    routingFeeMultiplier: bigint;
    minSendCltv: bigint;
    allowProbeFailedSwaps: boolean;
    allowShortExpiry: boolean;
    minLnRoutingFeePPM?: bigint;
    minLnBaseFee?: bigint;
    exactInExpiry?: number;
    lnSendBitcoinBlockTimeSafetyFactorPPM?: bigint;
};
type ExactInAuthorization = {
    chainIdentifier: string;
    reqId: string;
    expiry: number;
    amount: bigint;
    initialInvoice: ParsedPaymentRequest;
    quotedNetworkFeeInToken: bigint;
    swapFeeInToken: bigint;
    total: bigint;
    confidence: number;
    quotedNetworkFee: bigint;
    swapFee: bigint;
    token: string;
    swapExpiry: bigint;
    offerer: string;
    preFetchSignData: any;
    metadata: {
        request: any;
        probeRequest?: any;
        probeResponse?: any;
        routeResponse?: any;
        times: {
            [key: string]: number;
        };
    };
};
export type ToBtcLnRequestType = {
    pr: string;
    maxFee: bigint;
    expiryTimestamp: bigint;
    token: string;
    offerer: string;
    exactIn?: boolean;
    amount?: bigint;
};
/**
 * Swap handler handling to BTCLN swaps using submarine swaps
 */
export declare class ToBtcLnAbs extends ToBtcBaseSwapHandler<ToBtcLnSwapAbs, ToBtcLnSwapState> {
    readonly type = SwapHandlerType.TO_BTCLN;
    readonly swapType = ChainSwapType.HTLC;
    readonly inflightSwapStates: Set<ToBtcLnSwapState>;
    activeSubscriptions: Set<string>;
    readonly config: ToBtcLnConfig & {
        minTsSendCltv: bigint;
    };
    readonly exactInAuths: {
        [reqId: string]: ExactInAuthorization;
    };
    readonly lightning: ILightningWallet;
    readonly LightningAssertions: LightningAssertions;
    constructor(storageDirectory: IIntermediaryStorage<ToBtcLnSwapAbs>, path: string, chainData: MultichainData, lightning: ILightningWallet, swapPricing: ISwapPrice, config: ToBtcLnConfig);
    /**
     * Cleans up exactIn authorization that are already past their expiry
     *
     * @protected
     */
    private cleanExpiredExactInAuthorizations;
    protected processPastSwap(swap: ToBtcLnSwapAbs): Promise<void>;
    /**
     * Checks past swaps, deletes ones that are already expired, and tries to process ones that are committed.
     */
    protected processPastSwaps(): Promise<void>;
    /**
     * Tries to claim the swap funds on the SC side, returns false if the swap is already locked (claim tx is already being sent)
     *
     * @param swap
     * @private
     * @returns Whether the transaction was successfully sent
     */
    private tryClaimSwap;
    /**
     * Process the result of attempted lightning network payment
     *
     * @param swap
     * @param lnPaymentStatus
     */
    private processPaymentResult;
    /**
     * Subscribe to a pending lightning network payment attempt
     *
     * @param invoiceData
     */
    private subscribeToPayment;
    private sendLightningPayment;
    /**
     * Begins a lightning network payment attempt, if not attempted already
     *
     * @param swap
     */
    private processInitialized;
    protected processInitializeEvent(chainIdentifier: string, swap: ToBtcLnSwapAbs, event: InitializeEvent<SwapData>): Promise<void>;
    protected processClaimEvent(chainIdentifier: string, swap: ToBtcLnSwapAbs, event: ClaimEvent<SwapData>): Promise<void>;
    protected processRefundEvent(chainIdentifier: string, swap: ToBtcLnSwapAbs, event: RefundEvent<SwapData>): Promise<void>;
    /**
     * Checks if the amount was supplied in the exactIn request
     *
     * @param amount
     * @param exactIn
     * @throws {DefinedRuntimeError} will throw an error if the swap was exactIn, but amount not specified
     */
    private checkAmount;
    /**
     * Checks if the maxFee parameter is in valid range (>0)
     *
     * @param maxFee
     * @throws {DefinedRuntimeError} will throw an error if the maxFee is zero or negative
     */
    private checkMaxFee;
    /**
     * Checks and parses a payment request (bolt11 invoice), additionally also checks expiration time of the invoice
     *
     * @param chainIdentifier
     * @param pr
     * @throws {DefinedRuntimeError} will throw an error if the pr is invalid, without amount or expired
     */
    private checkPaymentRequest;
    /**
     * Checks if the request specified too short of an expiry
     *
     * @param expiryTimestamp
     * @param currentTimestamp
     * @throws {DefinedRuntimeError} will throw an error if the expiry time is too short
     */
    private checkExpiry;
    /**
     * Estimates the routing fee & confidence by either probing or routing (if probing fails), the fee is also adjusted
     *  according to routing fee multiplier, and subject to minimums set in config
     *
     * @param amountBD
     * @param maxFee
     * @param expiryTimestamp
     * @param currentTimestamp
     * @param pr
     * @param metadata
     * @param abortSignal
     * @throws {DefinedRuntimeError} will throw an error if the destination is unreachable
     */
    private checkAndGetNetworkFee;
    /**
     * Checks and consumes (deletes & returns) exactIn authorizaton with a specific reqId
     *
     * @param reqId
     * @throws {DefinedRuntimeError} will throw an error if the authorization doesn't exist
     */
    private checkExactInAuthorization;
    /**
     * Checks if the newly submitted PR has the same parameters (destination, cltv_delta, routes) as the initial dummy
     *  invoice sent for exactIn swap quote
     *
     * @param parsedRequest
     * @param parsedAuth
     */
    private isPaymentRequestMatchingInitial;
    startRestServer(restServer: Express): void;
    init(): Promise<void>;
    getInfoData(): any;
}
export {};
