import {SwapHandlerSwap} from "./SwapHandlerSwap";
import {SwapData} from "@atomiqlabs/base";
import {RequestData, SwapBaseConfig, SwapHandler} from "./SwapHandler";
import * as BN from "bn.js";
import {IParamReader} from "../utils/paramcoders/IParamReader";
import {FieldTypeEnum} from "../utils/paramcoders/SchemaVerifier";
import {FromBtcLnRequestType} from "./frombtcln_abstract/FromBtcLnAbs";
import {FromBtcRequestType} from "./frombtc_abstract/FromBtcAbs";
import {PluginManager} from "../plugins/PluginManager";
import {
    isPluginQuote,
    isQuoteSetFees
} from "../plugins/IPlugin";
import {Request} from "express";
import {FromBtcLnTrustedRequestType} from "./frombtcln_trusted/FromBtcLnTrusted";

const secondsInYear = new BN(365*24*60*60);

export type FromBtcBaseConfig = SwapBaseConfig & {
    securityDepositAPY: number
};

export abstract class FromBtcBaseSwapHandler<V extends SwapHandlerSwap<SwapData, S>, S> extends SwapHandler<V, S> {

    abstract config: FromBtcBaseConfig;

    /**
     * Starts a pre-fetch for swap price & security deposit price
     *
     * @param chainIdentifier
     * @param useToken
     * @param depositToken
     * @param abortController
     */
    protected getFromBtcPricePrefetches(chainIdentifier: string, useToken: string, depositToken: string, abortController: AbortController): {
        pricePrefetchPromise: Promise<BN>,
        gasTokenPricePrefetchPromise: Promise<BN>,
        depositTokenPricePrefetchPromise: Promise<BN>
    } {
        const pricePrefetchPromise: Promise<BN> = this.swapPricing.preFetchPrice(useToken, chainIdentifier).catch(e => {
            this.logger.error("getFromBtcPricePrefetches(): pricePrefetch error: ", e);
            abortController.abort(e);
            return null;
        });
        const {swapContract} = this.getChain(chainIdentifier);
        const gasTokenPricePrefetchPromise: Promise<BN> = useToken.toString()===swapContract.getNativeCurrencyAddress().toString() ?
            pricePrefetchPromise :
            this.swapPricing.preFetchPrice(swapContract.getNativeCurrencyAddress(), chainIdentifier).catch(e => {
                this.logger.error("getFromBtcPricePrefetches(): gasTokenPricePrefetchPromise error: ", e);
                abortController.abort(e);
                return null;
            });
        const depositTokenPricePrefetchPromise: Promise<BN> = depositToken===swapContract.getNativeCurrencyAddress() ?
            gasTokenPricePrefetchPromise :
            this.swapPricing.preFetchPrice(depositToken, chainIdentifier).catch(e => {
                this.logger.error("getFromBtcPricePrefetches(): depositTokenPricePrefetchPromise error: ", e);
                abortController.abort(e);
                return null;
            });
        return {pricePrefetchPromise, gasTokenPricePrefetchPromise, depositTokenPricePrefetchPromise};
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
    protected async getBaseSecurityDepositPrefetch(
        chainIdentifier: string, dummySwapData: SwapData, depositToken: string,
        gasTokenPricePrefetchPromise: Promise<BN>, depositTokenPricePrefetchPromise: Promise<BN>,
        abortController: AbortController
    ): Promise<BN> {
        //Solana workaround
        const {swapContract} = this.getChain(chainIdentifier);
        let feeResult: BN;
        const gasToken = swapContract.getNativeCurrencyAddress();
        if (swapContract.getRawRefundFee != null) {
            try {
                feeResult = await swapContract.getRawRefundFee(dummySwapData);
            } catch (e) {
                this.logger.error("getBaseSecurityDepositPrefetch(): pre-fetch error: ", e);
                abortController.abort(e);
                return null;
            }
        } else {
            try {
                feeResult = await swapContract.getRefundFee(dummySwapData);
            } catch (e1) {
                this.logger.error("getBaseSecurityDepositPrefetch(): pre-fetch error: ", e1);
                abortController.abort(e1);
                return null;
            }
        }
        feeResult = feeResult.mul(new BN(2));
        if(gasToken===depositToken) return feeResult;
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
    protected async getBalancePrefetch(chainIdentifier: string, useToken: string, abortController: AbortController): Promise<BN> {
        const {swapContract, signer} = this.getChain(chainIdentifier);
        try {
            return await swapContract.getBalance(signer.getAddress(), useToken, true);
        } catch (e) {
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
    protected async checkBalance(totalInToken: BN, balancePrefetch: Promise<BN>, signal: AbortSignal | null): Promise<void> {
        const balance = await balancePrefetch;
        if(signal!=null) signal.throwIfAborted();

        if(balance==null || balance.lt(totalInToken)) {
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
    protected checkAllowedDepositToken(chainIdentifier: string, depositToken: string): void {
        const {swapContract, allowedDepositTokens} = this.getChain(chainIdentifier);
        if(allowedDepositTokens==null) {
            if(depositToken!==swapContract.getNativeCurrencyAddress()) throw {
                code: 20190,
                msg: "Unsupported deposit token"
            };
        } else {
            if(!allowedDepositTokens.includes(depositToken)) throw {
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
    protected async preCheckAmounts(
        request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType>,
        requestedAmount: {input: boolean, amount: BN},
        useToken: string
    ): Promise<{baseFee: BN, feePPM: BN}> {
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
                    feePPM: res.feePPM || this.config.feePPM
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
    protected async checkFromBtcAmount(
        request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType>,
        requestedAmount: {input: boolean, amount: BN},
        fees: {baseFee: BN, feePPM: BN},
        useToken: string,
        signal: AbortSignal,
        pricePrefetchPromise: Promise<BN> = Promise.resolve(null)
    ): Promise<{
        amountBD: BN,
        swapFee: BN, //Swap fee in BTC
        swapFeeInToken: BN, //Swap fee in token on top of what should be paid out to the user
        totalInToken: BN //Total to be paid out to the user
    }> {
        const chainIdentifier = request.chainIdentifier;

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
            }
            if(isPluginQuote(res)) {
                if(!requestedAmount.input) {
                    return {
                        amountBD: res.amount.amount.add(res.swapFee.inInputTokens),
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

        let amountBD: BN;
        if(!requestedAmount.input) {
            amountBD = await this.swapPricing.getToBtcSwapAmount(requestedAmount.amount, useToken, chainIdentifier, true, pricePrefetchPromise);
            signal.throwIfAborted();

            // amt = (amt+base_fee)/(1-fee)
            amountBD = amountBD.add(fees.baseFee).mul(new BN(1000000)).div(new BN(1000000).sub(fees.feePPM));

            const tooLow = amountBD.lt(this.config.min.mul(new BN(95)).div(new BN(100)));
            const tooHigh = amountBD.gt(this.config.max.mul(new BN(105)).div(new BN(100)));
            if(tooLow || tooHigh) {
                const adjustedMin = this.config.min.mul(new BN(1000000).sub(fees.feePPM)).div(new BN(1000000)).sub(fees.baseFee);
                const adjustedMax = this.config.max.mul(new BN(1000000).sub(fees.feePPM)).div(new BN(1000000)).sub(fees.baseFee);
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

        const swapFee = fees.baseFee.add(amountBD.mul(fees.feePPM).div(new BN(1000000)));
        const swapFeeInToken = await this.swapPricing.getFromBtcSwapAmount(swapFee, useToken, chainIdentifier, true, pricePrefetchPromise);
        signal.throwIfAborted();

        let totalInToken: BN;
        if(!requestedAmount.input) {
            totalInToken = requestedAmount.amount;
        } else {
            const amountInToken = await this.swapPricing.getFromBtcSwapAmount(requestedAmount.amount, useToken, chainIdentifier, null, pricePrefetchPromise);
            totalInToken = amountInToken.sub(swapFeeInToken);
            signal.throwIfAborted();
        }

        return {
            amountBD,
            swapFee,
            swapFeeInToken,
            totalInToken
        }
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
    protected async getFromBtcSignatureData(
        chainIdentifier: string,
        swapObject: SwapData,
        req: Request & {paramReader: IParamReader},
        abortSignal: AbortSignal,
        signDataPrefetchPromise?: Promise<any>
    ): Promise<{
        prefix: string,
        timeout: string,
        signature: string,
        feeRate: string
    }> {
        const {swapContract, signer} = this.getChain(chainIdentifier);

        const prefetchedSignData = signDataPrefetchPromise!=null ? await signDataPrefetchPromise : null;
        if(prefetchedSignData!=null) this.logger.debug("getFromBtcSignatureData(): pre-fetched signature data: ", prefetchedSignData);
        abortSignal.throwIfAborted();

        const feeRateObj = await req.paramReader.getParams({
            feeRate: FieldTypeEnum.String
        }).catch(() => null);
        abortSignal.throwIfAborted();

        const feeRate = feeRateObj?.feeRate!=null && typeof(feeRateObj.feeRate)==="string" ? feeRateObj.feeRate : null;
        this.logger.debug("getFromBtcSignatureData(): using fee rate from client: ", feeRate);
        const sigData = await swapContract.getInitSignature(
            signer,
            swapObject,
            this.getInitAuthorizationTimeout(chainIdentifier),
            prefetchedSignData,
            feeRate
        );
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
     * @param signal
     * @param metadata
     */
    protected async getSecurityDeposit(
        chainIdentifier: string,
        amountBD: BN,
        swapFee: BN,
        expiryTimeout: BN,
        baseSecurityDepositPromise: Promise<BN>,
        depositToken: string,
        depositTokenPricePrefetchPromise: Promise<BN>,
        signal: AbortSignal,
        metadata: any
    ): Promise<BN> {
        let baseSD: BN = await baseSecurityDepositPromise;

        signal.throwIfAborted();

        metadata.times.refundFeeFetched = Date.now();

        const swapValueInDepositToken = await this.swapPricing.getFromBtcSwapAmount(
            amountBD.sub(swapFee),
            depositToken,
            chainIdentifier,
            true,
            depositTokenPricePrefetchPromise
        );

        signal.throwIfAborted();

        const apyPPM = new BN(Math.floor(this.config.securityDepositAPY*1000000));
        const variableSD = swapValueInDepositToken.mul(apyPPM).mul(expiryTimeout).div(new BN(1000000)).div(secondsInYear);

        this.logger.debug(
            "getSecurityDeposit(): base security deposit: "+baseSD.toString(10)+
            " deposit token: "+depositToken+
            " swap output in deposit token: "+swapValueInDepositToken.toString(10)+
            " apy ppm: "+apyPPM.toString(10)+
            " expiry timeout: "+expiryTimeout.toString(10)+
            " variable security deposit: "+variableSD.toString(10)
        );

        return baseSD.add(variableSD);
    }

}