import {Lockable, StorageObject, SwapData} from "@atomiqlabs/base";
import {SwapHandlerType} from "./SwapHandler";
import {PluginManager} from "../plugins/PluginManager";
import {deserializeBN, serializeBN} from "../utils/Utils";

export abstract class SwapHandlerSwap<T extends SwapData = SwapData, S = any> extends Lockable implements StorageObject {

    chainIdentifier: string;
    state: S;

    type: SwapHandlerType;
    data: T;
    metadata: {
        request: any,
        times: {[key: string]: number},
        [key: string]: any
    };
    txIds: {
        init?: string,
        claim?: string,
        refund?: string
    } = {};
    readonly swapFee: bigint;
    readonly swapFeeInToken: bigint;

    prefix: string;
    timeout: string;
    signature: string;
    feeRate: string;

    protected constructor(chainIdentifier: string, swapFee: bigint, swapFeeInToken: bigint);
    protected constructor(obj: any);

    protected constructor(obj?: any | string, swapFee?: bigint, swapFeeInToken?: bigint) {
        super();
        if(typeof(obj)==="string" && typeof(swapFee)==="bigint" && typeof(swapFeeInToken)==="bigint") {
            this.chainIdentifier = obj;
            this.swapFee = swapFee;
            this.swapFeeInToken = swapFeeInToken;
            return;
        } else {
            this.data = obj.data==null ? null : SwapData.deserialize(obj.data);
            this.metadata = obj.metadata;
            this.chainIdentifier = obj.chainIdentifier;
            this.txIds = obj.txIds || {};
            this.state = obj.state;
            this.swapFee = deserializeBN(obj.swapFee);
            this.swapFeeInToken = deserializeBN(obj.swapFeeInToken);
            this.prefix = obj.prefix;
            this.timeout = obj.timeout;
            this.signature = obj.signature;
            this.feeRate = obj.feeRate;
        }
    }

    serialize(): any {
        return {
            state: this.state,
            data: this.data==null ? null : this.data.serialize(),
            chainIdentifier: this.chainIdentifier,
            metadata: this.metadata,
            txIds: this.txIds,
            swapFee: serializeBN(this.swapFee),
            swapFeeInToken: serializeBN(this.swapFeeInToken),
            prefix: this.prefix,
            timeout: this.timeout,
            signature: this.signature,
            feeRate: this.feeRate
        }
    }

    /**
     * Sets the state of the swap and also calls swap change listener on plugins
     *
     * @param newState
     */
    setState(newState: S): Promise<void> {
        const oldState = this.state;
        this.state = newState;
        return PluginManager.swapStateChange(this, oldState);
    }

    /**
     * Returns the escrow hash - i.e. hash of the escrow data
     */
    getEscrowHash(): string {
        return this.data.getEscrowHash();
    }

    /**
     * Returns the claim data hash - i.e. hash passed to the claim handler
     */
    getClaimHash(): string {
        return this.data.getClaimHash();
    }

    /**
     * Returns the identification hash of the swap, usually claim data hash, but can be overriden, e.g. for
     *  lightning swaps the identifier hash is used instead of claim data hash
     */
    getIdentifierHash(): string {
        return this.getClaimHash();
    }

    getSequence(): bigint | null {
        return this.data?.getSequence==null ? null : this.data.getSequence();
    }

    /**
     * Returns unique identifier of the swap in the form <hash>_<sequence> or just <hash> if the swap type doesn't
     *  use sequence number
     */
    getIdentifier(): string {
        if(this.getSequence()!=null) {
            return this.chainIdentifier+"_"+this.getIdentifierHash()+"_"+this.getSequence().toString(16);
        }
        return this.chainIdentifier+"_"+this.getIdentifierHash();
    }

    /**
     * Checks whether the swap is finished, such that it is final and either successful or failed
     */
    isFinished(): boolean {
        return this.isSuccess() || this.isFailed();
    }

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
    abstract getInputAmount(): bigint;

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
    abstract getSwapFee(): {inInputToken: bigint, inOutputToken: bigint};

}