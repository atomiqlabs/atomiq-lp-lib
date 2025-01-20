import { BitcoinRpc, SwapData } from "@atomiqlabs/base";
import { IPlugin, PluginQuote, QuoteAmountTooHigh, QuoteAmountTooLow, QuoteSetFees, QuoteThrow, ToBtcPluginQuote } from "./IPlugin";
import { FromBtcLnRequestType, FromBtcRequestType, ISwapPrice, MultichainData, RequestData, SwapHandler, ToBtcLnRequestType, ToBtcRequestType } from "..";
import { SwapHandlerSwap } from "../swaps/SwapHandlerSwap";
import * as BN from "bn.js";
import { FromBtcLnTrustedRequestType } from "../swaps/frombtcln_trusted/FromBtcLnTrusted";
import { IBitcoinWallet } from "../wallets/IBitcoinWallet";
import { ILightningWallet } from "../wallets/ILightningWallet";
export type FailSwapResponse = {
    type: "fail";
    code?: number;
    msg?: string;
};
export type FeeSwapResponse = {
    type: "fee";
    baseFee: BN;
    feePPM: BN;
};
export type AmountAndFeeSwapResponse = {
    type: "amountAndFee";
    baseFee?: BN;
    feePPM?: BN;
    amount: BN;
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
    static swapStateChange<T extends SwapData>(swap: SwapHandlerSwap<T>, oldState?: any): Promise<void>;
    static swapCreate<T extends SwapData>(swap: SwapHandlerSwap<T>): Promise<void>;
    static swapRemove<T extends SwapData>(swap: SwapHandlerSwap<T>): Promise<void>;
    static onHandlePostFromBtcQuote(request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType>, requestedAmount: {
        input: boolean;
        amount: BN;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: BN;
        maxInBtc: BN;
    }, fees: {
        baseFeeInBtc: BN;
        feePPM: BN;
    }, pricePrefetchPromise?: Promise<BN> | null): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh | PluginQuote>;
    static onHandlePreFromBtcQuote(request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType>, requestedAmount: {
        input: boolean;
        amount: BN;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: BN;
        maxInBtc: BN;
    }, fees: {
        baseFeeInBtc: BN;
        feePPM: BN;
    }): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh>;
    static onHandlePostToBtcQuote<T extends {
        networkFee: BN;
    }>(request: RequestData<ToBtcLnRequestType | ToBtcRequestType>, requestedAmount: {
        input: boolean;
        amount: BN;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: BN;
        maxInBtc: BN;
    }, fees: {
        baseFeeInBtc: BN;
        feePPM: BN;
        networkFeeGetter: (amount: BN) => Promise<T>;
    }, pricePrefetchPromise?: Promise<BN> | null): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh | (ToBtcPluginQuote & {
        networkFeeData: T;
    })>;
    static onHandlePreToBtcQuote(request: RequestData<ToBtcLnRequestType | ToBtcRequestType>, requestedAmount: {
        input: boolean;
        amount: BN;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: BN;
        maxInBtc: BN;
    }, fees: {
        baseFeeInBtc: BN;
        feePPM: BN;
    }): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh>;
    static getWhitelistedTxIds(): Set<string>;
}
