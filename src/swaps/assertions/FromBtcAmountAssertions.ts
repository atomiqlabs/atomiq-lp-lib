import {FromBtcLnRequestType} from "../escrow/frombtcln_abstract/FromBtcLnAbs";
import {FromBtcRequestType} from "../escrow/frombtc_abstract/FromBtcAbs";
import {FromBtcLnTrustedRequestType} from "../trusted/frombtcln_trusted/FromBtcLnTrusted";
import {PluginManager} from "../../plugins/PluginManager";
import {isPluginQuote, isQuoteSetFees} from "../../plugins/IPlugin";
import {RequestData} from "../SwapHandler";
import {AmountAssertions} from "./AmountAssertions";

export class FromBtcAmountAssertions extends AmountAssertions {


    /**
     * Checks minimums/maximums, calculates the fee & total amount
     *
     * @param request
     * @param requestedAmount
     * @param useToken
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    async preCheckFromBtcAmounts(
        request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType>,
        requestedAmount: {input: boolean, amount: bigint},
        useToken: string
    ): Promise<{
        baseFee: bigint,
        feePPM: bigint,
        securityDepositApyPPM?: bigint,
        securityDepositBaseMultiplierPPM?: bigint,
    }> {
        const res = await PluginManager.onHandlePreFromBtcQuote(
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
                    feePPM: res.feePPM || this.config.feePPM,
                    securityDepositApyPPM: res.securityDepositApyPPM,
                    securityDepositBaseMultiplierPPM: res.securityDepositBaseMultiplierPPM
                }
            }
        }
        if(requestedAmount.input) this.checkBtcAmountInBounds(requestedAmount.amount);
        return {
            baseFee: this.config.baseFee,
            feePPM: this.config.feePPM
        };
    }

    /**
     * Checks minimums/maximums, calculates the fee & total amount
     *
     * @param request
     * @param requestedAmount
     * @param fees
     * @param useToken
     * @param signal
     * @param pricePrefetchPromise
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    async checkFromBtcAmount(
        request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType>,
        requestedAmount: {input: boolean, amount: bigint},
        fees: {baseFee: bigint, feePPM: bigint},
        useToken: string,
        signal: AbortSignal,
        pricePrefetchPromise: Promise<bigint> = Promise.resolve(null)
    ): Promise<{
        amountBD: bigint,
        swapFee: bigint, //Swap fee in BTC
        swapFeeInToken: bigint, //Swap fee in token on top of what should be paid out to the user
        totalInToken: bigint, //Total to be paid out to the user
        securityDepositApyPPM?: bigint,
        securityDepositBaseMultiplierPPM?: bigint
    }> {
        const chainIdentifier = request.chainIdentifier;

        let securityDepositApyPPM: bigint;
        let securityDepositBaseMultiplierPPM: bigint;

        const res = await PluginManager.onHandlePostFromBtcQuote(
            request,
            requestedAmount,
            chainIdentifier,
            useToken,
            {minInBtc: this.config.min, maxInBtc: this.config.max},
            {baseFeeInBtc: fees.baseFee, feePPM: fees.feePPM},
            pricePrefetchPromise
        );
        signal.throwIfAborted();
        if(res!=null) {
            this.handlePluginErrorResponses(res);
            if(isQuoteSetFees(res)) {
                if(res.baseFee!=null) fees.baseFee = res.baseFee;
                if(res.feePPM!=null) fees.feePPM = res.feePPM;
                if(res.securityDepositApyPPM!=null) securityDepositApyPPM = res.securityDepositApyPPM;
                if(res.securityDepositBaseMultiplierPPM!=null) securityDepositBaseMultiplierPPM = res.securityDepositBaseMultiplierPPM;
            }
            if(isPluginQuote(res)) {
                if(!requestedAmount.input) {
                    return {
                        amountBD: res.amount.amount + res.swapFee.inInputTokens,
                        swapFee: res.swapFee.inInputTokens,
                        swapFeeInToken: res.swapFee.inOutputTokens,
                        totalInToken: requestedAmount.amount
                    }
                } else {
                    return {
                        amountBD: requestedAmount.amount,
                        swapFee: res.swapFee.inInputTokens,
                        swapFeeInToken: res.swapFee.inOutputTokens,
                        totalInToken: res.amount.amount
                    }
                }
            }
        }

        let amountBD: bigint;
        if(!requestedAmount.input) {
            amountBD = await this.swapPricing.getToBtcSwapAmount(requestedAmount.amount, useToken, chainIdentifier, true, pricePrefetchPromise);
            signal.throwIfAborted();

            // amt = (amt+base_fee)/(1-fee)
            amountBD = (amountBD + fees.baseFee) * 1000000n / (1000000n - fees.feePPM);

            const tooLow = amountBD < (this.config.min * 95n / 100n);
            const tooHigh = amountBD > (this.config.max * 105n / 100n);
            if(tooLow || tooHigh) {
                const adjustedMin = this.config.min * (1000000n - fees.feePPM) / (1000000n - fees.baseFee);
                const adjustedMax = this.config.max * (1000000n - fees.feePPM) / (1000000n - fees.baseFee);
                const minIn = await this.swapPricing.getFromBtcSwapAmount(
                    adjustedMin, useToken, chainIdentifier, null, pricePrefetchPromise
                );
                const maxIn = await this.swapPricing.getFromBtcSwapAmount(
                    adjustedMax, useToken, chainIdentifier, null, pricePrefetchPromise
                );
                throw {
                    code: tooLow ? 20003 : 20004,
                    msg: tooLow ? "Amount too low!" : "Amount too high!",
                    data: {
                        min: minIn.toString(10),
                        max: maxIn.toString(10)
                    }
                };
            }
        } else {
            amountBD = requestedAmount.amount;
            this.checkBtcAmountInBounds(amountBD);
        }

        const swapFee = fees.baseFee + (amountBD * fees.feePPM / 1000000n);
        const swapFeeInToken = await this.swapPricing.getFromBtcSwapAmount(swapFee, useToken, chainIdentifier, true, pricePrefetchPromise);
        signal.throwIfAborted();

        let totalInToken: bigint;
        if(!requestedAmount.input) {
            totalInToken = requestedAmount.amount;
        } else {
            const amountInToken = await this.swapPricing.getFromBtcSwapAmount(requestedAmount.amount, useToken, chainIdentifier, null, pricePrefetchPromise);
            totalInToken = amountInToken - swapFeeInToken;
            signal.throwIfAborted();
        }

        return {
            amountBD,
            swapFee,
            swapFeeInToken,
            totalInToken,
            securityDepositApyPPM,
            securityDepositBaseMultiplierPPM
        }
    }

}
