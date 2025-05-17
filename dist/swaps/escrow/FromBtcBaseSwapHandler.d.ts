import { SwapData } from "@atomiqlabs/base";
import { MultichainData, SwapBaseConfig } from "../SwapHandler";
import { IParamReader } from "../../utils/paramcoders/IParamReader";
import { Request } from "express";
import { EscrowHandler } from "./EscrowHandler";
import { FromBtcBaseSwap } from "./FromBtcBaseSwap";
import { FromBtcAmountAssertions } from "../assertions/FromBtcAmountAssertions";
import { IIntermediaryStorage } from "../../storage/IIntermediaryStorage";
import { ISwapPrice } from "../../prices/ISwapPrice";
export type FromBtcBaseConfig = SwapBaseConfig & {
    securityDepositAPY: number;
};
export declare abstract class FromBtcBaseSwapHandler<V extends FromBtcBaseSwap<SwapData, S>, S> extends EscrowHandler<V, S> {
    abstract config: FromBtcBaseConfig;
    readonly AmountAssertions: FromBtcAmountAssertions;
    constructor(storageDirectory: IIntermediaryStorage<V>, path: string, chainsData: MultichainData, swapPricing: ISwapPrice, config: FromBtcBaseConfig);
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
