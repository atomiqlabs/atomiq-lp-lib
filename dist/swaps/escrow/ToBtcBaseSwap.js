"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToBtcBaseSwap = void 0;
const Utils_1 = require("../../utils/Utils");
const EscrowHandlerSwap_1 = require("./EscrowHandlerSwap");
class ToBtcBaseSwap extends EscrowHandlerSwap_1.EscrowHandlerSwap {
    constructor(obj, amount, swapFee, swapFeeInToken, quotedNetworkFee, quotedNetworkFeeInToken) {
        if (typeof (obj) === "string" && typeof (amount) === "bigint" && typeof (swapFee) === "bigint" && typeof (swapFeeInToken) === "bigint" &&
            typeof (quotedNetworkFee) === "bigint" && typeof (quotedNetworkFeeInToken) === "bigint") {
            super(obj, swapFee, swapFeeInToken);
            this.amount = amount;
            this.quotedNetworkFee = quotedNetworkFee;
            this.quotedNetworkFeeInToken = quotedNetworkFeeInToken;
            return;
        }
        else {
            super(obj);
            this.amount = (0, Utils_1.deserializeBN)(obj.amount);
            this.quotedNetworkFee = (0, Utils_1.deserializeBN)(obj.quotedNetworkFee);
            this.quotedNetworkFeeInToken = (0, Utils_1.deserializeBN)(obj.quotedNetworkFeeInToken);
            this.realNetworkFee = (0, Utils_1.deserializeBN)(obj.realNetworkFee);
            this.realNetworkFeeInToken = (0, Utils_1.deserializeBN)(obj.realNetworkFeeInToken);
        }
    }
    serialize() {
        const obj = super.serialize();
        obj.amount = (0, Utils_1.serializeBN)(this.amount);
        obj.quotedNetworkFee = (0, Utils_1.serializeBN)(this.quotedNetworkFee);
        obj.quotedNetworkFeeInToken = (0, Utils_1.serializeBN)(this.quotedNetworkFeeInToken);
        obj.realNetworkFee = (0, Utils_1.serializeBN)(this.realNetworkFee);
        obj.realNetworkFeeInToken = (0, Utils_1.serializeBN)(this.realNetworkFeeInToken);
        return obj;
    }
    setRealNetworkFee(networkFeeInBtc) {
        this.realNetworkFee = networkFeeInBtc;
        if (this.quotedNetworkFee != null && this.quotedNetworkFeeInToken != null) {
            this.realNetworkFeeInToken = this.realNetworkFee * this.quotedNetworkFeeInToken / this.quotedNetworkFee;
        }
    }
    getInputAmount() {
        return this.getTotalInputAmount() - this.getSwapFee().inInputToken - this.getQuotedNetworkFee().inInputToken;
    }
    getTotalInputAmount() {
        return this.data.getAmount();
    }
    getSwapFee() {
        return { inInputToken: this.swapFeeInToken, inOutputToken: this.swapFee };
    }
    /**
     * Returns quoted (expected) network fee, denominated in input & output tokens (the fee is paid only once, it is
     *  just represented here in both denomination for ease of use)
     */
    getQuotedNetworkFee() {
        return { inInputToken: this.quotedNetworkFeeInToken, inOutputToken: this.quotedNetworkFee };
    }
    /**
     * Returns real network fee paid for the swap, denominated in input & output tokens (the fee is paid only once, it is
     *  just represented here in both denomination for ease of use)
     */
    getRealNetworkFee() {
        return { inInputToken: this.realNetworkFeeInToken, inOutputToken: this.realNetworkFee };
    }
    getOutputAmount() {
        return this.amount;
    }
}
exports.ToBtcBaseSwap = ToBtcBaseSwap;
