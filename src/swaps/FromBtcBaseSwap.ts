import {SwapData} from "@atomiqlabs/base";
import {SwapHandlerSwap} from "./SwapHandlerSwap";
import {deserializeBN, serializeBN} from "../utils/Utils";

export abstract class FromBtcBaseSwap<T extends SwapData, S = any> extends SwapHandlerSwap<T, S> {

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

    getInputAmount(): bigint {
        return this.getTotalInputAmount() - this.getSwapFee().inInputToken;
    }

    getTotalInputAmount(): bigint {
        return this.amount;
    }

    getOutputAmount(): bigint {
        return this.data.getAmount();
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