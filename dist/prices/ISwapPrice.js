"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ISwapPrice = void 0;
class ISwapPrice {
    constructor(coinsMap) {
        this.coinsMap = coinsMap;
    }
    getTokenData(tokenAddress, chainId) {
        const chainTokens = this.coinsMap[chainId];
        if (chainTokens == null)
            throw new Error("Chain not found");
        const tokenAddr = tokenAddress.toString();
        const coin = chainTokens[tokenAddr];
        if (coin == null)
            throw new Error("Token not found");
        return coin;
    }
    preFetchPrice(token, chainId) {
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
    async getToBtcSwapAmount(fromAmount, fromToken, tokenChainIdentification, roundUp, preFetch) {
        const coin = this.getTokenData(fromToken, tokenChainIdentification);
        const price = (preFetch == null ? null : await preFetch) || await this.getPrice(coin);
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
    async getFromBtcSwapAmount(fromAmount, toToken, tokenChainIdentification, roundUp, preFetch) {
        const coin = this.getTokenData(toToken, tokenChainIdentification);
        const price = (preFetch == null ? null : await preFetch) || await this.getPrice(coin);
        return ((fromAmount * (10n ** BigInt(coin.decimals)) * 1000000n) + (roundUp ? price - 1n : 0n)) / price;
    }
}
exports.ISwapPrice = ISwapPrice;
