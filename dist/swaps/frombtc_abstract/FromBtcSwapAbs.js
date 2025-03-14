"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcSwapAbs = exports.FromBtcSwapState = void 0;
const SwapHandler_1 = require("../SwapHandler");
const FromBtcBaseSwap_1 = require("../FromBtcBaseSwap");
var FromBtcSwapState;
(function (FromBtcSwapState) {
    FromBtcSwapState[FromBtcSwapState["REFUNDED"] = -2] = "REFUNDED";
    FromBtcSwapState[FromBtcSwapState["CANCELED"] = -1] = "CANCELED";
    FromBtcSwapState[FromBtcSwapState["CREATED"] = 0] = "CREATED";
    FromBtcSwapState[FromBtcSwapState["COMMITED"] = 1] = "COMMITED";
    FromBtcSwapState[FromBtcSwapState["CLAIMED"] = 2] = "CLAIMED";
})(FromBtcSwapState = exports.FromBtcSwapState || (exports.FromBtcSwapState = {}));
class FromBtcSwapAbs extends FromBtcBaseSwap_1.FromBtcBaseSwap {
    constructor(prOrObj, address, confirmations, amount, swapFee, swapFeeInToken) {
        if (typeof (prOrObj) === "string") {
            super(prOrObj, amount, swapFee, swapFeeInToken);
            this.state = FromBtcSwapState.CREATED;
            this.address = address;
            this.confirmations = confirmations;
        }
        else {
            super(prOrObj);
            this.address = prOrObj.address;
            this.confirmations = prOrObj.confirmations;
            this.txId = prOrObj.txId;
        }
        this.type = SwapHandler_1.SwapHandlerType.FROM_BTC;
    }
    serialize() {
        const partialSerialized = super.serialize();
        partialSerialized.address = this.address;
        partialSerialized.confirmations = this.confirmations;
        partialSerialized.txId = this.txId;
        return partialSerialized;
    }
    isInitiated() {
        return this.state !== FromBtcSwapState.CREATED;
    }
    isFailed() {
        return this.state === FromBtcSwapState.CANCELED || this.state === FromBtcSwapState.REFUNDED;
    }
    isSuccess() {
        return this.state === FromBtcSwapState.CLAIMED;
    }
    getTotalInputAmount() {
        return this.amount;
    }
}
exports.FromBtcSwapAbs = FromBtcSwapAbs;
