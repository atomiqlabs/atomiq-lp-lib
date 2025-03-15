import { BitcoinRpc } from "@atomiqlabs/base";
import { FromBtcLnRequestType, FromBtcRequestType, ISwapPrice, MultichainData, RequestData, SwapHandler, ToBtcLnRequestType, ToBtcRequestType } from "..";
import { SwapHandlerSwap } from "../swaps/SwapHandlerSwap";
import { Command } from "@atomiqlabs/server-base";
import { FromBtcLnTrustedRequestType } from "../swaps/trusted/frombtcln_trusted/FromBtcLnTrusted";
import { IBitcoinWallet } from "../wallets/IBitcoinWallet";
import { ILightningWallet } from "../wallets/ILightningWallet";
export type QuoteThrow = {
    type: "throw";
    message: string;
};
export declare function isQuoteThrow(obj: any): obj is QuoteThrow;
export type QuoteSetFees = {
    type: "fees";
    baseFee?: bigint;
    feePPM?: bigint;
    securityDepositApyPPM?: bigint;
    securityDepositBaseMultiplierPPM?: bigint;
};
export declare function isQuoteSetFees(obj: any): obj is QuoteSetFees;
export type QuoteAmountTooLow = {
    type: "low";
    data: {
        min: bigint;
        max: bigint;
    };
};
export declare function isQuoteAmountTooLow(obj: any): obj is QuoteAmountTooLow;
export type QuoteAmountTooHigh = {
    type: "high";
    data: {
        min: bigint;
        max: bigint;
    };
};
export declare function isQuoteAmountTooHigh(obj: any): obj is QuoteAmountTooHigh;
export type PluginQuote = {
    type: "success";
    amount: {
        input: boolean;
        amount: bigint;
    };
    swapFee: {
        inInputTokens: bigint;
        inOutputTokens: bigint;
    };
};
export declare function isPluginQuote(obj: any): obj is PluginQuote;
export type ToBtcPluginQuote = PluginQuote & {
    networkFee: {
        inInputTokens: bigint;
        inOutputTokens: bigint;
    };
};
export declare function isToBtcPluginQuote(obj: any): obj is ToBtcPluginQuote;
export interface IPlugin {
    name: string;
    author: string;
    description: string;
    onEnable(chainsData: MultichainData, bitcoinRpc: BitcoinRpc<any>, bitcoinWallet: IBitcoinWallet, lightningWallet: ILightningWallet, swapPricing: ISwapPrice, tokens: {
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
        amount: bigint;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: bigint;
        maxInBtc: bigint;
    }, fees: {
        baseFeeInBtc: bigint;
        feePPM: bigint;
    }): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh>;
    onHandlePostFromBtcQuote?(request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: bigint;
        maxInBtc: bigint;
    }, fees: {
        baseFeeInBtc: bigint;
        feePPM: bigint;
    }, pricePrefetchPromise?: Promise<bigint> | null): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh | PluginQuote>;
    onHandlePreToBtcQuote?(request: RequestData<ToBtcLnRequestType | ToBtcRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: bigint;
        maxInBtc: bigint;
    }, fees: {
        baseFeeInBtc: bigint;
        feePPM: bigint;
    }): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh>;
    onHandlePostToBtcQuote?(request: RequestData<ToBtcLnRequestType | ToBtcRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
    }, chainIdentifier: string, token: string, constraints: {
        minInBtc: bigint;
        maxInBtc: bigint;
    }, fees: {
        baseFeeInBtc: bigint;
        feePPM: bigint;
        networkFeeGetter: (amount: bigint) => Promise<bigint>;
    }, pricePrefetchPromise?: Promise<bigint> | null): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh | ToBtcPluginQuote>;
    /**
     * Returns whitelisted bitcoin txIds that are OK to spend even with 0-confs
     */
    getWhitelistedTxIds?(): string[];
    getCommands?(): Command<any>[];
}
