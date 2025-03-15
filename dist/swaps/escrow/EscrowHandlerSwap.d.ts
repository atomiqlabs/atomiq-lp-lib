import { SwapData } from "@atomiqlabs/base";
import { SwapHandlerSwap } from "../SwapHandlerSwap";
export declare abstract class EscrowHandlerSwap<T extends SwapData = SwapData, S = any> extends SwapHandlerSwap<S> {
    data: T;
    txIds: {
        init?: string;
        claim?: string;
        refund?: string;
    };
    prefix: string;
    timeout: string;
    signature: string;
    feeRate: string;
    protected constructor(chainIdentifier: string, swapFee: bigint, swapFeeInToken: bigint);
    protected constructor(obj: any);
    serialize(): any;
    /**
     * Returns the escrow hash - i.e. hash of the escrow data
     */
    getEscrowHash(): string;
    /**
     * Returns the claim data hash - i.e. hash passed to the claim handler
     */
    getClaimHash(): string;
    /**
     * Returns the identification hash of the swap, usually claim data hash, but can be overriden, e.g. for
     *  lightning swaps the identifier hash is used instead of claim data hash
     */
    getIdentifierHash(): string;
    getSequence(): bigint | null;
    /**
     * Returns the smart chain token used for the swap
     */
    getToken(): string;
}
