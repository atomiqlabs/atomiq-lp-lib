import {ISwapPrice} from "../../prices/ISwapPrice";
import {isQuoteAmountTooHigh, isQuoteAmountTooLow, isQuoteThrow} from "../../plugins/IPlugin";

export type AmountAssertionsConfig = {
    min: bigint,
    max: bigint,
    baseFee: bigint,
    feePPM: bigint,

    minMaxOverrides?: {
        [chainIdentifier: string]: {min: bigint, max: bigint}
    }
};

export abstract class AmountAssertions {

    readonly config: AmountAssertionsConfig;
    readonly swapPricing: ISwapPrice;

    constructor(config: AmountAssertionsConfig, swapPricing: ISwapPrice) {
        this.config = config;
        this.swapPricing = swapPricing;
    }

    getSwapMinimum(chainIdentifier: string) {
        return this.config.minMaxOverrides?.[chainIdentifier]?.min ?? this.config.min;
    }

    getSwapMaximum(chainIdentifier: string) {
        return this.config.minMaxOverrides?.[chainIdentifier]?.max ?? this.config.max;
    }

    /**
     * Checks whether the bitcoin amount is within specified min/max bounds
     *
     * @param amount
     * @param chainIdentifier
     * @protected
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    protected checkBtcAmountInBounds(amount: bigint, chainIdentifier: string): void {
        const min = this.getSwapMinimum(chainIdentifier);
        const max = this.getSwapMaximum(chainIdentifier);
        if (amount < min) {
            throw {
                code: 20003,
                msg: "Amount too low!",
                data: {
                    min: min.toString(10),
                    max: max.toString(10)
                }
            };
        }

        if(amount > max) {
            throw {
                code: 20004,
                msg: "Amount too high!",
                data: {
                    min: min.toString(10),
                    max: max.toString(10)
                }
            };
        }
    }

    /**
     * Handles and throws plugin errors
     *
     * @param res Response as returned from the PluginManager.onHandlePost{To,From}BtcQuote
     * @protected
     * @throws {DefinedRuntimeError} will throw an error if the response is an error
     */
    static handlePluginErrorResponses(res: any): void {
        if(res==null) return;
        if(isQuoteThrow(res)) throw {
            code: 29999,
            msg: res.message
        };
        if(isQuoteAmountTooHigh(res)) throw {
            code: 20004,
            msg: "Amount too high!",
            data: {
                min: res.data.min.toString(10),
                max: res.data.max.toString(10)
            }
        };
        if(isQuoteAmountTooLow(res)) throw {
            code: 20003,
            msg: "Amount too low!",
            data: {
                min: res.data.min.toString(10),
                max: res.data.max.toString(10)
            }
        };
    }

}