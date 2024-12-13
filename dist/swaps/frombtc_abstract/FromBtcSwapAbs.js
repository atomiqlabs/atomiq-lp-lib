"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcSwapAbs = exports.FromBtcSwapState = void 0;
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
            super(prOrObj, amount, swapFee, swapFeeInToken);
            this.state = FromBtcSwapState.CREATED;
            this.address = address;
        }
        else {
            super(prOrObj);
            this.address = prOrObj.address;
            this.authorizationExpiry = (0, Utils_1.deserializeBN)(prOrObj.authorizationExpiry);
            this.txId = prOrObj.txId;
        }
        this.type = SwapHandler_1.SwapHandlerType.FROM_BTC;
    }
    serialize() {
        const partialSerialized = super.serialize();
        partialSerialized.address = this.address;
        partialSerialized.authorizationExpiry = (0, Utils_1.serializeBN)(this.authorizationExpiry);
        partialSerialized.txId = this.txId;
        return partialSerialized;
    }
    getTxoHash() {
        return Buffer.from(this.data.getTxoHash(), "hex");
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
