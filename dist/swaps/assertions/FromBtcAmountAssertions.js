"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcAmountAssertions = void 0;
const PluginManager_1 = require("../../plugins/PluginManager");
const IPlugin_1 = require("../../plugins/IPlugin");
const AmountAssertions_1 = require("./AmountAssertions");
class FromBtcAmountAssertions extends AmountAssertions_1.AmountAssertions {
    constructor(config, swapPricing) {
        super(config, swapPricing);
        this.config = config;
    }
    /**
     * Checks minimums/maximums, calculates the fee & total amount
     *
     * @param swapType
     * @param request
     * @param requestedAmount
     * @param gasAmount
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    async preCheckFromBtcAmounts(swapType, request, requestedAmount, gasAmount) {
        const res = await PluginManager_1.PluginManager.onHandlePreFromBtcQuote(swapType, request, requestedAmount, request.chainIdentifier, { minInBtc: this.config.min, maxInBtc: this.config.max }, { baseFeeInBtc: this.config.baseFee, feePPM: this.config.feePPM }, gasAmount);
        if (res != null) {
            AmountAssertions_1.AmountAssertions.handlePluginErrorResponses(res);
            if ((0, IPlugin_1.isQuoteSetFees)(res)) {
                return {
                    baseFee: res.baseFee || this.config.baseFee,
                    feePPM: res.feePPM || this.config.feePPM,
                    securityDepositApyPPM: res.securityDepositApyPPM,
                    securityDepositBaseMultiplierPPM: res.securityDepositBaseMultiplierPPM
                };
            }
        }
        if (requestedAmount.input)
            this.checkBtcAmountInBounds(requestedAmount.amount);
        if (gasAmount != null && gasAmount.amount !== 0n) {
            if (gasAmount.amount > (this.config.gasTokenMax?.[request.chainIdentifier] ?? 0n)) {
                throw {
                    code: 20504,
                    msg: "Gas token amount too high!",
                    data: {
                        max: (this.config.gasTokenMax?.[request.chainIdentifier] ?? 0n).toString(10)
                    }
                };
            }
        }
        return {
            baseFee: this.config.baseFee,
            feePPM: this.config.feePPM
        };
    }
    /**
     * Checks minimums/maximums, calculates the fee & total amount
     *
     * @param swapType
     * @param request
     * @param requestedAmount
     * @param fees
     * @param signal
     * @param gasTokenAmount
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    async checkFromBtcAmount(swapType, request, requestedAmount, fees, signal, gasTokenAmount) {
        const chainIdentifier = request.chainIdentifier;
        let securityDepositApyPPM;
        let securityDepositBaseMultiplierPPM;
        const res = await PluginManager_1.PluginManager.onHandlePostFromBtcQuote(swapType, request, requestedAmount, chainIdentifier, { minInBtc: this.config.min, maxInBtc: this.config.max }, { baseFeeInBtc: fees.baseFee, feePPM: fees.feePPM }, gasTokenAmount);
        signal.throwIfAborted();
        if (res != null) {
            AmountAssertions_1.AmountAssertions.handlePluginErrorResponses(res);
            if ((0, IPlugin_1.isQuoteSetFees)(res)) {
                if (res.baseFee != null)
                    fees.baseFee = res.baseFee;
                if (res.feePPM != null)
                    fees.feePPM = res.feePPM;
                if (res.securityDepositApyPPM != null)
                    securityDepositApyPPM = res.securityDepositApyPPM;
                if (res.securityDepositBaseMultiplierPPM != null)
                    securityDepositBaseMultiplierPPM = res.securityDepositBaseMultiplierPPM;
            }
            if ((0, IPlugin_1.isPluginQuote)(res)) {
                if (!requestedAmount.input) {
                    return {
                        amountBD: res.amount.amount + res.swapFee.inInputTokens,
                        swapFee: res.swapFee.inInputTokens,
                        swapFeeInToken: res.swapFee.inOutputTokens,
                        totalInToken: requestedAmount.amount
                    };
                }
                else {
                    return {
                        amountBD: requestedAmount.amount,
                        swapFee: res.swapFee.inInputTokens,
                        swapFeeInToken: res.swapFee.inOutputTokens,
                        totalInToken: res.amount.amount
                    };
                }
            }
        }
        let amountBDgas = 0n;
        if (gasTokenAmount != null) {
            amountBDgas = await this.swapPricing.getToBtcSwapAmount(gasTokenAmount.amount, gasTokenAmount.token, chainIdentifier, true, gasTokenAmount.pricePrefetch);
        }
        let amountBD;
        if (!requestedAmount.input) {
            amountBD = await this.swapPricing.getToBtcSwapAmount(requestedAmount.amount, requestedAmount.token, chainIdentifier, true, requestedAmount.pricePrefetch);
            signal.throwIfAborted();
            // amt = (amt+base_fee)/(1-fee)
            amountBD = (amountBD + fees.baseFee) * 1000000n / (1000000n - fees.feePPM);
            amountBDgas = amountBDgas * 1000000n / (1000000n - fees.feePPM);
            const tooLow = amountBD < (this.config.min * 95n / 100n);
            const tooHigh = amountBD > (this.config.max * 105n / 100n);
            if (tooLow || tooHigh) {
                const adjustedMin = this.config.min * (1000000n - fees.feePPM) / (1000000n - fees.baseFee);
                const adjustedMax = this.config.max * (1000000n - fees.feePPM) / (1000000n - fees.baseFee);
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
        else {
            amountBD = requestedAmount.amount - amountBDgas;
            this.checkBtcAmountInBounds(amountBD);
        }
        const swapFee = fees.baseFee + (amountBD * fees.feePPM / 1000000n);
        const swapFeeInToken = await this.swapPricing.getFromBtcSwapAmount(swapFee, requestedAmount.token, chainIdentifier, true, requestedAmount.pricePrefetch);
        signal.throwIfAborted();
        const gasSwapFee = ((amountBDgas * fees.feePPM) + 999999n) / 1000000n;
        const gasSwapFeeInToken = gasTokenAmount == null ?
            0n :
            await this.swapPricing.getFromBtcSwapAmount(gasSwapFee, gasTokenAmount.token, chainIdentifier, true, gasTokenAmount.pricePrefetch);
        signal.throwIfAborted();
        let totalInToken;
        if (!requestedAmount.input) {
            totalInToken = requestedAmount.amount;
        }
        else {
            totalInToken = await this.swapPricing.getFromBtcSwapAmount(amountBD - swapFee - gasSwapFee, requestedAmount.token, chainIdentifier, null, requestedAmount.pricePrefetch);
            signal.throwIfAborted();
        }
        return {
            amountBD,
            swapFee,
            swapFeeInToken,
            totalInToken,
            amountBDgas,
            gasSwapFee,
            gasSwapFeeInToken,
            totalInGasToken: gasTokenAmount?.amount,
            securityDepositApyPPM,
            securityDepositBaseMultiplierPPM
        };
    }
}
exports.FromBtcAmountAssertions = FromBtcAmountAssertions;
