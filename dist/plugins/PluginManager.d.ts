import { BitcoinRpc, SwapData } from "@atomiqlabs/base";
import { IPlugin, PluginQuote, QuoteAmountTooHigh, QuoteAmountTooLow, QuoteSetFees, QuoteThrow, ToBtcPluginQuote } from "./IPlugin";
import { FromBtcLnRequestType, FromBtcRequestType, ISwapPrice, MultichainData, RequestData, SwapHandler, ToBtcLnRequestType, ToBtcRequestType } from "..";
import { SwapHandlerSwap } from "../swaps/SwapHandlerSwap";
import { FromBtcLnTrustedRequestType } from "../swaps/trusted/frombtcln_trusted/FromBtcLnTrusted";
import { IBitcoinWallet } from "../wallets/IBitcoinWallet";
import { ILightningWallet } from "../wallets/ILightningWallet";
export type FailSwapResponse = {
    type: "fail";
    code?: number;
    msg?: string;
};
export type FeeSwapResponse = {
    type: "fee";
    baseFee: bigint;
    feePPM: bigint;
};
export type AmountAndFeeSwapResponse = {
    type: "amountAndFee";
    baseFee?: bigint;
    feePPM?: bigint;
    amount: bigint;
};
export type SwapResponse = FailSwapResponse | FeeSwapResponse | AmountAndFeeSwapResponse;
export declare class PluginManager {
    static plugins: Map<string, IPlugin>;
    static registerPlugin(name: string, plugin: IPlugin): void;
    static unregisterPlugin(name: string): boolean;
    static enable<T extends SwapData>(chainsData: MultichainData, bitcoinRpc: BitcoinRpc<any>, bitcoinWallet: IBitcoinWallet, lightningWallet: ILightningWallet, swapPricing: ISwapPrice, tokens: {
        [ticker: string]: {
            [chainId: string]: {
                address: string;
                decimals: number;
            };
        };
    }, directory: string): Promise<void>;
    static disable(): Promise<void>;
    static serviceInitialize(handler: SwapHandler<any>): Promise<void>;
    static onHttpServerStarted(httpServer: any): Promise<void>;
    static swapStateChange(swap: SwapHandlerSwap, oldState?: any): Promise<void>;
    static swapCreate(swap: SwapHandlerSwap): Promise<void>;
    static swapRemove(swap: SwapHandlerSwap): Promise<void>;
    static onHandlePostFromBtcQuote(request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: bigint;
        maxInBtc: bigint;
    }, fees: {
        baseFeeInBtc: bigint;
        feePPM: bigint;
    }, pricePrefetchPromise?: Promise<bigint> | null): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh | PluginQuote>;
    static onHandlePreFromBtcQuote(request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: bigint;
        maxInBtc: bigint;
    }, fees: {
        baseFeeInBtc: bigint;
        feePPM: bigint;
    }): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh>;
    static onHandlePostToBtcQuote<T extends {
        networkFee: bigint;
    }>(request: RequestData<ToBtcLnRequestType | ToBtcRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: bigint;
        maxInBtc: bigint;
    }, fees: {
        baseFeeInBtc: bigint;
        feePPM: bigint;
        networkFeeGetter: (amount: bigint) => Promise<T>;
    }, pricePrefetchPromise?: Promise<bigint> | null): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh | (ToBtcPluginQuote & {
        networkFeeData: T;
    })>;
    static onHandlePreToBtcQuote(request: RequestData<ToBtcLnRequestType | ToBtcRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: bigint;
        maxInBtc: bigint;
    }, fees: {
        baseFeeInBtc: bigint;
        feePPM: bigint;
    }): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh>;
    static getWhitelistedTxIds(): Set<string>;
}
