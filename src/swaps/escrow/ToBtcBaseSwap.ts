import {SwapData} from "@atomiqlabs/base";
import {deserializeBN, serializeBN} from "../../utils/Utils";
import {EscrowHandlerSwap} from "./EscrowHandlerSwap";

export abstract class ToBtcBaseSwap<T extends SwapData = SwapData, S = any> extends EscrowHandlerSwap<T, S> {

    amount: bigint;

    quotedNetworkFee: bigint;
    readonly quotedNetworkFeeInToken: bigint;
    realNetworkFee: bigint;
    realNetworkFeeInToken: bigint;

    protected constructor(chainIdentifier: string, amount: bigint, swapFee: bigint, swapFeeInToken: bigint, quotedNetworkFee: bigint, quotedNetworkFeeInToken: bigint);
    protected constructor(obj: any);

    protected constructor(obj?: any | string, amount?: bigint, swapFee?: bigint, swapFeeInToken?: bigint, quotedNetworkFee?: bigint, quotedNetworkFeeInToken?: bigint) {
        if(
            typeof(obj)==="string" && typeof(amount)==="bigint" && typeof(swapFee)==="bigint" && typeof(swapFeeInToken)==="bigint" &&
            typeof(quotedNetworkFee)==="bigint" && typeof(quotedNetworkFeeInToken)==="bigint"
        ) {
            super(obj, swapFee, swapFeeInToken);
            this.amount = amount;
            this.quotedNetworkFee = quotedNetworkFee;
            this.quotedNetworkFeeInToken = quotedNetworkFeeInToken;
            return;
        } else {
            super(obj);
            this.amount = deserializeBN(obj.amount);
            this.quotedNetworkFee = deserializeBN(obj.quotedNetworkFee);
            this.quotedNetworkFeeInToken = deserializeBN(obj.quotedNetworkFeeInToken);
            this.realNetworkFee = deserializeBN(obj.realNetworkFee);
            this.realNetworkFeeInToken = deserializeBN(obj.realNetworkFeeInToken);
        }
    }

    serialize(): any {
        const obj = super.serialize();
        obj.amount = serializeBN(this.amount);
        obj.quotedNetworkFee = serializeBN(this.quotedNetworkFee);
        obj.quotedNetworkFeeInToken = serializeBN(this.quotedNetworkFeeInToken);
        obj.realNetworkFee = serializeBN(this.realNetworkFee);
        obj.realNetworkFeeInToken = serializeBN(this.realNetworkFeeInToken);
        return obj;
    }

    setRealNetworkFee(networkFeeInBtc: bigint) {
        this.realNetworkFee = networkFeeInBtc;
        if(this.quotedNetworkFee!=null && this.quotedNetworkFeeInToken!=null) {
            this.realNetworkFeeInToken = this.realNetworkFee * this.quotedNetworkFeeInToken / this.quotedNetworkFee;
        }
    }

    getInputAmount(): bigint {
        return this.getTotalInputAmount() - this.getSwapFee().inInputToken - this.getQuotedNetworkFee().inInputToken;
    }

    getTotalInputAmount(): bigint {
        return this.data.getAmount();
    }

    getSwapFee(): { inInputToken: bigint; inOutputToken: bigint } {
        return {inInputToken: this.swapFeeInToken, inOutputToken: this.swapFee};
    }

    /**
     * Returns quoted (expected) network fee, denominated in input & output tokens (the fee is paid only once, it is
     *  just represented here in both denomination for ease of use)
     */
    getQuotedNetworkFee(): { inInputToken: bigint; inOutputToken: bigint } {
        return {inInputToken: this.quotedNetworkFeeInToken, inOutputToken: this.quotedNetworkFee};
    }

    /**
     * Returns real network fee paid for the swap, denominated in input & output tokens (the fee is paid only once, it is
     *  just represented here in both denomination for ease of use)
     */
    getRealNetworkFee(): { inInputToken: bigint; inOutputToken: bigint } {
        return {inInputToken: this.realNetworkFeeInToken, inOutputToken: this.realNetworkFee};
    }

    getOutputAmount(): bigint {
        return this.amount;
    }

}