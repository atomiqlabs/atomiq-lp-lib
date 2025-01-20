import * as BN from "bn.js";
import { ISwapPrice } from "../swaps/ISwapPrice";
export type BinancePriceData = {
    [pair: string]: {
        [chainId: string]: {
            address: string;
            decimals: number;
        };
    };
};
export declare class BinanceSwapPrice extends ISwapPrice<{
    pair: string;
    decimals: number;
}> {
    url: string;
    cache: {
        [pair: string]: {
            price: number;
            expiry: number;
        };
    };
    constructor(url: string, coins: BinancePriceData);
    fetchPrice(pair: string): Promise<number>;
    getPrice(tokenData: {
        pair: string;
    }): Promise<BN>;
}
