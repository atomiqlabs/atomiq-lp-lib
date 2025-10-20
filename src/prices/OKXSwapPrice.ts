import {ISwapPrice, ISwapPriceCoinsMap} from "./ISwapPrice";

const CACHE_DURATION = 15000;

export type OKXPriceData = {
    [pair: string]: {
        [chainId: string]: {
            address: string,
            decimals: number
        }
    }
};

export class OKXSwapPrice extends ISwapPrice<{ pair: string, decimals: number }> {

    url: string;
    cache: {
        [pair: string]: {
            price: number,
            expiry: number
        }
    } = {};

    constructor(url: string, coins: ISwapPriceCoinsMap<{pair: string, decimals: number}>) {
        super(coins);
        this.url = url || "https://www.okx.com/api/v5";
    }

    async fetchPrice(pair: string) {
        const response: Response = await fetch(this.url+"/market/index-tickers?instId=" + pair, {
            method: "GET"
        });

        if (response.status !== 200) {
            let resp: string;
            try {
                resp = await response.text();
            } catch (e) {
                throw new Error(response.statusText);
            }
            throw new Error(resp);
        }

        let jsonBody: any = await response.json();

        return parseFloat(jsonBody.data[0].idxPx);
    }

    async getPrice(tokenData: {pair: string}): Promise<bigint> {
        const pair = tokenData.pair;
        if(pair.startsWith("$fixed-")) {
            const amt: number = parseFloat(pair.substring(7));
            return BigInt(Math.floor(amt*1000000));
        }

        const arr = pair.split(";");

        const promises = [];
        const cachedValue = this.cache[pair];
        if(cachedValue==null || cachedValue.expiry<Date.now()) {
            let resultPrice = 1;
            for (let pair of arr) {
                let invert = false
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
                        } else {
                            resultPrice *= price;
                        }
                    }));
                } else {
                    if (invert) {
                        resultPrice /= cachedValue.price;
                    } else {
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

        return BigInt(Math.floor(this.cache[pair].price*100000000000000));
    }
}
