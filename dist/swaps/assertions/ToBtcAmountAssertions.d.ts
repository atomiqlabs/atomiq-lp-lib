import { AmountAssertions } from "./AmountAssertions";
import { ToBtcLnRequestType } from "../escrow/tobtcln_abstract/ToBtcLnAbs";
import { ToBtcRequestType } from "../escrow/tobtc_abstract/ToBtcAbs";
import { RequestData } from "../SwapHandler";
export declare class ToBtcAmountAssertions extends AmountAssertions {
    /**
     * Checks minimums/maximums, calculates the fee & total amount
     *
     * @param request
     * @param requestedAmount
     * @param useToken
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    preCheckToBtcAmounts(request: RequestData<ToBtcLnRequestType | ToBtcRequestType>, requestedAmount: {
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
    checkToBtcAmount<T extends {
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
}
