import { Express, Request } from "express";
import { ISwapPrice } from "./ISwapPrice";
import { ChainType, ClaimEvent, InitializeEvent, RefundEvent, SwapData, SwapEvent } from "@atomiqlabs/base";
import { AuthenticatedLnd } from "lightning";
import { SwapHandlerSwap } from "./SwapHandlerSwap";
import { IIntermediaryStorage } from "../storage/IIntermediaryStorage";
import * as BN from "bn.js";
import { ServerParamEncoder } from "../utils/paramcoders/server/ServerParamEncoder";
import { IParamReader } from "../utils/paramcoders/IParamReader";
export declare enum SwapHandlerType {
    TO_BTC = "TO_BTC",
    FROM_BTC = "FROM_BTC",
    TO_BTCLN = "TO_BTCLN",
    FROM_BTCLN = "FROM_BTCLN",
    FROM_BTCLN_TRUSTED = "FROM_BTCLN_TRUSTED",
    FROM_BTC_TRUSTED = "FROM_BTC_TRUSTED"
}
export type SwapHandlerInfoType = {
    swapFeePPM: number;
    swapBaseFee: number;
    min: number;
    max: number;
    tokens: string[];
    chainTokens: {
        [chainId: string]: string[];
    };
    data?: any;
};
export type SwapBaseConfig = {
    authorizationTimeout: number;
    bitcoinBlocktime: BN;
    baseFee: BN;
    feePPM: BN;
    max: BN;
    min: BN;
    maxSkew: number;
    safetyFactor: BN;
    swapCheckInterval: number;
};
export type MultichainData = {
    chains: {
        [identifier: string]: ChainData;
    };
    default: string;
};
export type ChainData<T extends ChainType = ChainType> = {
    signer: T["Signer"];
    swapContract: T["Contract"];
    chainEvents: T["Events"];
    allowedTokens: string[];
    btcRelay?: T["BtcRelay"];
};
export type RequestData<T> = {
    chainIdentifier: string;
    raw: Request & {
        paramReader: IParamReader;
    };
    parsed: T;
    metadata: any;
};
/**
 * An abstract class defining a singular swap service
 */
export declare abstract class SwapHandler<V extends SwapHandlerSwap<SwapData, S> = SwapHandlerSwap, S = any> {
    abstract readonly type: SwapHandlerType;
    readonly storageManager: IIntermediaryStorage<V>;
    readonly path: string;
    readonly chains: MultichainData;
    readonly allowedTokens: {
        [chainId: string]: Set<string>;
    };
    readonly swapPricing: ISwapPrice;
    readonly LND: AuthenticatedLnd;
    abstract config: SwapBaseConfig;
    logger: {
        debug: (msg: string, ...args: any) => void;
        info: (msg: string, ...args: any) => void;
        warn: (msg: string, ...args: any) => void;
        error: (msg: string, ...args: any) => void;
    };
    protected swapLogger: {
        debug: (swap: SwapHandlerSwap | SwapEvent<SwapData> | SwapData, msg: string, ...args: any) => void;
        info: (swap: SwapHandlerSwap | SwapEvent<SwapData> | SwapData, msg: string, ...args: any) => void;
        warn: (swap: SwapHandlerSwap | SwapEvent<SwapData> | SwapData, msg: string, ...args: any) => void;
        error: (swap: SwapHandlerSwap | SwapEvent<SwapData> | SwapData, msg: string, ...args: any) => void;
    };
    protected constructor(storageDirectory: IIntermediaryStorage<V>, path: string, chainsData: MultichainData, lnd: AuthenticatedLnd, swapPricing: ISwapPrice);
    protected getDefaultChain(): ChainData;
    protected getChain(identifier: string): ChainData;
    protected abstract processPastSwaps(): Promise<void>;
    /**
     * Starts the watchdog checking past swaps for expiry or claim eligibility.
     */
    startWatchdog(): Promise<void>;
    protected abstract processInitializeEvent(chainIdentifier: string, event: InitializeEvent<SwapData>): Promise<void>;
    protected abstract processClaimEvent(chainIdentifier: string, event: ClaimEvent<SwapData>): Promise<void>;
    protected abstract processRefundEvent(chainIdentifier: string, event: RefundEvent<SwapData>): Promise<void>;
    /**
     * Chain event processor
     *
     * @param chainIdentifier
     * @param eventData
     */
    protected processEvent(chainIdentifier: string, eventData: SwapEvent<SwapData>[]): Promise<boolean>;
    /**
     * Initializes chain events subscription
     */
    protected subscribeToEvents(): void;
    /**
     * Initializes swap handler, loads data and subscribes to chain events
     */
    abstract init(): Promise<void>;
    /**
     * Sets up required listeners for the REST server
     *
     * @param restServer
     */
    abstract startRestServer(restServer: Express): void;
    /**
     * Returns data to be returned in swap handler info
     */
    abstract getInfoData(): any;
    /**
     * Remove swap data
     *
     * @param hash
     * @param sequence
     */
    protected removeSwapData(hash: string, sequence: BN): Promise<void>;
    /**
     * Remove swap data
     *
     * @param swap
     * @param ultimateState set the ultimate state of the swap before removing
     */
    protected removeSwapData(swap: V, ultimateState?: S): Promise<void>;
    /**
     * Checks whether the bitcoin amount is within specified min/max bounds
     *
     * @param amount
     * @protected
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    protected checkBtcAmountInBounds(amount: BN): void;
    /**
     * Handles and throws plugin errors
     *
     * @param res Response as returned from the PluginManager.onHandlePost{To,From}BtcQuote
     * @protected
     * @throws {DefinedRuntimeError} will throw an error if the response is an error
     */
    protected handlePluginErrorResponses(res: any): void;
    /**
     * Creates an abort controller that extends the responseStream's abort signal
     *
     * @param responseStream
     */
    protected getAbortController(responseStream: ServerParamEncoder): AbortController;
    /**
     * Starts a pre-fetch for signature data
     *
     * @param chainIdentifier
     * @param abortController
     * @param responseStream
     */
    protected getSignDataPrefetch(chainIdentifier: string, abortController: AbortController, responseStream?: ServerParamEncoder): Promise<any>;
    protected getIdentifierFromEvent(event: SwapEvent<SwapData>): string;
    protected getIdentifierFromSwapData(swapData: SwapData): string;
    protected getIdentifier(swap: SwapHandlerSwap | SwapEvent<SwapData> | SwapData): string;
    /**
     * Checks if the sequence number is between 0-2^64
     *
     * @param sequence
     * @throws {DefinedRuntimeError} will throw an error if sequence number is out of bounds
     */
    protected checkSequence(sequence: BN): void;
    /**
     * Checks whether a given token is supported on a specified chain
     *
     * @param chainId
     * @param token
     * @protected
     */
    protected isTokenSupported(chainId: string, token: string): boolean;
    getInfo(): SwapHandlerInfoType;
}