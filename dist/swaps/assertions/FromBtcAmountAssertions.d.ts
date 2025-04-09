import { FromBtcLnRequestType } from "../escrow/frombtcln_abstract/FromBtcLnAbs";
import { FromBtcRequestType } from "../escrow/frombtc_abstract/FromBtcAbs";
import { FromBtcLnTrustedRequestType } from "../trusted/frombtcln_trusted/FromBtcLnTrusted";
import { RequestData, SwapHandlerType } from "../SwapHandler";
import { AmountAssertions, AmountAssertionsConfig } from "./AmountAssertions";
import { ISwapPrice } from "../../prices/ISwapPrice";
import { FromBtcTrustedRequestType } from "../trusted/frombtc_trusted/FromBtcTrusted";
import { SpvVaultSwapRequestType } from "../spv_vault_swap/SpvVaultSwapHandler";
export type FromBtcAmountAssertionsConfig = AmountAssertionsConfig & {
    gasTokenMax?: {
        [chainId: string]: bigint;
    };
};
export declare class FromBtcAmountAssertions extends AmountAssertions {
    readonly config: FromBtcAmountAssertionsConfig;
    constructor(config: FromBtcAmountAssertionsConfig, swapPricing: ISwapPrice);
    /**
     * Checks minimums/maximums, calculates the fee & total amount
     *
     * @param swapType
     * @param request
     * @param requestedAmount
     * @param gasAmount
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    preCheckFromBtcAmounts(swapType: SwapHandlerType.FROM_BTCLN | SwapHandlerType.FROM_BTC | SwapHandlerType.FROM_BTCLN_TRUSTED | SwapHandlerType.FROM_BTC_TRUSTED | SwapHandlerType.FROM_BTC_SPV, request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType | FromBtcTrustedRequestType | SpvVaultSwapRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
        token: string;
    }, gasAmount?: {
        input: false;
        amount: bigint;
        token: string;
    }): Promise<{
        baseFee: bigint;
        feePPM: bigint;
        securityDepositApyPPM?: bigint;
        securityDepositBaseMultiplierPPM?: bigint;
    }>;
    /**
     * Checks minimums/maximums, calculates the fee & total amount
     *
     * @param swapType
     * @param request
     * @param requestedAmount
     * @param fees
     * @param signal
     * @param gasTokenAmount
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    checkFromBtcAmount(swapType: SwapHandlerType.FROM_BTCLN | SwapHandlerType.FROM_BTC | SwapHandlerType.FROM_BTCLN_TRUSTED | SwapHandlerType.FROM_BTC_TRUSTED | SwapHandlerType.FROM_BTC_SPV, request: RequestData<FromBtcLnRequestType | FromBtcRequestType | FromBtcLnTrustedRequestType | FromBtcTrustedRequestType | SpvVaultSwapRequestType>, requestedAmount: {
        input: boolean;
        amount: bigint;
        token: string;
        pricePrefetch?: Promise<bigint>;
    }, fees: {
        baseFee: bigint;
        feePPM: bigint;
    }, signal: AbortSignal, gasTokenAmount?: {
        input: false;
        amount: bigint;
        token: string;
        pricePrefetch?: Promise<bigint>;
    }): Promise<{
        amountBD: bigint;
        swapFee: bigint;
        swapFeeInToken: bigint;
        totalInToken: bigint;
        amountBDgas?: bigint;
        gasSwapFee?: bigint;
        gasSwapFeeInToken?: bigint;
        totalInGasToken?: bigint;
        securityDepositApyPPM?: bigint;
        securityDepositBaseMultiplierPPM?: bigint;
    }>;
}
