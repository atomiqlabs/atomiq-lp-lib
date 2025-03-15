import {AmountAssertions} from "./AmountAssertions";
import {ToBtcLnRequestType} from "../escrow/tobtcln_abstract/ToBtcLnAbs";
import {ToBtcRequestType} from "../escrow/tobtc_abstract/ToBtcAbs";
import {PluginManager} from "../../plugins/PluginManager";
import {isQuoteSetFees, isToBtcPluginQuote} from "../../plugins/IPlugin";
import {RequestData} from "../SwapHandler";


export class ToBtcAmountAssertions extends AmountAssertions {

    /**
     * Checks minimums/maximums, calculates the fee & total amount
     *
     * @param request
     * @param requestedAmount
     * @param useToken
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    async preCheckToBtcAmounts(
        request: RequestData<ToBtcLnRequestType | ToBtcRequestType>,
        requestedAmount: {input: boolean, amount: bigint},
        useToken: string
    ): Promise<{baseFee: bigint, feePPM: bigint}> {
        const res = await PluginManager.onHandlePreToBtcQuote(
            request,
            requestedAmount,
            request.chainIdentifier,
            useToken,
            {minInBtc: this.config.min, maxInBtc: this.config.max},
            {baseFeeInBtc: this.config.baseFee, feePPM: this.config.feePPM},
        );
        if(res!=null) {
            this.handlePluginErrorResponses(res);
            if(isQuoteSetFees(res)) {
                return {
                    baseFee: res.baseFee || this.config.baseFee,
                    feePPM: res.feePPM || this.config.feePPM
                }
            }
        }
        if(!requestedAmount.input) {
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
     * @param request
     * @param requestedAmount
     * @param fees
     * @param useToken
     * @param getNetworkFee
     * @param signal
     * @param pricePrefetchPromise
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds,
     *  or if we don't have enough funds (getNetworkFee callback throws)
     */
    async checkToBtcAmount<T extends {networkFee: bigint}>(
        request: RequestData<ToBtcLnRequestType | ToBtcRequestType>,
        requestedAmount: {input: boolean, amount: bigint},
        fees: {baseFee: bigint, feePPM: bigint},
        useToken: string,
        getNetworkFee: (amount: bigint) => Promise<T>,
        signal: AbortSignal,
        pricePrefetchPromise?: Promise<bigint>
    ): Promise<{
        amountBD: bigint,
        networkFeeData: T,
        swapFee: bigint,
        swapFeeInToken: bigint,
        networkFee: bigint,
        networkFeeInToken: bigint,
        totalInToken: bigint
    }> {
        const chainIdentifier = request.chainIdentifier;

        const res = await PluginManager.onHandlePostToBtcQuote<T>(
            request,
            requestedAmount,
            request.chainIdentifier,
            useToken,
            {minInBtc: this.config.min, maxInBtc: this.config.max},
            {baseFeeInBtc: fees.baseFee, feePPM: fees.feePPM, networkFeeGetter: getNetworkFee},
            pricePrefetchPromise
        );
        signal.throwIfAborted();
        if(res!=null) {
            this.handlePluginErrorResponses(res);
            if(isQuoteSetFees(res)) {
                if(res.baseFee!=null) fees.baseFee = res.baseFee;
                if(res.feePPM!=null) fees.feePPM = res.feePPM;
            }
            if(isToBtcPluginQuote(res)) {
                if(requestedAmount.input) {
                    return {
                        amountBD: res.amount.amount,
                        swapFee: res.swapFee.inOutputTokens,
                        swapFeeInToken: res.swapFee.inInputTokens,
                        networkFee: res.networkFee.inOutputTokens,
                        networkFeeInToken: res.networkFee.inInputTokens,
                        networkFeeData: res.networkFeeData,
                        totalInToken: requestedAmount.amount
                    }
                } else {
                    return {
                        amountBD: requestedAmount.amount,
                        swapFee: res.swapFee.inOutputTokens,
                        swapFeeInToken: res.swapFee.inInputTokens,
                        networkFee: res.networkFee.inOutputTokens,
                        networkFeeInToken: res.networkFee.inInputTokens,
                        networkFeeData: res.networkFeeData,
                        totalInToken: res.amount.amount + res.swapFee.inInputTokens + res.networkFee.inInputTokens
                    }
                }
            }
        }

        let amountBD: bigint;
        let tooLow = false;
        if(requestedAmount.input) {
            amountBD = await this.swapPricing.getToBtcSwapAmount(requestedAmount.amount, useToken, chainIdentifier, null, pricePrefetchPromise);
            signal.throwIfAborted();

            //Decrease by base fee
            amountBD = amountBD - fees.baseFee;

            //If it's already smaller than minimum, set it to minimum so we can calculate the network fee
            if(amountBD < this.config.min) {
                amountBD = this.config.min;
                tooLow = true;
            }
        } else {
            amountBD = requestedAmount.amount;
            this.checkBtcAmountInBounds(amountBD);
        }

        const resp = await getNetworkFee(amountBD);
        signal.throwIfAborted();

        if(requestedAmount.input) {
            //Decrease by network fee
            amountBD = amountBD - resp.networkFee;

            //Decrease by percentage fee
            amountBD = amountBD * 1000000n / (fees.feePPM + 1000000n);

            const tooHigh = amountBD > (this.config.max * 105n / 100n);
            tooLow ||= amountBD < (this.config.min * 95n / 100n);
            if(tooLow || tooHigh) {
                //Compute min/max
                let adjustedMin = this.config.min * (fees.feePPM + 1000000n) / 1000000n;
                let adjustedMax = this.config.max * (fees.feePPM + 1000000n) / 1000000n;
                adjustedMin = adjustedMin + fees.baseFee + resp.networkFee;
                adjustedMax = adjustedMax + fees.baseFee + resp.networkFee;
                const minIn = await this.swapPricing.getFromBtcSwapAmount(
                    adjustedMin, useToken, chainIdentifier, null, pricePrefetchPromise
                );
                const maxIn = await this.swapPricing.getFromBtcSwapAmount(
                    adjustedMax, useToken, chainIdentifier, null, pricePrefetchPromise
                );
                throw {
                    code: tooLow ? 20003 : 2004,
                    msg: tooLow ? "Amount too low!" : "Amount too high!",
                    data: {
                        min: minIn.toString(10),
                        max: maxIn.toString(10)
                    }
                };
            }
        }

        const swapFee = fees.baseFee + (amountBD * fees.feePPM / 1000000n);

        const networkFeeInToken = await this.swapPricing.getFromBtcSwapAmount(
            resp.networkFee, useToken, chainIdentifier, true, pricePrefetchPromise
        );
        const swapFeeInToken = await this.swapPricing.getFromBtcSwapAmount(
            swapFee, useToken, chainIdentifier, true, pricePrefetchPromise
        );
        signal.throwIfAborted();

        let total: bigint;
        if(requestedAmount.input) {
            total = requestedAmount.amount;
        } else {
            const amountInToken = await this.swapPricing.getFromBtcSwapAmount(
                requestedAmount.amount, useToken, chainIdentifier, true, pricePrefetchPromise
            );
            signal.throwIfAborted();
            total = amountInToken + swapFeeInToken + networkFeeInToken;
        }

        return {amountBD, networkFeeData: resp, swapFee, swapFeeInToken, networkFee: resp.networkFee, networkFeeInToken, totalInToken: total};
    }

}