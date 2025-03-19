import { SwapHandlerSwap } from "./SwapHandlerSwap";
import { SwapData } from "@atomiqlabs/base";
import { RequestData, SwapBaseConfig, SwapHandler } from "./SwapHandler";
import { IParamReader } from "../utils/paramcoders/IParamReader";
import { FromBtcLnRequestType } from "./frombtcln_abstract/FromBtcLnAbs";
import { FromBtcRequestType } from "./frombtc_abstract/FromBtcAbs";
import { Request } from "express";
import { FromBtcLnTrustedRequestType } from "./frombtcln_trusted/FromBtcLnTrusted";
export type FromBtcBaseConfig = SwapBaseConfig & {
    securityDepositAPY: number;
};
export declare abstract class FromBtcBaseSwapHandler<V extends SwapHandlerSwap<SwapData, S>, S> extends SwapHandler<V, S> {
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
        pricePrefetchPromise: Promise<bigint>;
        gasTokenPricePrefetchPromise: Promise<bigint>;
        depositTokenPricePrefetchPromise: Promise<bigint>;
    };
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
    protected getBaseSecurityDepositPrefetch(chainIdentifier: string, dummySwapData: SwapData, depositToken: string, gasTokenPricePrefetchPromise: Promise<bigint>, depositTokenPricePrefetchPromise: Promise<bigint>, abortController: AbortController): Promise<bigint>;
    /**
     * Starts a pre-fetch for vault balance
     *
     * @param chainIdentifier
     * @param useToken
     * @param abortController
     */
    protected getBalancePrefetch(chainIdentifier: string, useToken: string, abortController: AbortController): Promise<bigint>;
    /**
     * Checks if we have enough balance of the token in the swap vault
     *
     * @param totalInToken
     * @param balancePrefetch
     * @param signal
     * @throws {DefinedRuntimeError} will throw an error if there are not enough funds in the vault
     */
    protected checkBalance(totalInToken: bigint, balancePrefetch: Promise<bigint>, signal: AbortSignal | null): Promise<void>;
    /**
     * Checks if the specified token is allowed as a deposit token
     *
     * @param chainIdentifier
     * @param depositToken
     * @throws {DefinedRuntimeError} will throw an error if there are not enough funds in the vault
     */
    protected checkAllowedDepositToken(chainIdentifier: string, depositToken: string): void;
    /**
     * Checks minimums/maximums, calculates the fee & total amount
     *
     * @param request
     * @param requestedAmount
     * @param useToken
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    protected preCheckAmounts(request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
    }, useToken: string): Promise<{
        baseFee: bigint;
        feePPM: bigint;
        securityDepositApyPPM?: bigint;
        securityDepositBaseMultiplierPPM?: bigint;
    }>;
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
    protected checkFromBtcAmount(request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
    }, fees: {
        baseFee: bigint;
        feePPM: bigint;
    }, useToken: string, signal: AbortSignal, pricePrefetchPromise?: Promise<bigint>): Promise<{
        amountBD: bigint;
        swapFee: bigint;
        swapFeeInToken: bigint;
        totalInToken: bigint;
        securityDepositApyPPM?: bigint;
        securityDepositBaseMultiplierPPM?: bigint;
    }>;
    /**
     * Signs the created swap
     *
     * @param chainIdentifier
     * @param swapObject
     * @param req
     * @param abortSignal
     * @param signDataPrefetchPromise
     */
    protected getFromBtcSignatureData(chainIdentifier: string, swapObject: SwapData, req: Request & {
        paramReader: IParamReader;
    }, abortSignal: AbortSignal, signDataPrefetchPromise?: Promise<any>): Promise<{
        prefix: string;
        timeout: string;
        signature: string;
        feeRate: string;
    }>;
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
    protected getSecurityDeposit(chainIdentifier: string, amountBD: bigint, swapFee: bigint, expiryTimeout: bigint, baseSecurityDepositPromise: Promise<bigint>, depositToken: string, depositTokenPricePrefetchPromise: Promise<bigint>, securityDepositData: {
        securityDepositApyPPM?: bigint;
        securityDepositBaseMultiplierPPM?: bigint;
    }, signal: AbortSignal, metadata: any): Promise<bigint>;
}
