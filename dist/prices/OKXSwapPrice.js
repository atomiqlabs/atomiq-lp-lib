"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OKXSwapPrice = void 0;
const ISwapPrice_1 = require("./ISwapPrice");
const CACHE_DURATION = 15000;
class OKXSwapPrice extends ISwapPrice_1.ISwapPrice {
    constructor(url, coins) {
        const coinsMap = {};
        for (let pair in coins) {
            const chains = coins[pair];
            for (let chainId in chains) {
                const tokenData = chains[chainId];
                if (coinsMap[chainId] == null)
                    coinsMap[chainId] = {};
                coinsMap[chainId][tokenData.address] = {
                    pair,
                    decimals: tokenData.decimals
                };
            }
        }
        super(coinsMap);
        this.cache = {};
        this.url = url || "https://www.okx.com/api/v5";
    }
    async fetchPrice(pair) {
        const response = await fetch(this.url + "/market/index-tickers?instId=" + pair, {
            method: "GET"
        });
        if (response.status !== 200) {
            let resp;
            try {
                resp = await response.text();
            }
            catch (e) {
                throw new Error(response.statusText);
            }
            throw new Error(resp);
        }
        let jsonBody = await response.json();
        return parseFloat(jsonBody.data[0].idxPx);
    }
    async getPrice(tokenData) {
        const pair = tokenData.pair;
        if (pair.startsWith("$fixed-")) {
            const amt = parseFloat(pair.substring(7));
            return BigInt(Math.floor(amt * 1000000));
        }
        const arr = pair.split(";");
        const promises = [];
        const cachedValue = this.cache[pair];
        if (cachedValue == null || cachedValue.expiry < Date.now()) {
            let resultPrice = 1;
            for (let pair of arr) {
                let invert = false;
                if (pair.startsWith("!")) {
                    invert = true;
                    pair = pair.substring(1);
                }
                const cachedValue = this.cache[pair];
                if (cachedValue == null || cachedValue.expiry < Date.now()) {
                    promises.push(this.fetchPrice(pair).then(price => {
                        this.cache[pair] = {
                            price,
                            expiry: Date.now() + CACHE_DURATION
                        };
                        if (invert) {
                            resultPrice /= price;
                        }
                        else {
                            resultPrice *= price;
                        }
                    }));
                }
                else {
                    if (invert) {
                        resultPrice /= cachedValue.price;
                    }
                    else {
                        resultPrice *= cachedValue.price;
                    }
                }
            }
            await Promise.all(promises);
            this.cache[pair] = {
                price: resultPrice,
                expiry: Date.now() + CACHE_DURATION
            };
        }
        return BigInt(Math.floor(this.cache[pair].price * 100000000000000));
    }
}
exports.OKXSwapPrice = OKXSwapPrice;
