import { Lockable, StorageObject, SwapData } from "@atomiqlabs/base";
import { SwapHandlerType } from "./SwapHandler";
import * as BN from "bn.js";
export declare abstract class SwapHandlerSwap<T extends SwapData = SwapData, S = any> extends Lockable implements StorageObject {
    chainIdentifier: string;
    state: S;
    type: SwapHandlerType;
    data: T;
    metadata: {
        request: any;
        times: {
            [key: string]: number;
        };
        [key: string]: any;
    };
    txIds: {
        init?: string;
        claim?: string;
        refund?: string;
    };
    readonly swapFee: BN;
    readonly swapFeeInToken: BN;
    protected constructor(chainIdentifier: string, swapFee: BN, swapFeeInToken: BN);
    protected constructor(obj: any);
    serialize(): any;
    /**
     * Sets the state of the swap and also calls swap change listener on plugins
     *
     * @param newState
     */
    setState(newState: S): Promise<void>;
    getHash(): string;
    getSequence(): BN;
    /**
     * Returns unique identifier of the swap in the form <hash>_<sequence> or just <hash> if the swap type doesn't
     *  use sequence number
     */
    getIdentifier(): string;
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
    abstract getInputAmount(): BN;
    /**
     * Returns the total input amount paid by the user (including all fees)
     */
    abstract getTotalInputAmount(): BN;
    /**
     * Returns the actual output amount paid out to the user
     */
    abstract getOutputAmount(): BN;
    /**
     * Returns swap fee, denominated in input & output tokens (the fee is paid only once, it is just represented here in
     *  both denomination for ease of use)
     */
    abstract getSwapFee(): {
        inInputToken: BN;
        inOutputToken: BN;
    };
}
