"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcBaseSwap = void 0;
const Utils_1 = require("../../utils/Utils");
const EscrowHandlerSwap_1 = require("./EscrowHandlerSwap");
class FromBtcBaseSwap extends EscrowHandlerSwap_1.EscrowHandlerSwap {
    constructor(obj, amount, swapFee, swapFeeInToken) {
        super(obj, swapFee, swapFeeInToken);
        if (typeof (obj) === "string" && typeof (amount) === "bigint" && typeof (swapFee) === "bigint" && typeof (swapFeeInToken) === "bigint") {
            this.amount = amount;
        }
        else {
            this.amount = (0, Utils_1.deserializeBN)(obj.amount);
        }
    }
    ;
    getTotalInputAmount() {
        return this.amount;
    }
    getOutputAmount() {
        return this.data?.getAmount();
    }
    getSwapFee() {
        return { inInputToken: this.swapFee, inOutputToken: this.swapFeeInToken };
    }
    serialize() {
        const partialSerialized = super.serialize();
        partialSerialized.amount = (0, Utils_1.serializeBN)(this.amount);
        return partialSerialized;
    }
}
exports.FromBtcBaseSwap = FromBtcBaseSwap;
