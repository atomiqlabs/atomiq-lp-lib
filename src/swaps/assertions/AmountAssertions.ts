import {ISwapPrice} from "../../prices/ISwapPrice";
import {isQuoteAmountTooHigh, isQuoteAmountTooLow, isQuoteThrow} from "../../plugins/IPlugin";

export type AmountAssertionsConfig = {min: bigint, max: bigint, baseFee: bigint, feePPM: bigint};

export abstract class AmountAssertions {

    readonly config: AmountAssertionsConfig;
    readonly swapPricing: ISwapPrice;

    constructor(config: AmountAssertionsConfig, swapPricing: ISwapPrice) {
        this.config = config;
        this.swapPricing = swapPricing;
    }

    /**
     * Checks whether the bitcoin amount is within specified min/max bounds
     *
     * @param amount
     * @protected
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    protected checkBtcAmountInBounds(amount: bigint): void {
        if (amount < this.config.min) {
            throw {
                code: 20003,
                msg: "Amount too low!",
                data: {
                    min: this.config.min.toString(10),
                    max: this.config.max.toString(10)
                }
            };
        }

        if(amount > this.config.max) {
            throw {
                code: 20004,
                msg: "Amount too high!",
                data: {
                    min: this.config.min.toString(10),
                    max: this.config.max.toString(10)
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
    protected handlePluginErrorResponses(res: any): void {
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