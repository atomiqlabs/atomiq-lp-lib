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
exports.OKXSwapPrice = void 0;
const BN = require("bn.js");
const ISwapPrice_1 = require("../swaps/ISwapPrice");
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
    fetchPrice(pair) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield fetch(this.url + "/market/index-tickers?instId=" + pair, {
                method: "GET"
            });
            if (response.status !== 200) {
                let resp;
                try {
                    resp = yield response.text();
                }
                catch (e) {
                    throw new Error(response.statusText);
                }
                throw new Error(resp);
            }
            let jsonBody = yield response.json();
            return parseFloat(jsonBody.data[0].idxPx);
        });
    }
    getPrice(tokenData) {
        return __awaiter(this, void 0, void 0, function* () {
            const pair = tokenData.pair;
            if (pair.startsWith("$fixed-")) {
                const amt = parseFloat(pair.substring(7));
                return new BN(Math.floor(amt * 1000000));
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
                yield Promise.all(promises);
                this.cache[pair] = {
                    price: resultPrice,
                    expiry: Date.now() + CACHE_DURATION
                };
            }
            return new BN(Math.floor(this.cache[pair].price * 100000000000000));
        });
    }
}
exports.OKXSwapPrice = OKXSwapPrice;
