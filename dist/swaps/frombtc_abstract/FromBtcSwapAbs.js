"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcSwapAbs = exports.FromBtcSwapState = void 0;
const BN = require("bn.js");
const bitcoin = require("bitcoinjs-lib");
const crypto_1 = require("crypto");
const SwapHandler_1 = require("../SwapHandler");
const Utils_1 = require("../../utils/Utils");
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
    constructor(prOrObj, address, amount, swapFee, swapFeeInToken) {
        if (typeof (prOrObj) === "string") {
            super(prOrObj, swapFee, swapFeeInToken);
            this.state = FromBtcSwapState.CREATED;
            this.address = address;
            this.amount = amount;
        }
        else {
            super(prOrObj);
            this.address = prOrObj.address;
            this.amount = new BN(prOrObj.amount);
            this.authorizationExpiry = (0, Utils_1.deserializeBN)(prOrObj.authorizationExpiry);
            this.txId = prOrObj.txId;
        }
        this.type = SwapHandler_1.SwapHandlerType.FROM_BTC;
    }
    serialize() {
        const partialSerialized = super.serialize();
        partialSerialized.address = this.address;
        partialSerialized.amount = this.amount.toString(10);
        partialSerialized.authorizationExpiry = (0, Utils_1.serializeBN)(this.authorizationExpiry);
        partialSerialized.txId = this.txId;
        return partialSerialized;
    }
    getTxoHash(bitcoinNetwork) {
        const parsedOutputScript = bitcoin.address.toOutputScript(this.address, bitcoinNetwork);
        return (0, crypto_1.createHash)("sha256").update(Buffer.concat([
            Buffer.from(this.amount.toArray("le", 8)),
            parsedOutputScript
        ])).digest();
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
