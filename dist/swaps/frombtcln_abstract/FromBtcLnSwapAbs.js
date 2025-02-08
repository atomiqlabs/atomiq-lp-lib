"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcLnSwapAbs = exports.FromBtcLnSwapState = void 0;
const BN = require("bn.js");
const __1 = require("../..");
const FromBtcBaseSwap_1 = require("../FromBtcBaseSwap");
const Utils_1 = require("../../utils/Utils");
var FromBtcLnSwapState;
(function (FromBtcLnSwapState) {
    FromBtcLnSwapState[FromBtcLnSwapState["REFUNDED"] = -2] = "REFUNDED";
    FromBtcLnSwapState[FromBtcLnSwapState["CANCELED"] = -1] = "CANCELED";
    FromBtcLnSwapState[FromBtcLnSwapState["CREATED"] = 0] = "CREATED";
    FromBtcLnSwapState[FromBtcLnSwapState["RECEIVED"] = 1] = "RECEIVED";
    FromBtcLnSwapState[FromBtcLnSwapState["COMMITED"] = 2] = "COMMITED";
    FromBtcLnSwapState[FromBtcLnSwapState["CLAIMED"] = 3] = "CLAIMED";
    FromBtcLnSwapState[FromBtcLnSwapState["SETTLED"] = 4] = "SETTLED";
})(FromBtcLnSwapState = exports.FromBtcLnSwapState || (exports.FromBtcLnSwapState = {}));
class FromBtcLnSwapAbs extends FromBtcBaseSwap_1.FromBtcBaseSwap {
    constructor(chainIdOrObj, pr, lnPaymentHash, amountMtokens, swapFee, swapFeeInToken, claimer, token, totalTokens, claimHash, securityDeposit) {
        if (typeof (chainIdOrObj) === "string") {
            super(chainIdOrObj, amountMtokens.add(new BN(999)).div(new BN(1000)), swapFee, swapFeeInToken);
            this.state = FromBtcLnSwapState.CREATED;
            this.pr = pr;
            this.lnPaymentHash = lnPaymentHash;
            this.claimer = claimer;
            this.token = token;
            this.totalTokens = totalTokens;
            this.claimHash = claimHash;
            this.securityDeposit = securityDeposit;
        }
        else {
            super(chainIdOrObj);
            this.pr = chainIdOrObj.pr;
            this.lnPaymentHash = chainIdOrObj.lnPaymentHash;
            this.claimer = chainIdOrObj.claimer;
            this.token = chainIdOrObj.token;
            this.totalTokens = (0, Utils_1.deserializeBN)(chainIdOrObj.totalTokens);
            this.claimHash = chainIdOrObj.claimHash;
            this.securityDeposit = (0, Utils_1.deserializeBN)(chainIdOrObj.securityDeposit);
            this.secret = chainIdOrObj.secret;
            //Compatibility
            if (this.state === FromBtcLnSwapState.CREATED && this.data != null) {
                this.claimer = this.data.getClaimer();
                this.token = this.data.getToken();
                this.totalTokens = this.data.getAmount();
                this.claimHash = this.data.getClaimHash();
                this.securityDeposit = this.data.getSecurityDeposit();
            }
        }
        this.type = __1.SwapHandlerType.FROM_BTCLN;
    }
    serialize() {
        const partialSerialized = super.serialize();
        partialSerialized.pr = this.pr;
        partialSerialized.secret = this.secret;
        partialSerialized.lnPaymentHash = this.lnPaymentHash;
        partialSerialized.claimer = this.claimer;
        partialSerialized.token = this.token;
        partialSerialized.totalTokens = (0, Utils_1.serializeBN)(this.totalTokens);
        partialSerialized.claimHash = this.claimHash;
        partialSerialized.securityDeposit = (0, Utils_1.serializeBN)(this.securityDeposit);
        return partialSerialized;
    }
    getIdentifierHash() {
        return this.lnPaymentHash;
    }
    getSequence() {
        return new BN(0);
    }
    isInitiated() {
        return this.state !== FromBtcLnSwapState.CREATED;
    }
    isFailed() {
        return this.state === FromBtcLnSwapState.CANCELED || this.state === FromBtcLnSwapState.REFUNDED;
    }
    isSuccess() {
        return this.state === FromBtcLnSwapState.SETTLED;
    }
}
exports.FromBtcLnSwapAbs = FromBtcLnSwapAbs;
