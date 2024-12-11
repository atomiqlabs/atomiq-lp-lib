import * as BN from "bn.js";
import { Express } from "express";
import { ToBtcLnSwapAbs, ToBtcLnSwapState } from "./ToBtcLnSwapAbs";
import { MultichainData, SwapHandlerType } from "../SwapHandler";
import { ISwapPrice } from "../ISwapPrice";
import { ClaimEvent, InitializeEvent, RefundEvent, SwapData } from "@atomiqlabs/base";
import { IIntermediaryStorage } from "../../storage/IIntermediaryStorage";
import { ToBtcBaseConfig, ToBtcBaseSwapHandler } from "../ToBtcBaseSwapHandler";
import { ILightningWallet, ParsedPaymentRequest } from "../../wallets/ILightningWallet";
export type ToBtcLnConfig = ToBtcBaseConfig & {
    routingFeeMultiplier: BN;
    minSendCltv: BN;
    allowProbeFailedSwaps: boolean;
    allowShortExpiry: boolean;
    minLnRoutingFeePPM?: BN;
    minLnBaseFee?: BN;
    exactInExpiry?: number;
};
type ExactInAuthorization = {
    chainIdentifier: string;
    reqId: string;
    expiry: number;
    amount: BN;
    initialInvoice: ParsedPaymentRequest;
    quotedNetworkFeeInToken: BN;
    swapFeeInToken: BN;
    total: BN;
    confidence: number;
    quotedNetworkFee: BN;
    swapFee: BN;
    token: string;
    swapExpiry: BN;
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
    maxFee: BN;
    expiryTimestamp: BN;
    token: string;
    offerer: string;
    exactIn?: boolean;
    amount?: BN;
};
/**
 * Swap handler handling to BTCLN swaps using submarine swaps
 */
export declare class ToBtcLnAbs extends ToBtcBaseSwapHandler<ToBtcLnSwapAbs, ToBtcLnSwapState> {
    protected readonly LIGHTNING_LIQUIDITY_CACHE_TIMEOUT: number;
    activeSubscriptions: Set<string>;
    lightningLiquidityCache: {
        liquidity: BN;
        timestamp: number;
    };
    readonly type = SwapHandlerType.TO_BTCLN;
    readonly config: ToBtcLnConfig & {
        minTsSendCltv: BN;
    };
    readonly exactInAuths: {
        [reqId: string]: ExactInAuthorization;
    };
    readonly lightning: ILightningWallet;
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
    protected processInitializeEvent(chainIdentifier: string, event: InitializeEvent<SwapData>): Promise<void>;
    protected processClaimEvent(chainIdentifier: string, event: ClaimEvent<SwapData>): Promise<void>;
    protected processRefundEvent(chainIdentifier: string, event: RefundEvent<SwapData>): Promise<void>;
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
     * Checks if the prior payment with the same paymentHash exists
     *
     * @param paymentHash
     * @param abortSignal
     * @throws {DefinedRuntimeError} will throw an error if payment already exists
     */
    private checkPriorPayment;
    /**
     * Checks if the underlying LND backend has enough liquidity in channels to honor the swap
     *
     * @param amount
     * @param abortSignal
     * @param useCached Whether to use cached liquidity values
     * @throws {DefinedRuntimeError} will throw an error if there isn't enough liquidity
     */
    private checkLiquidity;
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
     * @param pr
     * @param parsedAuth
     * @throws {DefinedRuntimeError} will throw an error if the details don't match
     */
    private checkPaymentRequestMatchesInitial;
    startRestServer(restServer: Express): void;
    init(): Promise<void>;
    getInfoData(): any;
}
export {};
