import {Lockable, StorageObject, SwapData} from "@atomiqlabs/base";
import {SwapHandlerSwap} from "../SwapHandlerSwap";

function objectBigIntsToString(obj: Object) {
    for(let key in obj) {
        if(typeof obj[key] === "bigint") obj[key] = obj[key].toString(10);
        if(typeof obj[key] === "object") objectBigIntsToString(obj[key]);
    }
    return obj;
}

export abstract class EscrowHandlerSwap<T extends SwapData = SwapData, S = any> extends SwapHandlerSwap<S> {

    data: T;

    txIds: {
        init?: string,
        claim?: string,
        refund?: string
    } = {};

    prefix: string;
    timeout: string;
    signature: string;
    feeRate: string;

    protected constructor(chainIdentifier: string, swapFee: bigint, swapFeeInToken: bigint);
    protected constructor(obj: any);

    protected constructor(obj?: any | string, swapFee?: bigint, swapFeeInToken?: bigint) {
        super(obj, swapFee, swapFeeInToken);
        if(typeof(obj)==="string" && typeof(swapFee)==="bigint" && typeof(swapFeeInToken)==="bigint") {
            return;
        } else {
            this.data = obj.data==null ? null : SwapData.deserialize(obj.data);
            this.prefix = obj.prefix;
            this.timeout = obj.timeout;
            this.signature = obj.signature;
            this.feeRate = obj.feeRate;
        }
    }

    serialize(): any {
        return {
            ...super.serialize(),
            data: this.data==null ? null : this.data.serialize(),
            prefix: this.prefix,
            timeout: this.timeout,
            signature: this.signature,
            feeRate: this.feeRate
        }
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
     * Returns the smart chain token used for the swap
     */
    getToken(): string {
        return this.data?.getToken();
    }

}