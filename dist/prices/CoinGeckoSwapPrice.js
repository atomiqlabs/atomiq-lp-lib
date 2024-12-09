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
exports.CoinGeckoSwapPrice = void 0;
const BN = require("bn.js");
const ISwapPrice_1 = require("../swaps/ISwapPrice");
const CACHE_DURATION = 15000;
class CoinGeckoSwapPrice extends ISwapPrice_1.ISwapPrice {
    constructor(url, coins) {
        const coinsMap = {};
        for (let coinId in coins) {
            const chains = coins[coinId];
            for (let chainId in chains) {
                const tokenData = chains[chainId];
                if (coinsMap[chainId] == null)
                    coinsMap[chainId] = {};
                coinsMap[chainId][tokenData.address] = {
                    coinId,
                    decimals: tokenData.decimals
                };
            }
        }
        super(coinsMap);
        this.cache = {};
        this.url = url || "https://api.coingecko.com/api/v3";
    }
    /**
     * Returns coin price in mSat
     *
     * @param coin
     */
    getPrice(coin) {
        return __awaiter(this, void 0, void 0, function* () {
            const coinId = coin.coinId;
            if (coinId.startsWith("$fixed-")) {
                const amt = parseFloat(coinId.substring(7));
                return new BN(Math.floor(amt * 1000));
            }
            const cachedValue = this.cache[coinId];
            if (cachedValue != null && cachedValue.expiry > Date.now()) {
                return cachedValue.price;
            }
            const response = yield fetch(this.url + "/simple/price?ids=" + coinId + "&vs_currencies=sats&precision=3", {
                method: "GET",
                headers: { 'Content-Type': 'application/json' }
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
            const amt = jsonBody[coinId].sats;
            const result = new BN(amt * 1000);
            this.cache[coinId] = {
                price: result,
                expiry: Date.now() + CACHE_DURATION
            };
            return result;
        });
    }
}
exports.CoinGeckoSwapPrice = CoinGeckoSwapPrice;
