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
exports.ToBtcBaseSwapHandler = void 0;
const SwapHandler_1 = require("./SwapHandler");
const BN = require("bn.js");
const SchemaVerifier_1 = require("../utils/paramcoders/SchemaVerifier");
const PluginManager_1 = require("../plugins/PluginManager");
const IPlugin_1 = require("../plugins/IPlugin");
class ToBtcBaseSwapHandler extends SwapHandler_1.SwapHandler {
    constructor() {
        super(...arguments);
        this.pdaExistsForToken = {};
    }
    checkVaultInitialized(chainIdentifier, token) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.pdaExistsForToken[chainIdentifier] || !this.pdaExistsForToken[chainIdentifier][token]) {
                this.logger.debug("checkVaultInitialized(): checking vault exists for chain: " + chainIdentifier + " token: " + token);
                const { swapContract, signer } = this.getChain(chainIdentifier);
                const reputation = yield swapContract.getIntermediaryReputation(signer.getAddress(), token);
                this.logger.debug("checkVaultInitialized(): vault state, chain: " + chainIdentifier + " token: " + token + " exists: " + (reputation != null));
                if (reputation != null) {
                    if (this.pdaExistsForToken[chainIdentifier] == null)
                        this.pdaExistsForToken[chainIdentifier] = {};
                    this.pdaExistsForToken[chainIdentifier][token] = true;
                }
                else {
                    throw {
                        code: 20201,
                        msg: "Token not supported!"
                    };
                }
            }
        });
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
            const res = yield PluginManager_1.PluginManager.onHandlePreToBtcQuote(request, requestedAmount, request.chainIdentifier, useToken, { minInBtc: this.config.min, maxInBtc: this.config.max }, { baseFeeInBtc: this.config.baseFee, feePPM: this.config.feePPM });
            if (res != null) {
                this.handlePluginErrorResponses(res);
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
        });
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
    checkToBtcAmount(request, requestedAmount, fees, useToken, getNetworkFee, signal, pricePrefetchPromise) {
        return __awaiter(this, void 0, void 0, function* () {
            const chainIdentifier = request.chainIdentifier;
            const res = yield PluginManager_1.PluginManager.onHandlePostToBtcQuote(request, requestedAmount, request.chainIdentifier, useToken, { minInBtc: this.config.min, maxInBtc: this.config.max }, { baseFeeInBtc: fees.baseFee, feePPM: fees.feePPM, networkFeeGetter: getNetworkFee }, pricePrefetchPromise);
            signal.throwIfAborted();
            if (res != null) {
                this.handlePluginErrorResponses(res);
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
                            totalInToken: res.amount.amount.add(res.swapFee.inInputTokens).add(res.networkFee.inInputTokens)
                        };
                    }
                }
            }
            let amountBD;
            let tooLow = false;
            if (requestedAmount.input) {
                amountBD = yield this.swapPricing.getToBtcSwapAmount(requestedAmount.amount, useToken, chainIdentifier, null, pricePrefetchPromise);
                signal.throwIfAborted();
                //Decrease by base fee
                amountBD = amountBD.sub(fees.baseFee);
                //If it's already smaller than minimum, set it to minimum so we can calculate the network fee
                if (amountBD.lt(this.config.min)) {
                    amountBD = this.config.min;
                    tooLow = true;
                }
            }
            else {
                amountBD = requestedAmount.amount;
                this.checkBtcAmountInBounds(amountBD);
            }
            const resp = yield getNetworkFee(amountBD);
            this.logger.debug("checkToBtcAmount(): network fee calculated, amount: " + amountBD.toString(10) + " fee: " + resp.networkFee.toString(10));
            signal.throwIfAborted();
            if (requestedAmount.input) {
                //Decrease by network fee
                amountBD = amountBD.sub(resp.networkFee);
                //Decrease by percentage fee
                amountBD = amountBD.mul(new BN(1000000)).div(fees.feePPM.add(new BN(1000000)));
                const tooHigh = amountBD.gt(this.config.max.mul(new BN(105)).div(new BN(100)));
                tooLow || (tooLow = amountBD.lt(this.config.min.mul(new BN(95)).div(new BN(100))));
                if (tooLow || tooHigh) {
                    //Compute min/max
                    let adjustedMin = this.config.min.mul(fees.feePPM.add(new BN(1000000))).div(new BN(1000000));
                    let adjustedMax = this.config.max.mul(fees.feePPM.add(new BN(1000000))).div(new BN(1000000));
                    adjustedMin = adjustedMin.add(fees.baseFee).add(resp.networkFee);
                    adjustedMax = adjustedMax.add(fees.baseFee).add(resp.networkFee);
                    const minIn = yield this.swapPricing.getFromBtcSwapAmount(adjustedMin, useToken, chainIdentifier, null, pricePrefetchPromise);
                    const maxIn = yield this.swapPricing.getFromBtcSwapAmount(adjustedMax, useToken, chainIdentifier, null, pricePrefetchPromise);
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
            const swapFee = fees.baseFee.add(amountBD.mul(fees.feePPM).div(new BN(1000000)));
            const networkFeeInToken = yield this.swapPricing.getFromBtcSwapAmount(resp.networkFee, useToken, chainIdentifier, true, pricePrefetchPromise);
            const swapFeeInToken = yield this.swapPricing.getFromBtcSwapAmount(swapFee, useToken, chainIdentifier, true, pricePrefetchPromise);
            signal.throwIfAborted();
            let total;
            if (requestedAmount.input) {
                total = requestedAmount.amount;
            }
            else {
                const amountInToken = yield this.swapPricing.getFromBtcSwapAmount(requestedAmount.amount, useToken, chainIdentifier, true, pricePrefetchPromise);
                signal.throwIfAborted();
                total = amountInToken.add(swapFeeInToken).add(networkFeeInToken);
            }
            return { amountBD, networkFeeData: resp, swapFee, swapFeeInToken, networkFee: resp.networkFee, networkFeeInToken, totalInToken: total };
        });
    }
    /**
     * Starts pre-fetches for swap pricing & signature data
     *
     * @param chainIdentifier
     * @param token
     * @param responseStream
     * @param abortController
     */
    getToBtcPrefetches(chainIdentifier, token, responseStream, abortController) {
        //Fetch pricing & signature data in parallel
        const pricePrefetchPromise = this.swapPricing.preFetchPrice(token, chainIdentifier).catch(e => {
            this.logger.error("getToBtcPrefetches(): pricePrefetch error", e);
            abortController.abort(e);
            return null;
        });
        return {
            pricePrefetchPromise,
            signDataPrefetchPromise: this.getSignDataPrefetch(chainIdentifier, abortController, responseStream)
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
    getToBtcSignatureData(chainIdentifier, swapObject, req, abortSignal, signDataPrefetchPromise) {
        return __awaiter(this, void 0, void 0, function* () {
            const prefetchedSignData = signDataPrefetchPromise != null ? yield signDataPrefetchPromise : null;
            if (prefetchedSignData != null)
                this.logger.debug("getToBtcSignatureData(): pre-fetched signature data: ", prefetchedSignData);
            abortSignal.throwIfAborted();
            const feeRateObj = yield req.paramReader.getParams({
                feeRate: SchemaVerifier_1.FieldTypeEnum.String
            }).catch(() => null);
            abortSignal.throwIfAborted();
            const feeRate = (feeRateObj === null || feeRateObj === void 0 ? void 0 : feeRateObj.feeRate) != null && typeof (feeRateObj.feeRate) === "string" ? feeRateObj.feeRate : null;
            this.logger.debug("getToBtcSignatureData(): using fee rate from client: ", feeRate);
            const { swapContract, signer } = this.getChain(chainIdentifier);
            const sigData = yield swapContract.getInitSignature(signer, swapObject, this.config.authorizationTimeout, prefetchedSignData, feeRate);
            abortSignal.throwIfAborted();
            return sigData;
        });
    }
}
exports.ToBtcBaseSwapHandler = ToBtcBaseSwapHandler;
