import {deserializeBN, serializeBN} from "../../utils/Utils";
import {EscrowHandlerSwap} from "./EscrowHandlerSwap";
import {SwapData} from "@atomiqlabs/base";

export abstract class FromBtcBaseSwap<T extends SwapData = SwapData, S = any> extends EscrowHandlerSwap<T, S> {

    amount: bigint;

    protected constructor(chainIdentifier: string, amount: bigint, swapFee: bigint, swapFeeInToken: bigint);
    protected constructor(obj: any);

    protected constructor(obj?: any | string, amount?: bigint, swapFee?: bigint, swapFeeInToken?: bigint) {
        super(obj, swapFee, swapFeeInToken);
        if (typeof (obj) === "string" && typeof(amount)==="bigint" && typeof(swapFee)==="bigint" && typeof(swapFeeInToken)==="bigint") {
            this.amount = amount;
        } else {
            this.amount = deserializeBN(obj.amount);
        }
    };

    getTotalInputAmount(): bigint {
        return this.amount;
    }

    getOutputAmount(): bigint {
        return this.data?.getAmount();
    }

    getSwapFee(): { inInputToken: bigint; inOutputToken: bigint } {
        return {inInputToken: this.swapFee, inOutputToken: this.swapFeeInToken};
    }

    serialize(): any {
        const partialSerialized = super.serialize();
        partialSerialized.amount = serializeBN(this.amount);
        return partialSerialized;
    }

}