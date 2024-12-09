"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcBaseSwap = void 0;
const SwapHandlerSwap_1 = require("./SwapHandlerSwap");
class FromBtcBaseSwap extends SwapHandlerSwap_1.SwapHandlerSwap {
    getInputAmount() {
        return this.getTotalInputAmount().sub(this.getSwapFee().inInputToken);
    }
    getOutputAmount() {
        return this.data.getAmount();
    }
    getSwapFee() {
        return { inInputToken: this.swapFee, inOutputToken: this.swapFeeInToken };
    }
}
exports.FromBtcBaseSwap = FromBtcBaseSwap;
