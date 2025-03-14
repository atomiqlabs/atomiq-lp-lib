import { RequestData, SwapBaseConfig, SwapHandler } from "./SwapHandler";
import { SwapHandlerSwap } from "./SwapHandlerSwap";
import { SwapData } from "@atomiqlabs/base";
import { ServerParamEncoder } from "../utils/paramcoders/server/ServerParamEncoder";
import { IParamReader } from "../utils/paramcoders/IParamReader";
import { ToBtcLnRequestType } from "./tobtcln_abstract/ToBtcLnAbs";
import { ToBtcRequestType } from "./tobtc_abstract/ToBtcAbs";
import { Request } from "express";
export type ToBtcBaseConfig = SwapBaseConfig & {
    gracePeriod: bigint;
    refundAuthorizationTimeout: number;
};
export declare abstract class ToBtcBaseSwapHandler<V extends SwapHandlerSwap<SwapData, S>, S> extends SwapHandler<V, S> {
    readonly pdaExistsForToken: {
        [chainIdentifier: string]: {
            [token: string]: boolean;
        };
    };
    abstract config: ToBtcBaseConfig;
    protected checkVaultInitialized(chainIdentifier: string, token: string): Promise<void>;
    /**
     * Checks minimums/maximums, calculates the fee & total amount
     *
     * @param request
     * @param requestedAmount
     * @param useToken
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    protected preCheckAmounts(request: RequestData<ToBtcLnRequestType | ToBtcRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
    }, useToken: string): Promise<{
        baseFee: bigint;
        feePPM: bigint;
    }>;
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
    protected checkToBtcAmount<T extends {
        networkFee: bigint;
    }>(request: RequestData<ToBtcLnRequestType | ToBtcRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
    }, fees: {
        baseFee: bigint;
        feePPM: bigint;
    }, useToken: string, getNetworkFee: (amount: bigint) => Promise<T>, signal: AbortSignal, pricePrefetchPromise?: Promise<bigint>): Promise<{
        amountBD: bigint;
        networkFeeData: T;
        swapFee: bigint;
        swapFeeInToken: bigint;
        networkFee: bigint;
        networkFeeInToken: bigint;
        totalInToken: bigint;
    }>;
    /**
     * Starts pre-fetches for swap pricing & signature data
     *
     * @param chainIdentifier
     * @param token
     * @param responseStream
     * @param abortController
     */
    protected getToBtcPrefetches(chainIdentifier: string, token: string, responseStream: ServerParamEncoder, abortController: AbortController): {
        pricePrefetchPromise?: Promise<bigint>;
        signDataPrefetchPromise?: Promise<any>;
    };
    /**
     * Signs the created swap
     *
     * @param chainIdentifier
     * @param swapObject
     * @param req
     * @param abortSignal
     * @param signDataPrefetchPromise
     */
    protected getToBtcSignatureData(chainIdentifier: string, swapObject: SwapData, req: Request & {
        paramReader: IParamReader;
    }, abortSignal: AbortSignal, signDataPrefetchPromise?: Promise<any>): Promise<{
        prefix: string;
        timeout: string;
        signature: string;
        feeRate: string;
    }>;
}
