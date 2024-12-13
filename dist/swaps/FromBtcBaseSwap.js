"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcBaseSwap = void 0;
const SwapHandlerSwap_1 = require("./SwapHandlerSwap");
const BN = require("bn.js");
const Utils_1 = require("../utils/Utils");
class FromBtcBaseSwap extends SwapHandlerSwap_1.SwapHandlerSwap {
    constructor(obj, amount, swapFee, swapFeeInToken) {
        super(obj, swapFee, swapFeeInToken);
        if (typeof (obj) === "string" && BN.isBN(amount) && BN.isBN(swapFee) && BN.isBN(swapFeeInToken)) {
            this.amount = amount;
        }
        else {
            this.amount = (0, Utils_1.deserializeBN)(obj.amount);
        }
    }
    ;
    getInputAmount() {
        return this.getTotalInputAmount().sub(this.getSwapFee().inInputToken);
    }
    getTotalInputAmount() {
        return this.amount;
    }
    getOutputAmount() {
        return this.data.getAmount();
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
