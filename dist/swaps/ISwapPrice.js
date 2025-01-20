"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ISwapPrice = void 0;
const BN = require("bn.js");
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
    getToBtcSwapAmount(fromAmount, fromToken, tokenChainIdentification, roundUp, preFetch) {
        return __awaiter(this, void 0, void 0, function* () {
            const coin = this.getTokenData(fromToken, tokenChainIdentification);
            const price = (preFetch == null ? null : yield preFetch) || (yield this.getPrice(coin));
            return fromAmount
                .mul(price)
                .div(new BN(10).pow(new BN(coin.decimals)))
                .add(roundUp ? new BN(999999) : new BN(0))
                .div(new BN(1000000));
        });
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
    getFromBtcSwapAmount(fromAmount, toToken, tokenChainIdentification, roundUp, preFetch) {
        return __awaiter(this, void 0, void 0, function* () {
            const coin = this.getTokenData(toToken, tokenChainIdentification);
            const price = (preFetch == null ? null : yield preFetch) || (yield this.getPrice(coin));
            return fromAmount
                .mul(new BN(10).pow(new BN(coin.decimals)))
                .mul(new BN(1000000)) //To usat
                .add(roundUp ? price.sub(new BN(1)) : new BN(0))
                .div(price);
        });
    }
}
exports.ISwapPrice = ISwapPrice;
