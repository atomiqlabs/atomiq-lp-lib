import { RequestData, SwapBaseConfig, SwapHandler } from "./SwapHandler";
import { SwapHandlerSwap } from "./SwapHandlerSwap";
import { SwapData } from "@atomiqlabs/base";
import * as BN from "bn.js";
import { ServerParamEncoder } from "../utils/paramcoders/server/ServerParamEncoder";
import { IParamReader } from "../utils/paramcoders/IParamReader";
import { ToBtcLnRequestType } from "./tobtcln_abstract/ToBtcLnAbs";
import { ToBtcRequestType } from "./tobtc_abstract/ToBtcAbs";
import { Request } from "express";
export type ToBtcBaseConfig = SwapBaseConfig & {
    gracePeriod: BN;
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
        amount: BN;
    }, useToken: string): Promise<{
        baseFee: BN;
        feePPM: BN;
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
        networkFee: BN;
    }>(request: RequestData<ToBtcLnRequestType | ToBtcRequestType>, requestedAmount: {
        input: boolean;
        amount: BN;
    }, fees: {
        baseFee: BN;
        feePPM: BN;
    }, useToken: string, getNetworkFee: (amount: BN) => Promise<T>, signal: AbortSignal, pricePrefetchPromise?: Promise<BN>): Promise<{
        amountBD: BN;
        networkFeeData: T;
        swapFee: BN;
        swapFeeInToken: BN;
        networkFee: BN;
        networkFeeInToken: BN;
        totalInToken: BN;
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
        pricePrefetchPromise?: Promise<BN>;
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
    }>;
}
