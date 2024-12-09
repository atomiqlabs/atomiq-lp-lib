"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcLnSwapAbs = exports.FromBtcLnSwapState = void 0;
const BN = require("bn.js");
const __1 = require("../..");
const bolt11 = require("@atomiqlabs/bolt11");
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
    constructor(chainIdOrObj, pr, swapFee, swapFeeInToken) {
        if (typeof (chainIdOrObj) === "string") {
            super(chainIdOrObj, swapFee, swapFeeInToken);
            this.state = FromBtcLnSwapState.CREATED;
            this.pr = pr;
        }
        else {
            super(chainIdOrObj);
            this.pr = chainIdOrObj.pr;
            this.secret = chainIdOrObj.secret;
            this.nonce = chainIdOrObj.nonce;
            this.prefix = chainIdOrObj.prefix;
            this.timeout = chainIdOrObj.timeout;
            this.signature = chainIdOrObj.signature;
            this.feeRate = chainIdOrObj.feeRate;
        }
        this.type = __1.SwapHandlerType.FROM_BTCLN;
    }
    serialize() {
        const partialSerialized = super.serialize();
        partialSerialized.pr = this.pr;
        partialSerialized.secret = this.secret;
        partialSerialized.nonce = this.nonce;
        partialSerialized.prefix = this.prefix;
        partialSerialized.timeout = this.timeout;
        partialSerialized.signature = this.signature;
        partialSerialized.feeRate = this.feeRate;
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
    getTotalInputAmount() {
        return new BN(bolt11.decode(this.pr).millisatoshis).add(new BN(999)).div(new BN(1000));
    }
}
exports.FromBtcLnSwapAbs = FromBtcLnSwapAbs;
