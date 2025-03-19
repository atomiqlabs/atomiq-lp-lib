"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmountAssertions = void 0;
const IPlugin_1 = require("../../plugins/IPlugin");
class AmountAssertions {
    constructor(config, swapPricing) {
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
    checkBtcAmountInBounds(amount) {
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
        if (amount > this.config.max) {
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
    static handlePluginErrorResponses(res) {
        if ((0, IPlugin_1.isQuoteThrow)(res))
            throw {
                code: 29999,
                msg: res.message
            };
        if ((0, IPlugin_1.isQuoteAmountTooHigh)(res))
            throw {
                code: 20004,
                msg: "Amount too high!",
                data: {
                    min: res.data.min.toString(10),
                    max: res.data.max.toString(10)
                }
            };
        if ((0, IPlugin_1.isQuoteAmountTooLow)(res))
            throw {
                code: 20003,
                msg: "Amount too low!",
                data: {
                    min: res.data.min.toString(10),
                    max: res.data.max.toString(10)
                }
            };
    }
}
exports.AmountAssertions = AmountAssertions;
