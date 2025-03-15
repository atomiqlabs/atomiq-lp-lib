import { Lockable, StorageObject } from "@atomiqlabs/base";
import { SwapHandlerType } from "./SwapHandler";
export declare abstract class SwapHandlerSwap<S = any> extends Lockable implements StorageObject {
    chainIdentifier: string;
    state: S;
    type: SwapHandlerType;
    metadata: {
        request: any;
        times: {
            [key: string]: number;
        };
        [key: string]: any;
    };
    txIds: {
        [key: string]: string;
    };
    readonly swapFee: bigint;
    readonly swapFeeInToken: bigint;
    protected constructor(chainIdentifier: string, swapFee: bigint, swapFeeInToken: bigint);
    protected constructor(obj: any);
    serialize(): any;
    /**
     * Sets the state of the swap and also calls swap change listener on plugins
     *
     * @param newState
     */
    setState(newState: S): Promise<void>;
    /**
     * Returns the identification hash of the swap, usually claim data hash, but can be overriden, e.g. for
     *  lightning swaps the identifier hash is used instead of claim data hash
     */
    abstract getIdentifierHash(): string;
    abstract getSequence(): bigint | null;
    /**
     * Returns unique identifier of the swap in the form <hash>_<sequence> or just <hash> if the swap type doesn't
     *  use sequence number
     */
    getIdentifier(): string;
    /**
     * Returns the smart chain token used for the swap
     */
    abstract getToken(): string;
    /**
     * Checks whether the swap is finished, such that it is final and either successful or failed
     */
    isFinished(): boolean;
    /**
     * Checks whether the swap was initiated by the user
     */
    abstract isInitiated(): boolean;
    /**
     * Checks whether the swap was finished and was successful
     */
    abstract isSuccess(): boolean;
    /**
     * Checks whether the swap was finished and was failed
     */
    abstract isFailed(): boolean;
    /**
     * Returns the input amount paid by the user (excluding fees)
     */
    getInputAmount(): bigint;
    /**
     * Returns the total input amount paid by the user (including all fees)
     */
    abstract getTotalInputAmount(): bigint;
    /**
     * Returns the actual output amount paid out to the user
     */
    abstract getOutputAmount(): bigint;
    /**
     * Returns swap fee, denominated in input & output tokens (the fee is paid only once, it is just represented here in
     *  both denomination for ease of use)
     */
    abstract getSwapFee(): {
        inInputToken: bigint;
        inOutputToken: bigint;
    };
}
