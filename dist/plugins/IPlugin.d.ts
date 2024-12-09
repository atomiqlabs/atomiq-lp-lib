import { BitcoinRpc } from "@atomiqlabs/base";
import { FromBtcLnRequestType, FromBtcRequestType, ISwapPrice, MultichainData, RequestData, SwapHandler, ToBtcLnRequestType, ToBtcRequestType } from "..";
import { SwapHandlerSwap } from "../swaps/SwapHandlerSwap";
import { AuthenticatedLnd } from "lightning";
import * as BN from "bn.js";
import { Command } from "@atomiqlabs/server-base";
import { FromBtcLnTrustedRequestType } from "../swaps/frombtcln_trusted/FromBtcLnTrusted";
export type QuoteThrow = {
    type: "throw";
    message: string;
};
export declare function isQuoteThrow(obj: any): obj is QuoteThrow;
export type QuoteSetFees = {
    type: "fees";
    baseFee?: BN;
    feePPM?: BN;
};
export declare function isQuoteSetFees(obj: any): obj is QuoteSetFees;
export type QuoteAmountTooLow = {
    type: "low";
    data: {
        min: BN;
        max: BN;
    };
};
export declare function isQuoteAmountTooLow(obj: any): obj is QuoteAmountTooLow;
export type QuoteAmountTooHigh = {
    type: "high";
    data: {
        min: BN;
        max: BN;
    };
};
export declare function isQuoteAmountTooHigh(obj: any): obj is QuoteAmountTooHigh;
export type PluginQuote = {
    type: "success";
    amount: {
        input: boolean;
        amount: BN;
    };
    swapFee: {
        inInputTokens: BN;
        inOutputTokens: BN;
    };
};
export declare function isPluginQuote(obj: any): obj is PluginQuote;
export type ToBtcPluginQuote = PluginQuote & {
    networkFee: {
        inInputTokens: BN;
        inOutputTokens: BN;
    };
};
export declare function isToBtcPluginQuote(obj: any): obj is ToBtcPluginQuote;
export interface IPlugin {
    name: string;
    author: string;
    description: string;
    onEnable(chainsData: MultichainData, bitcoinRpc: BitcoinRpc<any>, lnd: AuthenticatedLnd, swapPricing: ISwapPrice, tokens: {
        [ticker: string]: {
            [chainId: string]: {
                address: string;
                decimals: number;
            };
        };
    }, directory: string): Promise<void>;
    onDisable(): Promise<void>;
    onServiceInitialize(service: SwapHandler<any>): Promise<void>;
    onHttpServerStarted?(expressServer: any): Promise<void>;
    onSwapStateChange?(swap: SwapHandlerSwap): Promise<void>;
    onSwapCreate?(swap: SwapHandlerSwap): Promise<void>;
    onSwapRemove?(swap: SwapHandlerSwap): Promise<void>;
    onHandlePreFromBtcQuote?(request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType>, requestedAmount: {
        input: boolean;
        amount: BN;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: BN;
        maxInBtc: BN;
    }, fees: {
        baseFeeInBtc: BN;
        feePPM: BN;
    }): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh>;
    onHandlePostFromBtcQuote?(request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType>, requestedAmount: {
        input: boolean;
        amount: BN;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: BN;
        maxInBtc: BN;
    }, fees: {
        baseFeeInBtc: BN;
        feePPM: BN;
    }, pricePrefetchPromise?: Promise<BN> | null): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh | PluginQuote>;
    onHandlePreToBtcQuote?(request: RequestData<ToBtcLnRequestType | ToBtcRequestType>, requestedAmount: {
        input: boolean;
        amount: BN;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: BN;
        maxInBtc: BN;
    }, fees: {
        baseFeeInBtc: BN;
        feePPM: BN;
    }): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh>;
    onHandlePostToBtcQuote?(request: RequestData<ToBtcLnRequestType | ToBtcRequestType>, requestedAmount: {
        input: boolean;
        amount: BN;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: BN;
        maxInBtc: BN;
    }, fees: {
        baseFeeInBtc: BN;
        feePPM: BN;
        networkFeeGetter: (amount: BN) => Promise<BN>;
    }, pricePrefetchPromise?: Promise<BN> | null): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh | ToBtcPluginQuote>;
    /**
     * Returns whitelisted bitcoin txIds that are OK to spend even with 0-confs
     */
    getWhitelistedTxIds?(): string[];
    getCommands?(): Command<any>[];
}