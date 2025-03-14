"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcBaseSwapHandler = void 0;
const SwapHandler_1 = require("./SwapHandler");
const SchemaVerifier_1 = require("../utils/paramcoders/SchemaVerifier");
const PluginManager_1 = require("../plugins/PluginManager");
const IPlugin_1 = require("../plugins/IPlugin");
const secondsInYear = BigInt(365 * 24 * 60 * 60);
class FromBtcBaseSwapHandler extends SwapHandler_1.SwapHandler {
    /**
     * Starts a pre-fetch for swap price & security deposit price
     *
     * @param chainIdentifier
     * @param useToken
     * @param depositToken
     * @param abortController
     */
    getFromBtcPricePrefetches(chainIdentifier, useToken, depositToken, abortController) {
        const pricePrefetchPromise = this.swapPricing.preFetchPrice(useToken, chainIdentifier).catch(e => {
            this.logger.error("getFromBtcPricePrefetches(): pricePrefetch error: ", e);
            abortController.abort(e);
            return null;
        });
        const { chainInterface } = this.getChain(chainIdentifier);
        const gasTokenPricePrefetchPromise = useToken.toString() === chainInterface.getNativeCurrencyAddress().toString() ?
            pricePrefetchPromise :
            this.swapPricing.preFetchPrice(chainInterface.getNativeCurrencyAddress(), chainIdentifier).catch(e => {
                this.logger.error("getFromBtcPricePrefetches(): gasTokenPricePrefetchPromise error: ", e);
                abortController.abort(e);
                return null;
            });
        const depositTokenPricePrefetchPromise = depositToken === chainInterface.getNativeCurrencyAddress() ?
            gasTokenPricePrefetchPromise :
            this.swapPricing.preFetchPrice(depositToken, chainIdentifier).catch(e => {
                this.logger.error("getFromBtcPricePrefetches(): depositTokenPricePrefetchPromise error: ", e);
                abortController.abort(e);
                return null;
            });
        return { pricePrefetchPromise, gasTokenPricePrefetchPromise, depositTokenPricePrefetchPromise };
    }
    /**
     * Starts a pre-fetch for base security deposit (transaction fee for refunding transaction on our side)
     *
     * @param chainIdentifier
     * @param dummySwapData
     * @param depositToken
     * @param gasTokenPricePrefetchPromise
     * @param depositTokenPricePrefetchPromise
     * @param abortController
     */
    async getBaseSecurityDepositPrefetch(chainIdentifier, dummySwapData, depositToken, gasTokenPricePrefetchPromise, depositTokenPricePrefetchPromise, abortController) {
        //Solana workaround
        const { swapContract, chainInterface } = this.getChain(chainIdentifier);
        let feeResult;
        const gasToken = chainInterface.getNativeCurrencyAddress();
        if (swapContract.getRawRefundFee != null) {
            try {
                feeResult = await swapContract.getRawRefundFee(dummySwapData);
            }
            catch (e) {
                this.logger.error("getBaseSecurityDepositPrefetch(): pre-fetch error: ", e);
                abortController.abort(e);
                return null;
            }
        }
        else {
            try {
                feeResult = await swapContract.getRefundFee(dummySwapData);
            }
            catch (e1) {
                this.logger.error("getBaseSecurityDepositPrefetch(): pre-fetch error: ", e1);
                abortController.abort(e1);
                return null;
            }
        }
        feeResult = feeResult * 2n;
        if (gasToken === depositToken)
            return feeResult;
        const btcValue = await this.swapPricing.getToBtcSwapAmount(feeResult, gasToken, chainIdentifier, true, gasTokenPricePrefetchPromise);
        return await this.swapPricing.getFromBtcSwapAmount(btcValue, depositToken, chainIdentifier, true, depositTokenPricePrefetchPromise);
    }
    /**
     * Starts a pre-fetch for vault balance
     *
     * @param chainIdentifier
     * @param useToken
     * @param abortController
     */
    async getBalancePrefetch(chainIdentifier, useToken, abortController) {
        const { swapContract, signer } = this.getChain(chainIdentifier);
        try {
            return await swapContract.getBalance(signer.getAddress(), useToken, true);
        }
        catch (e) {
            this.logger.error("getBalancePrefetch(): balancePrefetch error: ", e);
            abortController.abort(e);
            return null;
        }
    }
    /**
     * Checks if we have enough balance of the token in the swap vault
     *
     * @param totalInToken
     * @param balancePrefetch
     * @param signal
     * @throws {DefinedRuntimeError} will throw an error if there are not enough funds in the vault
     */
    async checkBalance(totalInToken, balancePrefetch, signal) {
        const balance = await balancePrefetch;
        if (signal != null)
            signal.throwIfAborted();
        if (balance == null || balance < totalInToken) {
            throw {
                code: 20002,
                msg: "Not enough liquidity"
            };
        }
    }
    /**
     * Checks if the specified token is allowed as a deposit token
     *
     * @param chainIdentifier
     * @param depositToken
     * @throws {DefinedRuntimeError} will throw an error if there are not enough funds in the vault
     */
    checkAllowedDepositToken(chainIdentifier, depositToken) {
        const { chainInterface, allowedDepositTokens } = this.getChain(chainIdentifier);
        if (allowedDepositTokens == null) {
            if (depositToken !== chainInterface.getNativeCurrencyAddress())
                throw {
                    code: 20190,
                    msg: "Unsupported deposit token"
                };
        }
        else {
            if (!allowedDepositTokens.includes(depositToken))
                throw {
                    code: 20190,
                    msg: "Unsupported deposit token"
                };
        }
    }
    /**
     * Checks minimums/maximums, calculates the fee & total amount
     *
     * @param request
     * @param requestedAmount
     * @param useToken
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    async preCheckAmounts(request, requestedAmount, useToken) {
        const res = await PluginManager_1.PluginManager.onHandlePreFromBtcQuote(request, requestedAmount, request.chainIdentifier, useToken, { minInBtc: this.config.min, maxInBtc: this.config.max }, { baseFeeInBtc: this.config.baseFee, feePPM: this.config.feePPM });
        if (res != null) {
            this.handlePluginErrorResponses(res);
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
    async checkFromBtcAmount(request, requestedAmount, fees, useToken, signal, pricePrefetchPromise = Promise.resolve(null)) {
        const chainIdentifier = request.chainIdentifier;
        let securityDepositApyPPM;
        let securityDepositBaseMultiplierPPM;
        const res = await PluginManager_1.PluginManager.onHandlePostFromBtcQuote(request, requestedAmount, chainIdentifier, useToken, { minInBtc: this.config.min, maxInBtc: this.config.max }, { baseFeeInBtc: fees.baseFee, feePPM: fees.feePPM }, pricePrefetchPromise);
        signal.throwIfAborted();
        if (res != null) {
            this.handlePluginErrorResponses(res);
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
        let amountBD;
        if (!requestedAmount.input) {
            amountBD = await this.swapPricing.getToBtcSwapAmount(requestedAmount.amount, useToken, chainIdentifier, true, pricePrefetchPromise);
            signal.throwIfAborted();
            // amt = (amt+base_fee)/(1-fee)
            amountBD = (amountBD + fees.baseFee) * 1000000n / (1000000n - fees.feePPM);
            const tooLow = amountBD < (this.config.min * 95n / 100n);
            const tooHigh = amountBD > (this.config.max * 105n / 100n);
            if (tooLow || tooHigh) {
                const adjustedMin = this.config.min * (1000000n - fees.feePPM) / (1000000n - fees.baseFee);
                const adjustedMax = this.config.max * (1000000n - fees.feePPM) / (1000000n - fees.baseFee);
                const minIn = await this.swapPricing.getFromBtcSwapAmount(adjustedMin, useToken, chainIdentifier, null, pricePrefetchPromise);
                const maxIn = await this.swapPricing.getFromBtcSwapAmount(adjustedMax, useToken, chainIdentifier, null, pricePrefetchPromise);
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
            amountBD = requestedAmount.amount;
            this.checkBtcAmountInBounds(amountBD);
        }
        const swapFee = fees.baseFee + (amountBD * fees.feePPM / 1000000n);
        const swapFeeInToken = await this.swapPricing.getFromBtcSwapAmount(swapFee, useToken, chainIdentifier, true, pricePrefetchPromise);
        signal.throwIfAborted();
        let totalInToken;
        if (!requestedAmount.input) {
            totalInToken = requestedAmount.amount;
        }
        else {
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
        };
    }
    /**
     * Signs the created swap
     *
     * @param chainIdentifier
     * @param swapObject
     * @param req
     * @param abortSignal
     * @param signDataPrefetchPromise
     */
    async getFromBtcSignatureData(chainIdentifier, swapObject, req, abortSignal, signDataPrefetchPromise) {
        const { swapContract, signer } = this.getChain(chainIdentifier);
        const prefetchedSignData = signDataPrefetchPromise != null ? await signDataPrefetchPromise : null;
        if (prefetchedSignData != null)
            this.logger.debug("getFromBtcSignatureData(): pre-fetched signature data: ", prefetchedSignData);
        abortSignal.throwIfAborted();
        const feeRateObj = await req.paramReader.getParams({
            feeRate: SchemaVerifier_1.FieldTypeEnum.String
        }).catch(() => null);
        abortSignal.throwIfAborted();
        const feeRate = feeRateObj?.feeRate != null && typeof (feeRateObj.feeRate) === "string" ? feeRateObj.feeRate : null;
        this.logger.debug("getFromBtcSignatureData(): using fee rate from client: ", feeRate);
        const sigData = await swapContract.getInitSignature(signer, swapObject, this.getInitAuthorizationTimeout(chainIdentifier), prefetchedSignData, feeRate);
        abortSignal.throwIfAborted();
        return {
            ...sigData,
            feeRate
        };
    }
    /**
     * Calculates the required security deposit
     *
     * @param chainIdentifier
     * @param amountBD
     * @param swapFee
     * @param expiryTimeout
     * @param baseSecurityDepositPromise
     * @param depositToken
     * @param depositTokenPricePrefetchPromise
     * @param securityDepositData
     * @param signal
     * @param metadata
     */
    async getSecurityDeposit(chainIdentifier, amountBD, swapFee, expiryTimeout, baseSecurityDepositPromise, depositToken, depositTokenPricePrefetchPromise, securityDepositData, signal, metadata) {
        let baseSD = await baseSecurityDepositPromise;
        if (securityDepositData.securityDepositBaseMultiplierPPM != null)
            baseSD = baseSD * securityDepositData.securityDepositBaseMultiplierPPM / 1000000n;
        signal.throwIfAborted();
        metadata.times.refundFeeFetched = Date.now();
        const swapValueInDepositToken = await this.swapPricing.getFromBtcSwapAmount(amountBD - swapFee, depositToken, chainIdentifier, true, depositTokenPricePrefetchPromise);
        signal.throwIfAborted();
        const apyPPM = securityDepositData.securityDepositApyPPM ?? BigInt(Math.floor(this.config.securityDepositAPY * 1000000));
        const variableSD = swapValueInDepositToken * apyPPM * expiryTimeout / 1000000n / secondsInYear;
        this.logger.debug("getSecurityDeposit(): base security deposit: " + baseSD.toString(10) +
            " deposit token: " + depositToken +
            " swap output in deposit token: " + swapValueInDepositToken.toString(10) +
            " apy ppm: " + apyPPM.toString(10) +
            " expiry timeout: " + expiryTimeout.toString(10) +
            " variable security deposit: " + variableSD.toString(10));
        return baseSD + variableSD;
    }
}
exports.FromBtcBaseSwapHandler = FromBtcBaseSwapHandler;
