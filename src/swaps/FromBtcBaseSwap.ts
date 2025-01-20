import {SwapData} from "@atomiqlabs/base";
import {SwapHandlerSwap} from "./SwapHandlerSwap";
import * as BN from "bn.js";
import {deserializeBN, serializeBN} from "../utils/Utils";

export abstract class FromBtcBaseSwap<T extends SwapData, S = any> extends SwapHandlerSwap<T, S> {

    amount: BN;

    protected constructor(chainIdentifier: string, amount: BN, swapFee: BN, swapFeeInToken: BN);
    protected constructor(obj: any);

    protected constructor(obj?: any | string, amount?: BN, swapFee?: BN, swapFeeInToken?: BN) {
        super(obj, swapFee, swapFeeInToken);
        if (typeof (obj) === "string" && BN.isBN(amount) && BN.isBN(swapFee) && BN.isBN(swapFeeInToken)) {
            this.amount = amount;
        } else {
            this.amount = deserializeBN(obj.amount);
        }
    };

    getInputAmount(): BN {
        return this.getTotalInputAmount().sub(this.getSwapFee().inInputToken);
    }

    getTotalInputAmount(): BN {
        return this.amount;
    }

    getOutputAmount(): BN {
        return this.data.getAmount();
    }

    getSwapFee(): { inInputToken: BN; inOutputToken: BN } {
        return {inInputToken: this.swapFee, inOutputToken: this.swapFeeInToken};
    }

    serialize(): any {
        const partialSerialized = super.serialize();
        partialSerialized.amount = serializeBN(this.amount);
        return partialSerialized;
    }

}