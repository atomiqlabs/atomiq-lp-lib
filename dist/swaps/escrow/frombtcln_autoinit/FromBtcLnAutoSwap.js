"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcLnAutoSwap = exports.FromBtcLnAutoSwapState = void 0;
const index_1 = require("../../../index");
const FromBtcBaseSwap_1 = require("../FromBtcBaseSwap");
const Utils_1 = require("../../../utils/Utils");
var FromBtcLnAutoSwapState;
(function (FromBtcLnAutoSwapState) {
    FromBtcLnAutoSwapState[FromBtcLnAutoSwapState["REFUNDED"] = -2] = "REFUNDED";
    FromBtcLnAutoSwapState[FromBtcLnAutoSwapState["CANCELED"] = -1] = "CANCELED";
    FromBtcLnAutoSwapState[FromBtcLnAutoSwapState["CREATED"] = 0] = "CREATED";
    FromBtcLnAutoSwapState[FromBtcLnAutoSwapState["RECEIVED"] = 1] = "RECEIVED";
    FromBtcLnAutoSwapState[FromBtcLnAutoSwapState["TXS_SENT"] = 2] = "TXS_SENT";
    FromBtcLnAutoSwapState[FromBtcLnAutoSwapState["COMMITED"] = 3] = "COMMITED";
    FromBtcLnAutoSwapState[FromBtcLnAutoSwapState["CLAIMED"] = 4] = "CLAIMED";
    FromBtcLnAutoSwapState[FromBtcLnAutoSwapState["SETTLED"] = 5] = "SETTLED";
})(FromBtcLnAutoSwapState = exports.FromBtcLnAutoSwapState || (exports.FromBtcLnAutoSwapState = {}));
class FromBtcLnAutoSwap extends FromBtcBaseSwap_1.FromBtcBaseSwap {
    constructor(chainIdOrObj, pr, lnPaymentHash, claimHash, amountMtokens, claimer, token, gasToken, amountToken, amountGasToken, tokenSwapFee, tokenSwapFeeInToken, gasSwapFee, gasSwapFeeInToken, claimerBounty) {
        if (typeof (chainIdOrObj) === "string") {
            super(chainIdOrObj, (amountMtokens + 999n) / 1000n, tokenSwapFee + gasSwapFee, tokenSwapFeeInToken);
            this.state = FromBtcLnAutoSwapState.CREATED;
            this.pr = pr;
            this.lnPaymentHash = lnPaymentHash;
            this.claimHash = claimHash;
            this.claimer = claimer;
            this.token = token;
            this.gasToken = gasToken;
            this.amountToken = amountToken;
            this.amountGasToken = amountGasToken;
            this.tokenSwapFee = tokenSwapFee;
            this.tokenSwapFeeInToken = tokenSwapFeeInToken;
            this.gasSwapFee = gasSwapFee;
            this.gasSwapFeeInToken = gasSwapFeeInToken;
            this.claimerBounty = claimerBounty;
        }
        else {
            super(chainIdOrObj);
            this.pr = chainIdOrObj.pr;
            this.lnPaymentHash = chainIdOrObj.lnPaymentHash;
            this.claimHash = chainIdOrObj.claimHash;
            this.claimer = chainIdOrObj.claimer;
            this.token = chainIdOrObj.token;
            this.gasToken = chainIdOrObj.gasToken;
            this.amountToken = (0, Utils_1.deserializeBN)(chainIdOrObj.amountToken);
            this.amountGasToken = (0, Utils_1.deserializeBN)(chainIdOrObj.amountGasToken);
            this.tokenSwapFee = (0, Utils_1.deserializeBN)(chainIdOrObj.tokenSwapFee);
            this.tokenSwapFeeInToken = (0, Utils_1.deserializeBN)(chainIdOrObj.tokenSwapFeeInToken);
            this.gasSwapFee = (0, Utils_1.deserializeBN)(chainIdOrObj.gasSwapFee);
            this.gasSwapFeeInToken = (0, Utils_1.deserializeBN)(chainIdOrObj.gasSwapFeeInToken);
            this.claimerBounty = (0, Utils_1.deserializeBN)(chainIdOrObj.claimerBounty);
            this.secret = chainIdOrObj.secret;
        }
        this.type = index_1.SwapHandlerType.FROM_BTCLN;
    }
    serialize() {
        const partialSerialized = super.serialize();
        partialSerialized.pr = this.pr;
        partialSerialized.secret = this.secret;
        partialSerialized.lnPaymentHash = this.lnPaymentHash;
        partialSerialized.claimHash = this.claimHash;
        partialSerialized.claimer = this.claimer;
        partialSerialized.token = this.token;
        partialSerialized.gasToken = this.gasToken;
        partialSerialized.amountToken = (0, Utils_1.serializeBN)(this.amountToken);
        partialSerialized.amountGasToken = (0, Utils_1.serializeBN)(this.amountGasToken);
        partialSerialized.tokenSwapFee = (0, Utils_1.serializeBN)(this.tokenSwapFee);
        partialSerialized.tokenSwapFeeInToken = (0, Utils_1.serializeBN)(this.tokenSwapFeeInToken);
        partialSerialized.gasSwapFee = (0, Utils_1.serializeBN)(this.gasSwapFee);
        partialSerialized.gasSwapFeeInToken = (0, Utils_1.serializeBN)(this.gasSwapFeeInToken);
        partialSerialized.claimerBounty = (0, Utils_1.serializeBN)(this.claimerBounty);
        return partialSerialized;
    }
    getIdentifierHash() {
        return this.lnPaymentHash;
    }
    getOutputGasAmount() {
        return this.amountGasToken;
    }
    getOutputAmount() {
        return this.amountToken;
    }
    getTotalOutputAmount() {
        return this.amountToken;
    }
    getTotalOutputGasAmount() {
        return this.amountGasToken + this.claimerBounty;
    }
    getSequence() {
        return 0n;
    }
    getSwapFee() {
        return { inInputToken: this.swapFee, inOutputToken: this.swapFeeInToken };
    }
    getTokenSwapFee() {
        return { inInputToken: this.tokenSwapFee, inOutputToken: this.tokenSwapFeeInToken };
    }
    getGasSwapFee() {
        return { inInputToken: this.gasSwapFee, inOutputToken: this.gasSwapFeeInToken };
    }
    getToken() {
        return this.token;
    }
    getGasToken() {
        return this.gasToken;
    }
    isInitiated() {
        return this.state !== FromBtcLnAutoSwapState.CREATED;
    }
    isFailed() {
        return this.state === FromBtcLnAutoSwapState.CANCELED || this.state === FromBtcLnAutoSwapState.REFUNDED;
    }
    isSuccess() {
        return this.state === FromBtcLnAutoSwapState.SETTLED;
    }
}
exports.FromBtcLnAutoSwap = FromBtcLnAutoSwap;
