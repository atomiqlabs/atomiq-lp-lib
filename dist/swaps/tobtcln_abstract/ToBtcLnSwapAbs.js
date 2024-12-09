"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToBtcLnSwapAbs = exports.ToBtcLnSwapState = void 0;
const BN = require("bn.js");
const bolt11 = require("@atomiqlabs/bolt11");
const __1 = require("../..");
const Utils_1 = require("../../utils/Utils");
const ToBtcBaseSwap_1 = require("../ToBtcBaseSwap");
var ToBtcLnSwapState;
(function (ToBtcLnSwapState) {
    ToBtcLnSwapState[ToBtcLnSwapState["REFUNDED"] = -3] = "REFUNDED";
    ToBtcLnSwapState[ToBtcLnSwapState["CANCELED"] = -2] = "CANCELED";
    ToBtcLnSwapState[ToBtcLnSwapState["NON_PAYABLE"] = -1] = "NON_PAYABLE";
    ToBtcLnSwapState[ToBtcLnSwapState["SAVED"] = 0] = "SAVED";
    ToBtcLnSwapState[ToBtcLnSwapState["COMMITED"] = 1] = "COMMITED";
    ToBtcLnSwapState[ToBtcLnSwapState["PAID"] = 2] = "PAID";
    ToBtcLnSwapState[ToBtcLnSwapState["CLAIMED"] = 3] = "CLAIMED";
})(ToBtcLnSwapState = exports.ToBtcLnSwapState || (exports.ToBtcLnSwapState = {}));
class ToBtcLnSwapAbs extends ToBtcBaseSwap_1.ToBtcBaseSwap {
    constructor(chainIdOrObj, pr, swapFee, swapFeeInToken, quotedNetworkFee, quotedNetworkFeeInToken, signatureExpiry) {
        var _a, _b;
        if (typeof (chainIdOrObj) === "string") {
            super(chainIdOrObj, swapFee, swapFeeInToken, quotedNetworkFee, quotedNetworkFeeInToken);
            this.state = ToBtcLnSwapState.SAVED;
            this.pr = pr;
            this.signatureExpiry = signatureExpiry;
        }
        else {
            super(chainIdOrObj);
            this.pr = chainIdOrObj.pr;
            this.signatureExpiry = (0, Utils_1.deserializeBN)(chainIdOrObj.signatureExpiry);
            this.secret = chainIdOrObj.secret;
            //Compatibility with older versions
            (_a = this.quotedNetworkFee) !== null && _a !== void 0 ? _a : (this.quotedNetworkFee = (0, Utils_1.deserializeBN)(chainIdOrObj.maxFee));
            (_b = this.realNetworkFee) !== null && _b !== void 0 ? _b : (this.realNetworkFee = (0, Utils_1.deserializeBN)(chainIdOrObj.realRoutingFee));
        }
        this.type = __1.SwapHandlerType.TO_BTCLN;
    }
    serialize() {
        const partialSerialized = super.serialize();
        partialSerialized.pr = this.pr;
        partialSerialized.signatureExpiry = (0, Utils_1.serializeBN)(this.signatureExpiry);
        partialSerialized.secret = this.secret;
        return partialSerialized;
    }
    getHash() {
        return bolt11.decode(this.pr).tagsObject.payment_hash;
    }
    getHashBuffer() {
        return Buffer.from(bolt11.decode(this.pr).tagsObject.payment_hash, "hex");
    }
    isInitiated() {
        return this.state !== ToBtcLnSwapState.SAVED;
    }
    isFailed() {
        return this.state === ToBtcLnSwapState.NON_PAYABLE || this.state === ToBtcLnSwapState.CANCELED || this.state === ToBtcLnSwapState.REFUNDED;
    }
    isSuccess() {
        return this.state === ToBtcLnSwapState.CLAIMED;
    }
    getOutputAmount() {
        return new BN(bolt11.decode(this.pr).millisatoshis).add(new BN(999)).div(new BN(1000));
    }
}
exports.ToBtcLnSwapAbs = ToBtcLnSwapAbs;
