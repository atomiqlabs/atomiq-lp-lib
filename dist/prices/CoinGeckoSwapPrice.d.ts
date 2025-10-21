import { ISwapPrice, ISwapPriceCoinsMap } from "./ISwapPrice";
export type CoinGeckoPriceData = {
    [coinId: string]: {
        [chainId: string]: {
            address: string;
            decimals: number;
        };
    };
};
export declare class CoinGeckoSwapPrice extends ISwapPrice<{
    coinId: string;
    decimals: number;
}> {
    url: string;
    cache: {
        [coinId: string]: {
            price: bigint;
            expiry: number;
        };
    };
    constructor(url: string, coins: ISwapPriceCoinsMap<{
        coinId: string;
        decimals: number;
    }>);
    /**
     * Returns coin price in mSat
     *
     * @param coin
     */
    getPrice(coin: {
        coinId: string;
    }): Promise<bigint>;
}
