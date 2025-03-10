"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcLnTrustedSwap = exports.FromBtcLnTrustedSwapState = void 0;
const crypto_1 = require("crypto");
const FromBtcBaseSwap_1 = require("../FromBtcBaseSwap");
const Utils_1 = require("../../utils/Utils");
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
    constructor(chainIdOrObj, pr, inputMtokens, swapFee, swapFeeInToken, output, secret, dstAddress, token) {
        if (typeof (chainIdOrObj) === "string") {
            super(chainIdOrObj, (inputMtokens + 999n) / 1000n, swapFee, swapFeeInToken);
            this.state = FromBtcLnTrustedSwapState.CREATED;
            this.pr = pr;
            this.output = output;
            this.secret = secret;
            this.dstAddress = dstAddress;
            this.token = token;
        }
        else {
            super(chainIdOrObj);
            this.pr = chainIdOrObj.pr;
            this.output = (0, Utils_1.deserializeBN)(chainIdOrObj.output);
            this.secret = chainIdOrObj.secret;
            this.dstAddress = chainIdOrObj.dstAddress;
            this.token = chainIdOrObj.token;
            this.scRawTx = chainIdOrObj.scRawTx;
        }
        this.type = null;
    }
    getToken() {
        return this.token;
    }
    getOutputAmount() {
        return this.output;
    }
    getClaimHash() {
        return (0, crypto_1.createHash)("sha256").update(Buffer.from(this.secret, "hex")).digest().toString("hex");
    }
    getSequence() {
        return 0n;
    }
    serialize() {
        const partialSerialized = super.serialize();
        partialSerialized.pr = this.pr;
        partialSerialized.output = (0, Utils_1.serializeBN)(this.output);
        partialSerialized.secret = this.secret;
        partialSerialized.dstAddress = this.dstAddress;
        partialSerialized.token = this.token;
        partialSerialized.scRawTx = this.scRawTx;
        return partialSerialized;
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
