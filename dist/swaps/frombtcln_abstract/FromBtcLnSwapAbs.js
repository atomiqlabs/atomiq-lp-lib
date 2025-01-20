"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcLnSwapAbs = exports.FromBtcLnSwapState = void 0;
const BN = require("bn.js");
const __1 = require("../..");
const FromBtcBaseSwap_1 = require("../FromBtcBaseSwap");
var FromBtcLnSwapState;
(function (FromBtcLnSwapState) {
    FromBtcLnSwapState[FromBtcLnSwapState["REFUNDED"] = -2] = "REFUNDED";
    FromBtcLnSwapState[FromBtcLnSwapState["CANCELED"] = -1] = "CANCELED";
    FromBtcLnSwapState[FromBtcLnSwapState["CREATED"] = 0] = "CREATED";
    FromBtcLnSwapState[FromBtcLnSwapState["RECEIVED"] = 1] = "RECEIVED";
    FromBtcLnSwapState[FromBtcLnSwapState["COMMITED"] = 2] = "COMMITED";
    FromBtcLnSwapState[FromBtcLnSwapState["CLAIMED"] = 3] = "CLAIMED";
    FromBtcLnSwapState[FromBtcLnSwapState["SETTLED"] = 4] = "SETTLED";
})(FromBtcLnSwapState = exports.FromBtcLnSwapState || (exports.FromBtcLnSwapState = {}));
class FromBtcLnSwapAbs extends FromBtcBaseSwap_1.FromBtcBaseSwap {
    constructor(chainIdOrObj, pr, amountMtokens, swapFee, swapFeeInToken) {
        if (typeof (chainIdOrObj) === "string") {
            super(chainIdOrObj, amountMtokens.add(new BN(999)).div(new BN(1000)), swapFee, swapFeeInToken);
            this.state = FromBtcLnSwapState.CREATED;
            this.pr = pr;
        }
        else {
            super(chainIdOrObj);
            this.pr = chainIdOrObj.pr;
            this.secret = chainIdOrObj.secret;
            this.nonce = chainIdOrObj.nonce;
        }
        this.type = __1.SwapHandlerType.FROM_BTCLN;
    }
    serialize() {
        const partialSerialized = super.serialize();
        partialSerialized.pr = this.pr;
        partialSerialized.secret = this.secret;
        partialSerialized.nonce = this.nonce;
        return partialSerialized;
    }
    getSequence() {
        return null;
    }
    isInitiated() {
        return this.state !== FromBtcLnSwapState.CREATED;
    }
    isFailed() {
        return this.state === FromBtcLnSwapState.CANCELED || this.state === FromBtcLnSwapState.REFUNDED;
    }
    isSuccess() {
        return this.state === FromBtcLnSwapState.SETTLED;
    }
}
exports.FromBtcLnSwapAbs = FromBtcLnSwapAbs;
