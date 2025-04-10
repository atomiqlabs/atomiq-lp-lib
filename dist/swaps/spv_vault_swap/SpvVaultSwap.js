"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpvVaultSwap = exports.SpvVaultSwapState = void 0;
const SwapHandlerSwap_1 = require("../SwapHandlerSwap");
const Utils_1 = require("../../utils/Utils");
const SwapHandler_1 = require("../SwapHandler");
var SpvVaultSwapState;
(function (SpvVaultSwapState) {
    SpvVaultSwapState[SpvVaultSwapState["FAILED"] = -3] = "FAILED";
    SpvVaultSwapState[SpvVaultSwapState["DOUBLE_SPENT"] = -2] = "DOUBLE_SPENT";
    SpvVaultSwapState[SpvVaultSwapState["EXPIRED"] = -1] = "EXPIRED";
    SpvVaultSwapState[SpvVaultSwapState["CREATED"] = 0] = "CREATED";
    SpvVaultSwapState[SpvVaultSwapState["SIGNED"] = 1] = "SIGNED";
    SpvVaultSwapState[SpvVaultSwapState["SENT"] = 2] = "SENT";
    SpvVaultSwapState[SpvVaultSwapState["BTC_CONFIRMED"] = 3] = "BTC_CONFIRMED";
    SpvVaultSwapState[SpvVaultSwapState["CLAIMED"] = 4] = "CLAIMED";
})(SpvVaultSwapState = exports.SpvVaultSwapState || (exports.SpvVaultSwapState = {}));
class SpvVaultSwap extends SwapHandlerSwap_1.SwapHandlerSwap {
    constructor(chainIdentifierOrObj, quoteId, expiry, vault, vaultUtxo, btcAddress, btcFeeRate, recipient, amountBtc, amountToken, amountGasToken, swapFee, swapFeeInToken, gasSwapFee, gasSwapFeeInToken, callerFeeShare, frontingFeeShare, executionFeeShare, token, gasToken) {
        if (typeof (chainIdentifierOrObj) === "string") {
            super(chainIdentifierOrObj, swapFee + gasSwapFee, swapFeeInToken * (swapFee + gasSwapFee) / swapFee);
            this.state = SpvVaultSwapState.CREATED;
            this.quoteId = quoteId;
            this.expiry = expiry;
            this.vaultOwner = vault.data.getOwner();
            this.vaultId = vault.data.getVaultId();
            this.vaultAddress = vault.btcAddress;
            this.vaultUtxo = vaultUtxo;
            this.tokenSwapFee = swapFee;
            this.tokenSwapFeeInToken = swapFeeInToken;
            this.gasSwapFee = gasSwapFee;
            this.gasSwapFeeInToken = gasSwapFeeInToken;
            this.btcFeeRate = btcFeeRate;
            this.btcAddress = btcAddress;
            this.recipient = recipient;
            this.amountBtc = amountBtc;
            this.amountToken = amountToken;
            this.amountGasToken = amountGasToken;
            const [rawAmountToken, rawAmountGasToken] = vault.toRawAmounts([amountToken, amountGasToken]);
            this.rawAmountToken = rawAmountToken;
            this.rawAmountGasToken = rawAmountGasToken;
            this.callerFeeShare = callerFeeShare;
            this.frontingFeeShare = frontingFeeShare;
            this.executionFeeShare = executionFeeShare;
            this.token = token;
            this.gasToken = gasToken;
        }
        else {
            super(chainIdentifierOrObj);
            this.quoteId = chainIdentifierOrObj.quoteId;
            this.expiry = chainIdentifierOrObj.expiry;
            this.vaultOwner = chainIdentifierOrObj.owner;
            this.vaultId = (0, Utils_1.deserializeBN)(chainIdentifierOrObj.vaultId);
            this.vaultAddress = chainIdentifierOrObj.vaultAddress;
            this.vaultUtxo = chainIdentifierOrObj.vaultUtxo;
            this.tokenSwapFee = (0, Utils_1.deserializeBN)(chainIdentifierOrObj.swapFee);
            this.tokenSwapFeeInToken = (0, Utils_1.deserializeBN)(chainIdentifierOrObj.swapFeeInToken);
            this.gasSwapFee = (0, Utils_1.deserializeBN)(chainIdentifierOrObj.gasSwapFee);
            this.gasSwapFeeInToken = (0, Utils_1.deserializeBN)(chainIdentifierOrObj.gasSwapFeeInToken);
            this.btcFeeRate = chainIdentifierOrObj.btcFeeRate;
            this.btcAddress = chainIdentifierOrObj.btcAddress;
            this.recipient = chainIdentifierOrObj.recipient;
            this.amountBtc = (0, Utils_1.deserializeBN)(chainIdentifierOrObj.amountBtc);
            this.amountToken = (0, Utils_1.deserializeBN)(chainIdentifierOrObj.amountToken);
            this.amountGasToken = (0, Utils_1.deserializeBN)(chainIdentifierOrObj.amountGasToken);
            this.rawAmountToken = (0, Utils_1.deserializeBN)(chainIdentifierOrObj.rawAmountToken);
            this.rawAmountGasToken = (0, Utils_1.deserializeBN)(chainIdentifierOrObj.rawAmountGasToken);
            this.callerFeeShare = (0, Utils_1.deserializeBN)(chainIdentifierOrObj.callerFeeShare);
            this.frontingFeeShare = (0, Utils_1.deserializeBN)(chainIdentifierOrObj.frontingFeeShare);
            this.executionFeeShare = (0, Utils_1.deserializeBN)(chainIdentifierOrObj.executionFeeShare);
            this.token = chainIdentifierOrObj.token;
            this.gasToken = chainIdentifierOrObj.gasToken;
            this.btcTxId = chainIdentifierOrObj.btcTxId;
        }
        this.type = SwapHandler_1.SwapHandlerType.FROM_BTC_SPV;
    }
    serialize() {
        return {
            ...super.serialize(),
            quoteId: this.quoteId,
            owner: this.vaultOwner,
            vaultId: (0, Utils_1.serializeBN)(this.vaultId),
            vaultAddress: this.vaultAddress,
            vaultUtxo: this.vaultUtxo,
            tokenSwapFee: (0, Utils_1.serializeBN)(this.tokenSwapFee),
            tokenSwapFeeInToken: (0, Utils_1.serializeBN)(this.tokenSwapFeeInToken),
            gasSwapFee: (0, Utils_1.serializeBN)(this.gasSwapFee),
            gasSwapFeeInToken: (0, Utils_1.serializeBN)(this.gasSwapFeeInToken),
            btcFeeRate: this.btcFeeRate,
            btcAddress: this.btcAddress,
            recipient: this.recipient,
            amountBtc: (0, Utils_1.serializeBN)(this.amountBtc),
            amountToken: (0, Utils_1.serializeBN)(this.amountToken),
            amountGasToken: (0, Utils_1.serializeBN)(this.amountGasToken),
            rawAmountToken: (0, Utils_1.serializeBN)(this.rawAmountToken),
            rawAmountGasToken: (0, Utils_1.serializeBN)(this.rawAmountGasToken),
            callerFeeShare: (0, Utils_1.serializeBN)(this.callerFeeShare),
            frontingFeeShare: (0, Utils_1.serializeBN)(this.frontingFeeShare),
            executionFeeShare: (0, Utils_1.serializeBN)(this.executionFeeShare),
            token: this.token,
            gasToken: this.gasToken,
            btcTxId: this.btcTxId
        };
    }
    getIdentifierHash() {
        return this.quoteId;
    }
    getOutputGasAmount() {
        return this.amountGasToken;
    }
    getOutputAmount() {
        return this.amountToken;
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
    getTotalInputAmount() {
        return this.amountBtc;
    }
    isFailed() {
        return this.state === SpvVaultSwapState.FAILED || this.state === SpvVaultSwapState.DOUBLE_SPENT;
    }
    isInitiated() {
        return this.state !== SpvVaultSwapState.CREATED;
    }
    isSuccess() {
        return this.state === SpvVaultSwapState.CLAIMED;
    }
}
exports.SpvVaultSwap = SpvVaultSwap;
