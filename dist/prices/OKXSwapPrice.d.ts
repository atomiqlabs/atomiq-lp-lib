import { ISwapPrice, ISwapPriceCoinsMap } from "./ISwapPrice";
export type OKXPriceData = {
    [pair: string]: {
        [chainId: string]: {
            address: string;
            decimals: number;
        };
    };
};
export declare class OKXSwapPrice extends ISwapPrice<{
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
    constructor(url: string, coins: ISwapPriceCoinsMap<{
        pair: string;
        decimals: number;
    }>);
    fetchPrice(pair: string): Promise<number>;
    getPrice(tokenData: {
        pair: string;
    }): Promise<bigint>;
}
