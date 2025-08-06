"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToBtcLnSwapAbs = exports.ToBtcLnSwapState = void 0;
const index_1 = require("../../../index");
const Utils_1 = require("../../../utils/Utils");
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
    constructor(chainIdOrObj, lnPaymentHash, pr, amount, swapFee, swapFeeInToken, quotedNetworkFee, quotedNetworkFeeInToken) {
        if (typeof (chainIdOrObj) === "string") {
            super(chainIdOrObj, (amount + 999n) / 1000n, swapFee, swapFeeInToken, quotedNetworkFee, quotedNetworkFeeInToken);
            this.state = ToBtcLnSwapState.SAVED;
            this.lnPaymentHash = lnPaymentHash;
            this.pr = pr;
        }
        else {
            super(chainIdOrObj);
            this.pr = chainIdOrObj.pr;
            this.secret = chainIdOrObj.secret;
            this.lnPaymentHash = chainIdOrObj.lnPaymentHash;
            this.payInitiated = chainIdOrObj.payInitiated;
            //Compatibility with older versions
            this.quotedNetworkFee ?? (this.quotedNetworkFee = (0, Utils_1.deserializeBN)(chainIdOrObj.maxFee));
            this.realNetworkFee ?? (this.realNetworkFee = (0, Utils_1.deserializeBN)(chainIdOrObj.realRoutingFee));
        }
        this.type = index_1.SwapHandlerType.TO_BTCLN;
    }
    getIdentifierHash() {
        return this.lnPaymentHash;
    }
    serialize() {
        const partialSerialized = super.serialize();
        partialSerialized.pr = this.pr;
        partialSerialized.lnPaymentHash = this.lnPaymentHash;
        partialSerialized.secret = this.secret;
        partialSerialized.payInitiated = this.payInitiated;
        return partialSerialized;
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
}
exports.ToBtcLnSwapAbs = ToBtcLnSwapAbs;
