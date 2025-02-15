"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcBaseSwapHandler = void 0;
const SwapHandler_1 = require("./SwapHandler");
const BN = require("bn.js");
const SchemaVerifier_1 = require("../utils/paramcoders/SchemaVerifier");
const PluginManager_1 = require("../plugins/PluginManager");
const IPlugin_1 = require("../plugins/IPlugin");
const secondsInYear = new BN(365 * 24 * 60 * 60);
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
        const { swapContract } = this.getChain(chainIdentifier);
        const gasTokenPricePrefetchPromise = useToken.toString() === swapContract.getNativeCurrencyAddress().toString() ?
            pricePrefetchPromise :
            this.swapPricing.preFetchPrice(swapContract.getNativeCurrencyAddress(), chainIdentifier).catch(e => {
                this.logger.error("getFromBtcPricePrefetches(): gasTokenPricePrefetchPromise error: ", e);
                abortController.abort(e);
                return null;
            });
        const depositTokenPricePrefetchPromise = depositToken === swapContract.getNativeCurrencyAddress() ?
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
    getBaseSecurityDepositPrefetch(chainIdentifier, dummySwapData, depositToken, gasTokenPricePrefetchPromise, depositTokenPricePrefetchPromise, abortController) {
        return __awaiter(this, void 0, void 0, function* () {
            //Solana workaround
            const { swapContract } = this.getChain(chainIdentifier);
            let feeResult;
            const gasToken = swapContract.getNativeCurrencyAddress();
            if (swapContract.getRawRefundFee != null) {
                try {
                    feeResult = yield swapContract.getRawRefundFee(dummySwapData);
                }
                catch (e) {
                    this.logger.error("getBaseSecurityDepositPrefetch(): pre-fetch error: ", e);
                    abortController.abort(e);
                    return null;
                }
            }
            else {
                try {
                    feeResult = yield swapContract.getRefundFee(dummySwapData);
                }
                catch (e1) {
                    this.logger.error("getBaseSecurityDepositPrefetch(): pre-fetch error: ", e1);
                    abortController.abort(e1);
                    return null;
                }
            }
            feeResult = feeResult.mul(new BN(2));
            if (gasToken === depositToken)
                return feeResult;
            const btcValue = yield this.swapPricing.getToBtcSwapAmount(feeResult, gasToken, chainIdentifier, true, gasTokenPricePrefetchPromise);
            return yield this.swapPricing.getFromBtcSwapAmount(btcValue, depositToken, chainIdentifier, true, depositTokenPricePrefetchPromise);
        });
    }
    /**
     * Starts a pre-fetch for vault balance
     *
     * @param chainIdentifier
     * @param useToken
     * @param abortController
     */
    getBalancePrefetch(chainIdentifier, useToken, abortController) {
        return __awaiter(this, void 0, void 0, function* () {
            const { swapContract, signer } = this.getChain(chainIdentifier);
            try {
                return yield swapContract.getBalance(signer.getAddress(), useToken, true);
            }
            catch (e) {
                this.logger.error("getBalancePrefetch(): balancePrefetch error: ", e);
                abortController.abort(e);
                return null;
            }
        });
    }
    /**
     * Checks if we have enough balance of the token in the swap vault
     *
     * @param totalInToken
     * @param balancePrefetch
     * @param signal
     * @throws {DefinedRuntimeError} will throw an error if there are not enough funds in the vault
     */
    checkBalance(totalInToken, balancePrefetch, signal) {
        return __awaiter(this, void 0, void 0, function* () {
            const balance = yield balancePrefetch;
            if (signal != null)
                signal.throwIfAborted();
            if (balance == null || balance.lt(totalInToken)) {
                throw {
                    code: 20002,
                    msg: "Not enough liquidity"
                };
            }
        });
    }
    /**
     * Checks if the specified token is allowed as a deposit token
     *
     * @param chainIdentifier
     * @param depositToken
     * @throws {DefinedRuntimeError} will throw an error if there are not enough funds in the vault
     */
    checkAllowedDepositToken(chainIdentifier, depositToken) {
        const { swapContract, allowedDepositTokens } = this.getChain(chainIdentifier);
        if (allowedDepositTokens == null) {
            if (depositToken !== swapContract.getNativeCurrencyAddress())
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
    preCheckAmounts(request, requestedAmount, useToken) {
        return __awaiter(this, void 0, void 0, function* () {
            const res = yield PluginManager_1.PluginManager.onHandlePreFromBtcQuote(request, requestedAmount, request.chainIdentifier, useToken, { minInBtc: this.config.min, maxInBtc: this.config.max }, { baseFeeInBtc: this.config.baseFee, feePPM: this.config.feePPM });
            if (res != null) {
                this.handlePluginErrorResponses(res);
                if ((0, IPlugin_1.isQuoteSetFees)(res)) {
                    return {
                        baseFee: res.baseFee || this.config.baseFee,
                        feePPM: res.feePPM || this.config.feePPM
                    };
                }
            }
            if (requestedAmount.input)
                this.checkBtcAmountInBounds(requestedAmount.amount);
            return {
                baseFee: this.config.baseFee,
                feePPM: this.config.feePPM
            };
        });
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
    checkFromBtcAmount(request, requestedAmount, fees, useToken, signal, pricePrefetchPromise = Promise.resolve(null)) {
        return __awaiter(this, void 0, void 0, function* () {
            const chainIdentifier = request.chainIdentifier;
            const res = yield PluginManager_1.PluginManager.onHandlePostFromBtcQuote(request, requestedAmount, chainIdentifier, useToken, { minInBtc: this.config.min, maxInBtc: this.config.max }, { baseFeeInBtc: fees.baseFee, feePPM: fees.feePPM }, pricePrefetchPromise);
            signal.throwIfAborted();
            if (res != null) {
                this.handlePluginErrorResponses(res);
                if ((0, IPlugin_1.isQuoteSetFees)(res)) {
                    if (res.baseFee != null)
                        fees.baseFee = res.baseFee;
                    if (res.feePPM != null)
                        fees.feePPM = res.feePPM;
                }
                if ((0, IPlugin_1.isPluginQuote)(res)) {
                    if (!requestedAmount.input) {
                        return {
                            amountBD: res.amount.amount.add(res.swapFee.inInputTokens),
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
                amountBD = yield this.swapPricing.getToBtcSwapAmount(requestedAmount.amount, useToken, chainIdentifier, true, pricePrefetchPromise);
                signal.throwIfAborted();
                // amt = (amt+base_fee)/(1-fee)
                amountBD = amountBD.add(fees.baseFee).mul(new BN(1000000)).div(new BN(1000000).sub(fees.feePPM));
                const tooLow = amountBD.lt(this.config.min.mul(new BN(95)).div(new BN(100)));
                const tooHigh = amountBD.gt(this.config.max.mul(new BN(105)).div(new BN(100)));
                if (tooLow || tooHigh) {
                    const adjustedMin = this.config.min.mul(new BN(1000000).sub(fees.feePPM)).div(new BN(1000000)).sub(fees.baseFee);
                    const adjustedMax = this.config.max.mul(new BN(1000000).sub(fees.feePPM)).div(new BN(1000000)).sub(fees.baseFee);
                    const minIn = yield this.swapPricing.getFromBtcSwapAmount(adjustedMin, useToken, chainIdentifier, null, pricePrefetchPromise);
                    const maxIn = yield this.swapPricing.getFromBtcSwapAmount(adjustedMax, useToken, chainIdentifier, null, pricePrefetchPromise);
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
            const swapFee = fees.baseFee.add(amountBD.mul(fees.feePPM).div(new BN(1000000)));
            const swapFeeInToken = yield this.swapPricing.getFromBtcSwapAmount(swapFee, useToken, chainIdentifier, true, pricePrefetchPromise);
            signal.throwIfAborted();
            let totalInToken;
            if (!requestedAmount.input) {
                totalInToken = requestedAmount.amount;
            }
            else {
                const amountInToken = yield this.swapPricing.getFromBtcSwapAmount(requestedAmount.amount, useToken, chainIdentifier, null, pricePrefetchPromise);
                totalInToken = amountInToken.sub(swapFeeInToken);
                signal.throwIfAborted();
            }
            return {
                amountBD,
                swapFee,
                swapFeeInToken,
                totalInToken
            };
        });
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
    getFromBtcSignatureData(chainIdentifier, swapObject, req, abortSignal, signDataPrefetchPromise) {
        return __awaiter(this, void 0, void 0, function* () {
            const { swapContract, signer } = this.getChain(chainIdentifier);
            const prefetchedSignData = signDataPrefetchPromise != null ? yield signDataPrefetchPromise : null;
            if (prefetchedSignData != null)
                this.logger.debug("getFromBtcSignatureData(): pre-fetched signature data: ", prefetchedSignData);
            abortSignal.throwIfAborted();
            const feeRateObj = yield req.paramReader.getParams({
                feeRate: SchemaVerifier_1.FieldTypeEnum.String
            }).catch(() => null);
            abortSignal.throwIfAborted();
            const feeRate = (feeRateObj === null || feeRateObj === void 0 ? void 0 : feeRateObj.feeRate) != null && typeof (feeRateObj.feeRate) === "string" ? feeRateObj.feeRate : null;
            this.logger.debug("getFromBtcSignatureData(): using fee rate from client: ", feeRate);
            const sigData = yield swapContract.getInitSignature(signer, swapObject, this.getInitAuthorizationTimeout(chainIdentifier), prefetchedSignData, feeRate);
            abortSignal.throwIfAborted();
            return Object.assign(Object.assign({}, sigData), { feeRate });
        });
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
     * @param signal
     * @param metadata
     */
    getSecurityDeposit(chainIdentifier, amountBD, swapFee, expiryTimeout, baseSecurityDepositPromise, depositToken, depositTokenPricePrefetchPromise, signal, metadata) {
        return __awaiter(this, void 0, void 0, function* () {
            let baseSD = yield baseSecurityDepositPromise;
            signal.throwIfAborted();
            metadata.times.refundFeeFetched = Date.now();
            const swapValueInDepositToken = yield this.swapPricing.getFromBtcSwapAmount(amountBD.sub(swapFee), depositToken, chainIdentifier, true, depositTokenPricePrefetchPromise);
            signal.throwIfAborted();
            const apyPPM = new BN(Math.floor(this.config.securityDepositAPY * 1000000));
            const variableSD = swapValueInDepositToken.mul(apyPPM).mul(expiryTimeout).div(new BN(1000000)).div(secondsInYear);
            this.logger.debug("getSecurityDeposit(): base security deposit: " + baseSD.toString(10) +
                " deposit token: " + depositToken +
                " swap output in deposit token: " + swapValueInDepositToken.toString(10) +
                " apy ppm: " + apyPPM.toString(10) +
                " expiry timeout: " + expiryTimeout.toString(10) +
                " variable security deposit: " + variableSD.toString(10));
            return baseSD.add(variableSD);
        });
    }
}
exports.FromBtcBaseSwapHandler = FromBtcBaseSwapHandler;
