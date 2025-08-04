import {FromBtcLnRequestType} from "../escrow/frombtcln_abstract/FromBtcLnAbs";
import {FromBtcRequestType} from "../escrow/frombtc_abstract/FromBtcAbs";
import {FromBtcLnTrustedRequestType} from "../trusted/frombtcln_trusted/FromBtcLnTrusted";
import {PluginManager} from "../../plugins/PluginManager";
import {isPluginQuote, isQuoteSetFees} from "../../plugins/IPlugin";
import {RequestData, SwapHandler, SwapHandlerType} from "../SwapHandler";
import {AmountAssertions, AmountAssertionsConfig} from "./AmountAssertions";
import {ISwapPrice} from "../../prices/ISwapPrice";
import {FromBtcTrustedRequestType} from "../trusted/frombtc_trusted/FromBtcTrusted";
import {SpvVaultSwapRequestType} from "../spv_vault_swap/SpvVaultSwapHandler";

export type FromBtcAmountAssertionsConfig = AmountAssertionsConfig & {
    gasTokenMax?: {[chainId: string]: bigint}
};

export class FromBtcAmountAssertions extends AmountAssertions {

    readonly config: FromBtcAmountAssertionsConfig;

    constructor(config: FromBtcAmountAssertionsConfig, swapPricing: ISwapPrice) {
        super(config, swapPricing)
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
    async preCheckFromBtcAmounts(
        swapType: SwapHandlerType.FROM_BTCLN | SwapHandlerType.FROM_BTC | SwapHandlerType.FROM_BTCLN_TRUSTED | SwapHandlerType.FROM_BTC_TRUSTED | SwapHandlerType.FROM_BTC_SPV | SwapHandlerType.FROM_BTCLN_AUTO,
        request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType | FromBtcTrustedRequestType | SpvVaultSwapRequestType>,
        requestedAmount: {input: boolean, amount: bigint, token: string},
        gasAmount?: {input: false, amount: bigint, token: string}
    ): Promise<{
        baseFee: bigint,
        feePPM: bigint,
        securityDepositApyPPM?: bigint,
        securityDepositBaseMultiplierPPM?: bigint,
    }> {
        const res = await PluginManager.onHandlePreFromBtcQuote(
            swapType,
            request,
            requestedAmount,
            request.chainIdentifier,
            {minInBtc: this.config.min, maxInBtc: this.config.max},
            {baseFeeInBtc: this.config.baseFee, feePPM: this.config.feePPM},
            gasAmount
        );
        if(res!=null) {
            AmountAssertions.handlePluginErrorResponses(res);
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

        if(gasAmount!=null && gasAmount.amount!==0n) {
            if(gasAmount.amount > (this.config.gasTokenMax?.[request.chainIdentifier] ?? 0n)) {
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
    async checkFromBtcAmount(
        swapType: SwapHandlerType.FROM_BTCLN | SwapHandlerType.FROM_BTC | SwapHandlerType.FROM_BTCLN_TRUSTED | SwapHandlerType.FROM_BTC_TRUSTED | SwapHandlerType.FROM_BTC_SPV | SwapHandlerType.FROM_BTCLN_AUTO,
        request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType | FromBtcTrustedRequestType | SpvVaultSwapRequestType>,
        requestedAmount: {input: boolean, amount: bigint, token: string, pricePrefetch?: Promise<bigint>},
        fees: {baseFee: bigint, feePPM: bigint},
        signal: AbortSignal,
        gasTokenAmount?: {input: false, amount: bigint, token: string, pricePrefetch?: Promise<bigint>}
    ): Promise<{
        amountBD: bigint,
        swapFee: bigint, //Swap fee in BTC
        swapFeeInToken: bigint, //Swap fee in token on top of what should be paid out to the user
        totalInToken: bigint, //Total to be paid out to the user
        amountBDgas?: bigint
        gasSwapFee?: bigint
        gasSwapFeeInToken?: bigint,
        totalInGasToken?: bigint,
        securityDepositApyPPM?: bigint,
        securityDepositBaseMultiplierPPM?: bigint
    }> {
        const chainIdentifier = request.chainIdentifier;

        let securityDepositApyPPM: bigint;
        let securityDepositBaseMultiplierPPM: bigint;

        const res = await PluginManager.onHandlePostFromBtcQuote(
            swapType,
            request,
            requestedAmount,
            chainIdentifier,
            {minInBtc: this.config.min, maxInBtc: this.config.max},
            {baseFeeInBtc: fees.baseFee, feePPM: fees.feePPM},
            gasTokenAmount
        );
        signal.throwIfAborted();
        if(res!=null) {
            AmountAssertions.handlePluginErrorResponses(res);
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

        let amountBDgas: bigint = 0n;
        let gasSwapFee: bigint = 0n;
        if(gasTokenAmount!=null) {
            amountBDgas = await this.swapPricing.getToBtcSwapAmount(gasTokenAmount.amount, gasTokenAmount.token, chainIdentifier, true, gasTokenAmount.pricePrefetch);
            signal.throwIfAborted();
            const denominator = (1000000n - fees.feePPM);
            const _amountBDgas = (amountBDgas * 1000000n + denominator - 1n) / denominator;
            gasSwapFee = _amountBDgas - amountBDgas;
            amountBDgas = _amountBDgas;
        }

        let amountBD: bigint;
        let swapFee: bigint;
        if(!requestedAmount.input) {
            amountBD = await this.swapPricing.getToBtcSwapAmount(requestedAmount.amount, requestedAmount.token, chainIdentifier, true, requestedAmount.pricePrefetch);
            signal.throwIfAborted();

            // amt = (amt+base_fee)/(1-fee)
            const denominator = (1000000n - fees.feePPM);
            const _amountBD = ((amountBD + fees.baseFee) * 1000000n + denominator - 1n) / denominator;
            swapFee = _amountBD - amountBD;
            amountBD = _amountBD;

            const tooLow = amountBD < (this.config.min * 95n / 100n);
            const tooHigh = amountBD > (this.config.max * 105n / 100n);
            if(tooLow || tooHigh) {
                const adjustedMin = this.config.min * (1000000n - fees.feePPM) / (1000000n - fees.baseFee);
                const adjustedMax = this.config.max * (1000000n - fees.feePPM) / (1000000n - fees.baseFee);
                const minIn = await this.swapPricing.getFromBtcSwapAmount(
                    adjustedMin, requestedAmount.token, chainIdentifier, null, requestedAmount.pricePrefetch
                );
                const maxIn = await this.swapPricing.getFromBtcSwapAmount(
                    adjustedMax, requestedAmount.token, chainIdentifier, null, requestedAmount.pricePrefetch
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
            this.checkBtcAmountInBounds(requestedAmount.amount);
            amountBD = requestedAmount.amount - amountBDgas;
            swapFee = fees.baseFee + ((amountBD * fees.feePPM + 999_999n) / 1000000n);
            if(amountBD < 0n) {
                throw {
                    code: 20003,
                    msg: "Amount too low!",
                    data: {
                        min: this.config.min.toString(10),
                        max: this.config.max.toString(10)
                    }
                };
            }
        }

        const swapFeeInToken = await this.swapPricing.getFromBtcSwapAmount(swapFee, requestedAmount.token, chainIdentifier, true, requestedAmount.pricePrefetch);
        signal.throwIfAborted();

        const gasSwapFeeInToken = gasTokenAmount==null ?
            0n :
            await this.swapPricing.getFromBtcSwapAmount(gasSwapFee, gasTokenAmount.token, chainIdentifier, true, gasTokenAmount.pricePrefetch);
        signal.throwIfAborted();

        let totalInToken: bigint;
        if(!requestedAmount.input) {
            totalInToken = requestedAmount.amount;
        } else {
            totalInToken = await this.swapPricing.getFromBtcSwapAmount(amountBD - swapFee, requestedAmount.token, chainIdentifier, null, requestedAmount.pricePrefetch);
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
        }
    }

}
