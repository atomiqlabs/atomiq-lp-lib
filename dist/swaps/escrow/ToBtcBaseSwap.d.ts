import { SwapData } from "@atomiqlabs/base";
import { EscrowHandlerSwap } from "./EscrowHandlerSwap";
export declare abstract class ToBtcBaseSwap<T extends SwapData = SwapData, S = any> extends EscrowHandlerSwap<T, S> {
    amount: bigint;
    quotedNetworkFee: bigint;
    readonly quotedNetworkFeeInToken: bigint;
    realNetworkFee: bigint;
    realNetworkFeeInToken: bigint;
    protected constructor(chainIdentifier: string, amount: bigint, swapFee: bigint, swapFeeInToken: bigint, quotedNetworkFee: bigint, quotedNetworkFeeInToken: bigint);
    protected constructor(obj: any);
    serialize(): any;
    setRealNetworkFee(networkFeeInBtc: bigint): void;
    getInputAmount(): bigint;
    getTotalInputAmount(): bigint;
    getSwapFee(): {
        inInputToken: bigint;
        inOutputToken: bigint;
    };
    /**
     * Returns quoted (expected) network fee, denominated in input & output tokens (the fee is paid only once, it is
     *  just represented here in both denomination for ease of use)
     */
    getQuotedNetworkFee(): {
        inInputToken: bigint;
        inOutputToken: bigint;
    };
    /**
     * Returns real network fee paid for the swap, denominated in input & output tokens (the fee is paid only once, it is
     *  just represented here in both denomination for ease of use)
     */
    getRealNetworkFee(): {
        inInputToken: bigint;
        inOutputToken: bigint;
    };
    getOutputAmount(): bigint;
}
