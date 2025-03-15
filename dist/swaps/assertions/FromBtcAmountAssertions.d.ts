import { FromBtcLnRequestType } from "../escrow/frombtcln_abstract/FromBtcLnAbs";
import { FromBtcRequestType } from "../escrow/frombtc_abstract/FromBtcAbs";
import { FromBtcLnTrustedRequestType } from "../trusted/frombtcln_trusted/FromBtcLnTrusted";
import { RequestData } from "../SwapHandler";
import { AmountAssertions } from "./AmountAssertions";
export declare class FromBtcAmountAssertions extends AmountAssertions {
    /**
     * Checks minimums/maximums, calculates the fee & total amount
     *
     * @param request
     * @param requestedAmount
     * @param useToken
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    preCheckFromBtcAmounts(request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType>, requestedAmount: {
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
    checkFromBtcAmount(request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType>, requestedAmount: {
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
}
