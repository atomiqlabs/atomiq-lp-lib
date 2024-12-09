"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcLnTrustedSwap = exports.FromBtcLnTrustedSwapState = void 0;
const BN = require("bn.js");
const crypto_1 = require("crypto");
const bolt11 = require("@atomiqlabs/bolt11");
const FromBtcBaseSwap_1 = require("../FromBtcBaseSwap");
var FromBtcLnTrustedSwapState;
(function (FromBtcLnTrustedSwapState) {
    FromBtcLnTrustedSwapState[FromBtcLnTrustedSwapState["REFUNDED"] = -2] = "REFUNDED";
    FromBtcLnTrustedSwapState[FromBtcLnTrustedSwapState["CANCELED"] = -1] = "CANCELED";
    FromBtcLnTrustedSwapState[FromBtcLnTrustedSwapState["CREATED"] = 0] = "CREATED";
    FromBtcLnTrustedSwapState[FromBtcLnTrustedSwapState["RECEIVED"] = 1] = "RECEIVED";
    FromBtcLnTrustedSwapState[FromBtcLnTrustedSwapState["SENT"] = 2] = "SENT";
    FromBtcLnTrustedSwapState[FromBtcLnTrustedSwapState["CONFIRMED"] = 3] = "CONFIRMED";
    FromBtcLnTrustedSwapState[FromBtcLnTrustedSwapState["SETTLED"] = 4] = "SETTLED";
})(FromBtcLnTrustedSwapState = exports.FromBtcLnTrustedSwapState || (exports.FromBtcLnTrustedSwapState = {}));
class FromBtcLnTrustedSwap extends FromBtcBaseSwap_1.FromBtcBaseSwap {
    constructor(chainIdOrObj, pr, swapFee, swapFeeInToken, output, secret, dstAddress) {
        if (typeof (chainIdOrObj) === "string") {
            super(chainIdOrObj, swapFee, swapFeeInToken);
            this.state = FromBtcLnTrustedSwapState.CREATED;
            this.pr = pr;
            this.output = output;
            this.secret = secret;
            this.dstAddress = dstAddress;
        }
        else {
            super(chainIdOrObj);
            this.pr = chainIdOrObj.pr;
            this.output = new BN(chainIdOrObj.output);
            this.secret = chainIdOrObj.secret;
            this.dstAddress = chainIdOrObj.dstAddress;
            this.scRawTx = chainIdOrObj.scRawTx;
        }
        this.type = null;
    }
    getHash() {
        return (0, crypto_1.createHash)("sha256").update(Buffer.from(this.secret, "hex")).digest().toString("hex");
    }
    getSequence() {
        return new BN(0);
    }
    serialize() {
        const partialSerialized = super.serialize();
        partialSerialized.pr = this.pr;
        partialSerialized.output = this.output.toString(10);
        partialSerialized.secret = this.secret;
        partialSerialized.dstAddress = this.dstAddress;
        partialSerialized.scRawTx = this.scRawTx;
        return partialSerialized;
    }
    getTotalInputAmount() {
        return new BN(bolt11.decode(this.pr).millisatoshis).add(new BN(999)).div(new BN(1000));
    }
    isFailed() {
        return this.state === FromBtcLnTrustedSwapState.CANCELED || this.state === FromBtcLnTrustedSwapState.REFUNDED;
    }
    isInitiated() {
        return this.state !== FromBtcLnTrustedSwapState.CREATED;
    }
    isSuccess() {
        return this.state === FromBtcLnTrustedSwapState.SETTLED;
    }
}
exports.FromBtcLnTrustedSwap = FromBtcLnTrustedSwap;
