"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcLnTrustedSwap = exports.FromBtcLnTrustedSwapState = void 0;
const crypto_1 = require("crypto");
const Utils_1 = require("../../../utils/Utils");
const SwapHandlerSwap_1 = require("../../SwapHandlerSwap");
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
class FromBtcLnTrustedSwap extends SwapHandlerSwap_1.SwapHandlerSwap {
    constructor(chainIdOrObj, pr, inputMtokens, swapFee, swapFeeInToken, output, secret, dstAddress, token) {
        if (typeof (chainIdOrObj) === "string") {
            super(chainIdOrObj, swapFee, swapFeeInToken);
            this.state = FromBtcLnTrustedSwapState.CREATED;
            this.pr = pr;
            this.amount = (inputMtokens + 999n) / 1000n;
            this.output = output;
            this.secret = secret;
            this.dstAddress = dstAddress;
            this.token = token;
        }
        else {
            super(chainIdOrObj);
            this.pr = chainIdOrObj.pr;
            this.amount = (0, Utils_1.deserializeBN)(chainIdOrObj.amount);
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
    getSwapFee() {
        return { inInputToken: this.swapFee, inOutputToken: this.swapFeeInToken };
    }
    getTotalInputAmount() {
        return this.amount;
    }
    getSequence() {
        return 0n;
    }
    serialize() {
        const partialSerialized = super.serialize();
        partialSerialized.pr = this.pr;
        partialSerialized.amount = (0, Utils_1.serializeBN)(this.amount);
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
    getIdentifierHash() {
        return (0, crypto_1.createHash)("sha256").update(Buffer.from(this.secret, "hex")).digest().toString("hex");
    }
}
exports.FromBtcLnTrustedSwap = FromBtcLnTrustedSwap;
