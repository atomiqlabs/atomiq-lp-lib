"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToBtcAmountAssertions = void 0;
const AmountAssertions_1 = require("./AmountAssertions");
const PluginManager_1 = require("../../plugins/PluginManager");
const IPlugin_1 = require("../../plugins/IPlugin");
class ToBtcAmountAssertions extends AmountAssertions_1.AmountAssertions {
    /**
     * Checks minimums/maximums, calculates the fee & total amount
     *
     * @param swapType
     * @param request
     * @param requestedAmount
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    async preCheckToBtcAmounts(swapType, request, requestedAmount) {
        const res = await PluginManager_1.PluginManager.onHandlePreToBtcQuote(swapType, request, requestedAmount, request.chainIdentifier, { minInBtc: this.config.min, maxInBtc: this.config.max }, { baseFeeInBtc: this.config.baseFee, feePPM: this.config.feePPM });
        if (res != null) {
            AmountAssertions_1.AmountAssertions.handlePluginErrorResponses(res);
            if ((0, IPlugin_1.isQuoteSetFees)(res)) {
                return {
                    baseFee: res.baseFee || this.config.baseFee,
                    feePPM: res.feePPM || this.config.feePPM
                };
            }
        }
        if (!requestedAmount.input) {
            this.checkBtcAmountInBounds(requestedAmount.amount);
        }
        return {
            baseFee: this.config.baseFee,
            feePPM: this.config.feePPM
        };
    }
    /**
     * Checks minimums/maximums, calculates network fee (based on the callback passed), swap fee & total amount
     *
     * @param swapType
     * @param request
     * @param requestedAmount
     * @param fees
     * @param getNetworkFee
     * @param signal
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds,
     *  or if we don't have enough funds (getNetworkFee callback throws)
     */
    async checkToBtcAmount(swapType, request, requestedAmount, fees, getNetworkFee, signal) {
        const chainIdentifier = request.chainIdentifier;
        const res = await PluginManager_1.PluginManager.onHandlePostToBtcQuote(swapType, request, requestedAmount, request.chainIdentifier, { minInBtc: this.config.min, maxInBtc: this.config.max }, { baseFeeInBtc: fees.baseFee, feePPM: fees.feePPM, networkFeeGetter: getNetworkFee });
        signal.throwIfAborted();
        if (res != null) {
            AmountAssertions_1.AmountAssertions.handlePluginErrorResponses(res);
            if ((0, IPlugin_1.isQuoteSetFees)(res)) {
                if (res.baseFee != null)
                    fees.baseFee = res.baseFee;
                if (res.feePPM != null)
                    fees.feePPM = res.feePPM;
            }
            if ((0, IPlugin_1.isToBtcPluginQuote)(res)) {
                if (requestedAmount.input) {
                    return {
                        amountBD: res.amount.amount,
                        swapFee: res.swapFee.inOutputTokens,
                        swapFeeInToken: res.swapFee.inInputTokens,
                        networkFee: res.networkFee.inOutputTokens,
                        networkFeeInToken: res.networkFee.inInputTokens,
                        networkFeeData: res.networkFeeData,
                        totalInToken: requestedAmount.amount
                    };
                }
                else {
                    return {
                        amountBD: requestedAmount.amount,
                        swapFee: res.swapFee.inOutputTokens,
                        swapFeeInToken: res.swapFee.inInputTokens,
                        networkFee: res.networkFee.inOutputTokens,
                        networkFeeInToken: res.networkFee.inInputTokens,
                        networkFeeData: res.networkFeeData,
                        totalInToken: res.amount.amount + res.swapFee.inInputTokens + res.networkFee.inInputTokens
                    };
                }
            }
        }
        let amountBD;
        let tooHigh = false;
        let tooLow = false;
        if (requestedAmount.input) {
            amountBD = await this.swapPricing.getToBtcSwapAmount(requestedAmount.amount, requestedAmount.token, chainIdentifier, null, requestedAmount.pricePrefetch);
            signal.throwIfAborted();
            //Decrease by base fee
            amountBD = amountBD - fees.baseFee;
            //If it's already smaller than minimum, set it to minimum so we can calculate the network fee
            if (amountBD < (this.config.min * 95n / 100n)) {
                amountBD = this.config.min;
                tooLow = true;
            }
            //If it's already larger than maximum, set it to maximum so we can calculate the network fee
            if (amountBD > (this.config.max * 105n / 100n)) {
                amountBD = this.config.max;
                tooHigh = true;
            }
        }
        else {
            amountBD = requestedAmount.amount;
            this.checkBtcAmountInBounds(amountBD);
        }
        const resp = await getNetworkFee(amountBD);
        signal.throwIfAborted();
        if (requestedAmount.input) {
            //Decrease by network fee
            amountBD = amountBD - resp.networkFee;
            //Decrease by percentage fee
            amountBD = amountBD * 1000000n / (fees.feePPM + 1000000n);
            tooHigh || (tooHigh = amountBD > (this.config.max * 105n / 100n));
            tooLow || (tooLow = amountBD < (this.config.min * 95n / 100n));
            if (tooLow || tooHigh) {
                //Compute min/max
                let adjustedMin = this.config.min * (fees.feePPM + 1000000n) / 1000000n;
                let adjustedMax = this.config.max * (fees.feePPM + 1000000n) / 1000000n;
                adjustedMin = adjustedMin + fees.baseFee + resp.networkFee;
                adjustedMax = adjustedMax + fees.baseFee + resp.networkFee;
                const minIn = await this.swapPricing.getFromBtcSwapAmount(adjustedMin, requestedAmount.token, chainIdentifier, null, requestedAmount.pricePrefetch);
                const maxIn = await this.swapPricing.getFromBtcSwapAmount(adjustedMax, requestedAmount.token, chainIdentifier, null, requestedAmount.pricePrefetch);
                throw {
                    code: tooLow ? 20003 : 20004,
                    msg: tooLow ? "Amount too low!" : "Amount too high!",
                    data: {
                        min: minIn.toString(10),
                        max: maxIn.toString(10)
                    }
                };
            }
        }
        const swapFee = fees.baseFee + (amountBD * fees.feePPM / 1000000n);
        const networkFeeInToken = await this.swapPricing.getFromBtcSwapAmount(resp.networkFee, requestedAmount.token, chainIdentifier, true, requestedAmount.pricePrefetch);
        const swapFeeInToken = await this.swapPricing.getFromBtcSwapAmount(swapFee, requestedAmount.token, chainIdentifier, true, requestedAmount.pricePrefetch);
        signal.throwIfAborted();
        let total;
        if (requestedAmount.input) {
            total = requestedAmount.amount;
        }
        else {
            const amountInToken = await this.swapPricing.getFromBtcSwapAmount(requestedAmount.amount, requestedAmount.token, chainIdentifier, true, requestedAmount.pricePrefetch);
            signal.throwIfAborted();
            total = amountInToken + swapFeeInToken + networkFeeInToken;
        }
        return { amountBD, networkFeeData: resp, swapFee, swapFeeInToken, networkFee: resp.networkFee, networkFeeInToken, totalInToken: total };
    }
}
exports.ToBtcAmountAssertions = ToBtcAmountAssertions;
