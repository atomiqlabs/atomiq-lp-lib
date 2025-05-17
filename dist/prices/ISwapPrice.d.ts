export type ISwapPriceCoinsMap<T extends {
    decimals: number;
}> = {
    [chainId: string]: {
        [address: string]: T;
    };
};
export declare abstract class ISwapPrice<T extends {
    decimals: number;
} = {
    decimals: number;
}> {
    protected coinsMap: ISwapPriceCoinsMap<T>;
    protected constructor(coinsMap: ISwapPriceCoinsMap<T>);
    /**
     * Returns coin price in mSat
     *
     * @param tokenData
     */
    protected abstract getPrice(tokenData: T): Promise<bigint>;
    getTokenData(tokenAddress: string, chainId: string): T;
    preFetchPrice(token: string, chainId: string): Promise<bigint>;
    /**
     * Returns amount of satoshis that are equivalent to {fromAmount} of {fromToken}
     *
     * @param fromAmount Amount of the token
     * @param fromToken Token
     * @param tokenChainIdentification Chain of the token
     * @param roundUp Whether result should be rounded up
     * @param preFetch Price pre-fetch promise returned from preFetchPrice()
     */
    getToBtcSwapAmount(fromAmount: bigint, fromToken: string, tokenChainIdentification: string, roundUp?: boolean, preFetch?: Promise<bigint>): Promise<bigint>;
    /**
     * Returns amount of {toToken} that are equivalent to {fromAmount} satoshis
     *
     * @param fromAmount Amount of satoshis
     * @param toToken Token
     * @param tokenChainIdentification Chain of the token
     * @param roundUp Whether result should be rounded up
     * @param preFetch Price pre-fetch promise returned from preFetchPrice()
     */
    getFromBtcSwapAmount(fromAmount: bigint, toToken: string, tokenChainIdentification: string, roundUp?: boolean, preFetch?: Promise<bigint>): Promise<bigint>;
}
