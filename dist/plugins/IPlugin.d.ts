import { BitcoinRpc } from "@atomiqlabs/base";
import { FromBtcLnRequestType, FromBtcRequestType, FromBtcTrustedRequestType, ISwapPrice, MultichainData, RequestData, SpvVaultSwapRequestType, SwapHandler, SwapHandlerType, ToBtcLnRequestType, ToBtcRequestType } from "..";
import { SwapHandlerSwap } from "../swaps/SwapHandlerSwap";
import { Command } from "@atomiqlabs/server-base";
import { FromBtcLnTrustedRequestType } from "../swaps/trusted/frombtcln_trusted/FromBtcLnTrusted";
import { IBitcoinWallet } from "../wallets/IBitcoinWallet";
import { ILightningWallet } from "../wallets/ILightningWallet";
import { SpvVault } from "../swaps/spv_vault_swap/SpvVault";
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
    onHandlePreFromBtcQuote?(swapType: SwapHandlerType.FROM_BTCLN | SwapHandlerType.FROM_BTC | SwapHandlerType.FROM_BTCLN_TRUSTED | SwapHandlerType.FROM_BTC_TRUSTED | SwapHandlerType.FROM_BTC_SPV, request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType | FromBtcTrustedRequestType | SpvVaultSwapRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
        token: string;
    }, chainIdentifier: string, constraints: {
        minInBtc: bigint;
        maxInBtc: bigint;
    }, fees: {
        baseFeeInBtc: bigint;
        feePPM: bigint;
    }, gasTokenAmount?: {
        input: false;
        amount: bigint;
        token: string;
    }): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh>;
    onHandlePostFromBtcQuote?(swapType: SwapHandlerType.FROM_BTCLN | SwapHandlerType.FROM_BTC | SwapHandlerType.FROM_BTCLN_TRUSTED | SwapHandlerType.FROM_BTC_TRUSTED | SwapHandlerType.FROM_BTC_SPV, request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType | FromBtcTrustedRequestType | SpvVaultSwapRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
        token: string;
        pricePrefetch?: Promise<bigint>;
    }, chainIdentifier: string, constraints: {
        minInBtc: bigint;
        maxInBtc: bigint;
    }, fees: {
        baseFeeInBtc: bigint;
        feePPM: bigint;
    }, gasTokenAmount?: {
        input: false;
        amount: bigint;
        token: string;
        pricePrefetch?: Promise<bigint>;
    }): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh | PluginQuote>;
    onHandlePreToBtcQuote?(swapType: SwapHandlerType.TO_BTCLN | SwapHandlerType.TO_BTC, request: RequestData<ToBtcLnRequestType | ToBtcRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
        token: string;
    }, chainIdentifier: string, constraints: {
        minInBtc: bigint;
        maxInBtc: bigint;
    }, fees: {
        baseFeeInBtc: bigint;
        feePPM: bigint;
    }): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh>;
    onHandlePostToBtcQuote?(swapType: SwapHandlerType.TO_BTCLN | SwapHandlerType.TO_BTC, request: RequestData<ToBtcLnRequestType | ToBtcRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
        token: string;
        pricePrefetch?: Promise<bigint>;
    }, chainIdentifier: string, constraints: {
        minInBtc: bigint;
        maxInBtc: bigint;
    }, fees: {
        baseFeeInBtc: bigint;
        feePPM: bigint;
        networkFeeGetter: (amount: bigint) => Promise<bigint>;
    }): Promise<QuoteThrow | QuoteSetFees | QuoteAmountTooLow | QuoteAmountTooHigh | ToBtcPluginQuote>;
    onVaultSelection?(chainIdentifier: string, totalSats: bigint, requestedAmount: {
        amount: bigint;
        token: string;
    }, gasAmount: {
        amount: bigint;
        token: string;
    }): Promise<SpvVault | QuoteThrow | QuoteAmountTooHigh | QuoteAmountTooLow | null>;
    /**
     * Returns whitelisted bitcoin txIds that are OK to spend even with 0-confs
     */
    getWhitelistedTxIds?(): string[];
    getCommands?(): Command<any>[];
}
