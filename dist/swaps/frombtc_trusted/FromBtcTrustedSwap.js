"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcTrustedSwap = exports.FromBtcTrustedSwapState = void 0;
const base_1 = require("@atomiqlabs/base");
const FromBtcBaseSwap_1 = require("../FromBtcBaseSwap");
const Utils_1 = require("../../utils/Utils");
const crypto_1 = require("crypto");
var FromBtcTrustedSwapState;
(function (FromBtcTrustedSwapState) {
    FromBtcTrustedSwapState[FromBtcTrustedSwapState["DOUBLE_SPENT"] = -4] = "DOUBLE_SPENT";
    FromBtcTrustedSwapState[FromBtcTrustedSwapState["REFUNDED"] = -3] = "REFUNDED";
    FromBtcTrustedSwapState[FromBtcTrustedSwapState["REFUNDABLE"] = -2] = "REFUNDABLE";
    FromBtcTrustedSwapState[FromBtcTrustedSwapState["EXPIRED"] = -1] = "EXPIRED";
    FromBtcTrustedSwapState[FromBtcTrustedSwapState["CREATED"] = 0] = "CREATED";
    FromBtcTrustedSwapState[FromBtcTrustedSwapState["RECEIVED"] = 1] = "RECEIVED";
    FromBtcTrustedSwapState[FromBtcTrustedSwapState["BTC_CONFIRMED"] = 2] = "BTC_CONFIRMED";
    FromBtcTrustedSwapState[FromBtcTrustedSwapState["SENT"] = 3] = "SENT";
    FromBtcTrustedSwapState[FromBtcTrustedSwapState["CONFIRMED"] = 4] = "CONFIRMED";
    FromBtcTrustedSwapState[FromBtcTrustedSwapState["FINISHED"] = 5] = "FINISHED";
})(FromBtcTrustedSwapState = exports.FromBtcTrustedSwapState || (exports.FromBtcTrustedSwapState = {}));
class FromBtcTrustedSwap extends FromBtcBaseSwap_1.FromBtcBaseSwap {
    constructor(objOrChainIdentifier, swapFee, swapFeeInToken, btcAddress, inputSats, dstAddress, outputTokens, createdHeight, expiresAt, recommendedFee, refundAddress, token) {
        if (typeof (objOrChainIdentifier) === "string") {
            super(objOrChainIdentifier, inputSats, swapFee, swapFeeInToken);
            this.state = FromBtcTrustedSwapState.CREATED;
            this.doubleSpent = false;
            this.sequence = base_1.BigIntBufferUtils.fromBuffer((0, crypto_1.randomBytes)(8));
            this.btcAddress = btcAddress;
            this.dstAddress = dstAddress;
            this.outputTokens = outputTokens;
            this.createdHeight = createdHeight;
            this.expiresAt = expiresAt;
            this.recommendedFee = recommendedFee;
            this.refundAddress = refundAddress;
            this.token = token;
        }
        else {
            super(objOrChainIdentifier);
            this.btcAddress = objOrChainIdentifier.btcAddress;
            this.sequence = (0, Utils_1.deserializeBN)(objOrChainIdentifier.sequence);
            this.dstAddress = objOrChainIdentifier.dstAddress;
            this.outputTokens = (0, Utils_1.deserializeBN)(objOrChainIdentifier.outputTokens);
            this.adjustedInput = (0, Utils_1.deserializeBN)(objOrChainIdentifier.adjustedInput);
            this.adjustedOutput = (0, Utils_1.deserializeBN)(objOrChainIdentifier.adjustedOutput);
            this.createdHeight = objOrChainIdentifier.createdHeight;
            this.expiresAt = objOrChainIdentifier.expiresAt;
            this.recommendedFee = objOrChainIdentifier.recommendedFee;
            this.refundAddress = objOrChainIdentifier.refundAddress;
            this.doubleSpent = objOrChainIdentifier.doubleSpent;
            this.scRawTx = objOrChainIdentifier.scRawTx;
            this.btcTx = objOrChainIdentifier.btcTx;
            this.txFee = objOrChainIdentifier.txFee;
            this.txSize = objOrChainIdentifier.txSize;
            this.txId = objOrChainIdentifier.txId;
            this.vout = objOrChainIdentifier.vout;
            this.burnTxId = objOrChainIdentifier.burnTxId;
            this.refundTxId = objOrChainIdentifier.refundTxId;
            this.token = objOrChainIdentifier.token;
        }
    }
    serialize() {
        const partialSerialized = super.serialize();
        partialSerialized.btcAddress = this.btcAddress;
        partialSerialized.sequence = (0, Utils_1.serializeBN)(this.sequence);
        partialSerialized.dstAddress = this.dstAddress;
        partialSerialized.outputTokens = (0, Utils_1.serializeBN)(this.outputTokens);
        partialSerialized.adjustedInput = (0, Utils_1.serializeBN)(this.adjustedInput);
        partialSerialized.adjustedOutput = (0, Utils_1.serializeBN)(this.adjustedOutput);
        partialSerialized.createdHeight = this.createdHeight;
        partialSerialized.expiresAt = this.expiresAt;
        partialSerialized.recommendedFee = this.recommendedFee;
        partialSerialized.refundAddress = this.refundAddress;
        partialSerialized.doubleSpent = this.doubleSpent;
        partialSerialized.scRawTx = this.scRawTx;
        partialSerialized.btcTx = this.btcTx;
        partialSerialized.txFee = this.txFee;
        partialSerialized.txSize = this.txSize;
        partialSerialized.txId = this.txId;
        partialSerialized.vout = this.vout;
        partialSerialized.burnTxId = this.burnTxId;
        partialSerialized.refundTxId = this.refundTxId;
        partialSerialized.token = this.token;
        return partialSerialized;
    }
    getClaimHash() {
        return (0, crypto_1.createHash)("sha256").update(this.btcAddress).digest().toString("hex");
    }
    getSequence() {
        return this.sequence;
    }
    getOutputAmount() {
        return this.adjustedOutput || this.outputTokens;
    }
    getTotalInputAmount() {
        return this.adjustedInput || this.amount;
    }
    isFailed() {
        return this.state === FromBtcTrustedSwapState.EXPIRED || this.state === FromBtcTrustedSwapState.REFUNDED || this.state === FromBtcTrustedSwapState.DOUBLE_SPENT;
    }
    isInitiated() {
        return this.state !== FromBtcTrustedSwapState.CREATED;
    }
    isSuccess() {
        return this.state === FromBtcTrustedSwapState.CONFIRMED;
    }
}
exports.FromBtcTrustedSwap = FromBtcTrustedSwap;
