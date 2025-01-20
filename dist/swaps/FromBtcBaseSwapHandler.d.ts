import { SwapHandlerSwap } from "./SwapHandlerSwap";
import { SwapData } from "@atomiqlabs/base";
import { RequestData, SwapBaseConfig, SwapHandler } from "./SwapHandler";
import * as BN from "bn.js";
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
     * @param abortController
     */
    protected getFromBtcPricePrefetches(chainIdentifier: string, useToken: string, abortController: AbortController): {
        pricePrefetchPromise: Promise<BN>;
        securityDepositPricePrefetchPromise: Promise<BN>;
    };
    /**
     * Starts a pre-fetch for base security deposit (transaction fee for refunding transaction on our side)
     *
     * @param chainIdentifier
     * @param dummySwapData
     * @param abortController
     */
    protected getBaseSecurityDepositPrefetch(chainIdentifier: string, dummySwapData: SwapData, abortController: AbortController): Promise<BN>;
    /**
     * Starts a pre-fetch for vault balance
     *
     * @param chainIdentifier
     * @param useToken
     * @param abortController
     */
    protected getBalancePrefetch(chainIdentifier: string, useToken: string, abortController: AbortController): Promise<BN>;
    /**
     * Checks if we have enough balance of the token in the swap vault
     *
     * @param totalInToken
     * @param balancePrefetch
     * @param signal
     * @throws {DefinedRuntimeError} will throw an error if there are not enough funds in the vault
     */
    protected checkBalance(totalInToken: BN, balancePrefetch: Promise<BN>, signal: AbortSignal | null): Promise<void>;
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
        amount: BN;
    }, useToken: string): Promise<{
        baseFee: BN;
        feePPM: BN;
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
        amount: BN;
    }, fees: {
        baseFee: BN;
        feePPM: BN;
    }, useToken: string, signal: AbortSignal, pricePrefetchPromise?: Promise<BN>): Promise<{
        amountBD: BN;
        swapFee: BN;
        swapFeeInToken: BN;
        totalInToken: BN;
    }>;
    /**
     * Calculates the required security deposit
     *
     * @param chainIdentifier
     * @param amountBD
     * @param swapFee
     * @param expiryTimeout
     * @param baseSecurityDepositPromise
     * @param securityDepositPricePrefetchPromise
     * @param signal
     * @param metadata
     */
    protected getSecurityDeposit(chainIdentifier: string, amountBD: BN, swapFee: BN, expiryTimeout: BN, baseSecurityDepositPromise: Promise<BN>, securityDepositPricePrefetchPromise: Promise<BN>, signal: AbortSignal, metadata: any): Promise<BN>;
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
}
