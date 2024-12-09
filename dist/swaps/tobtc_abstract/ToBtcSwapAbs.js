"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToBtcSwapAbs = exports.ToBtcSwapState = void 0;
const BN = require("bn.js");
const __1 = require("../..");
const ToBtcBaseSwap_1 = require("../ToBtcBaseSwap");
const Utils_1 = require("../../utils/Utils");
var ToBtcSwapState;
(function (ToBtcSwapState) {
    ToBtcSwapState[ToBtcSwapState["REFUNDED"] = -3] = "REFUNDED";
    ToBtcSwapState[ToBtcSwapState["CANCELED"] = -2] = "CANCELED";
    ToBtcSwapState[ToBtcSwapState["NON_PAYABLE"] = -1] = "NON_PAYABLE";
    ToBtcSwapState[ToBtcSwapState["SAVED"] = 0] = "SAVED";
    ToBtcSwapState[ToBtcSwapState["COMMITED"] = 1] = "COMMITED";
    ToBtcSwapState[ToBtcSwapState["BTC_SENDING"] = 2] = "BTC_SENDING";
    ToBtcSwapState[ToBtcSwapState["BTC_SENT"] = 3] = "BTC_SENT";
    ToBtcSwapState[ToBtcSwapState["CLAIMED"] = 4] = "CLAIMED";
})(ToBtcSwapState = exports.ToBtcSwapState || (exports.ToBtcSwapState = {}));
class ToBtcSwapAbs extends ToBtcBaseSwap_1.ToBtcBaseSwap {
    constructor(chainIdOrObj, address, amount, swapFee, swapFeeInToken, networkFee, networkFeeInToken, satsPerVbyte, nonce, preferedConfirmationTarget, signatureExpiry) {
        var _a;
        if (typeof (chainIdOrObj) === "string") {
            super(chainIdOrObj, swapFee, swapFeeInToken, networkFee, networkFeeInToken);
            this.state = ToBtcSwapState.SAVED;
            this.address = address;
            this.amount = amount;
            this.satsPerVbyte = satsPerVbyte;
            this.nonce = nonce;
            this.preferedConfirmationTarget = preferedConfirmationTarget;
            this.signatureExpiry = signatureExpiry;
        }
        else {
            super(chainIdOrObj);
            this.address = chainIdOrObj.address;
            this.amount = new BN(chainIdOrObj.amount);
            this.satsPerVbyte = new BN(chainIdOrObj.satsPerVbyte);
            this.nonce = new BN(chainIdOrObj.nonce);
            this.preferedConfirmationTarget = chainIdOrObj.preferedConfirmationTarget;
            this.signatureExpiry = (0, Utils_1.deserializeBN)(chainIdOrObj.signatureExpiry);
            this.txId = chainIdOrObj.txId;
            //Compatibility
            (_a = this.quotedNetworkFee) !== null && _a !== void 0 ? _a : (this.quotedNetworkFee = (0, Utils_1.deserializeBN)(chainIdOrObj.networkFee));
        }
        this.type = __1.SwapHandlerType.TO_BTC;
    }
    serialize() {
        const partialSerialized = super.serialize();
        partialSerialized.address = this.address;
        partialSerialized.amount = this.amount.toString(10);
        partialSerialized.satsPerVbyte = this.satsPerVbyte.toString(10);
        partialSerialized.nonce = this.nonce.toString(10);
        partialSerialized.preferedConfirmationTarget = this.preferedConfirmationTarget;
        partialSerialized.signatureExpiry = (0, Utils_1.serializeBN)(this.signatureExpiry);
        partialSerialized.txId = this.txId;
        return partialSerialized;
    }
    isInitiated() {
        return this.state !== ToBtcSwapState.SAVED;
    }
    isFailed() {
        return this.state === ToBtcSwapState.NON_PAYABLE || this.state === ToBtcSwapState.REFUNDED || this.state === ToBtcSwapState.CANCELED;
    }
    isSuccess() {
        return this.state === ToBtcSwapState.CLAIMED;
    }
    getOutputAmount() {
        return this.amount;
    }
}
exports.ToBtcSwapAbs = ToBtcSwapAbs;
