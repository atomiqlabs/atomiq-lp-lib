export type ISwapPriceCoinsMap<T extends {decimals: number}> = {
    [chainId: string]: {
        [address: string]: T
    }
};

export abstract class ISwapPrice<T extends {decimals: number} = {decimals: number}> {

    protected coinsMap: ISwapPriceCoinsMap<T>;

    protected constructor(coinsMap: ISwapPriceCoinsMap<T>) {
        this.coinsMap = coinsMap;
    }

    /**
     * Returns coin price in mSat
     *
     * @param tokenData
     */
    protected abstract getPrice(tokenData: T): Promise<bigint>;

    getTokenData(tokenAddress: string, chainId: string): T {
        const chainTokens = this.coinsMap[chainId];
        if(chainTokens==null) throw new Error("Chain not found");

        const tokenAddr: string = tokenAddress.toString();
        const coin: T = chainTokens[tokenAddr];
        if(coin==null) throw new Error("Token not found");

        return coin;
    }

    preFetchPrice(token: string, chainId: string): Promise<bigint> {
        const coin = this.getTokenData(token, chainId);
        return this.getPrice(coin);
    }

    /**
     * Returns amount of satoshis that are equivalent to {fromAmount} of {fromToken}
     *
     * @param fromAmount Amount of the token
     * @param fromToken Token
     * @param tokenChainIdentification Chain of the token
     * @param roundUp Whether result should be rounded up
     * @param preFetch Price pre-fetch promise returned from preFetchPrice()
     */
    async getToBtcSwapAmount(
        fromAmount:bigint,
        fromToken: string,
        tokenChainIdentification: string,
        roundUp?: boolean,
        preFetch?: Promise<bigint>
    ): Promise<bigint> {
        if(fromAmount===0n) return 0n;

        const coin = this.getTokenData(fromToken, tokenChainIdentification);

        const price = (preFetch==null ? null : await preFetch) || await this.getPrice(coin);

        return ((fromAmount * price / (10n ** BigInt(coin.decimals))) + (roundUp ? 999999n : 0n)) / 1000000n;
    }

    /**
     * Returns amount of {toToken} that are equivalent to {fromAmount} satoshis
     *
     * @param fromAmount Amount of satoshis
     * @param toToken Token
     * @param tokenChainIdentification Chain of the token
     * @param roundUp Whether result should be rounded up
     * @param preFetch Price pre-fetch promise returned from preFetchPrice()
     */
    async getFromBtcSwapAmount(
        fromAmount: bigint,
        toToken: string,
        tokenChainIdentification: string,
        roundUp?: boolean,
        preFetch?: Promise<bigint>
    ): Promise<bigint> {
        if(fromAmount===0n) return 0n;

        const coin = this.getTokenData(toToken, tokenChainIdentification);

        const price = (preFetch==null ? null : await preFetch) || await this.getPrice(coin);

        return ((fromAmount * (10n ** BigInt(coin.decimals)) * 1000000n) + (roundUp ? price - 1n : 0n)) / price;
    }

}
