"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isToBtcPluginQuote = exports.isPluginQuote = exports.isQuoteAmountTooHigh = exports.isQuoteAmountTooLow = exports.isQuoteSetFees = exports.isQuoteThrow = void 0;
const BN = require("bn.js");
function isQuoteThrow(obj) {
    return obj.type === "throw" && typeof (obj.message) === "string";
}
exports.isQuoteThrow = isQuoteThrow;
function isQuoteSetFees(obj) {
    return obj.type === "fees" &&
        (obj.baseFee == null || BN.isBN(obj.baseFee)) &&
        (obj.feePPM == null || BN.isBN(obj.feePPM));
}
exports.isQuoteSetFees = isQuoteSetFees;
function isQuoteAmountTooLow(obj) {
    return obj.type === "low" && typeof (obj.data) === "object" && BN.isBN(obj.data.min) && BN.isBN(obj.data.max);
}
exports.isQuoteAmountTooLow = isQuoteAmountTooLow;
function isQuoteAmountTooHigh(obj) {
    return obj.type === "high" && typeof (obj.data) === "object" && BN.isBN(obj.data.min) && BN.isBN(obj.data.max);
}
exports.isQuoteAmountTooHigh = isQuoteAmountTooHigh;
function isPluginQuote(obj) {
    return obj.type === "success" &&
        typeof (obj.amount) === "object" && typeof (obj.amount.input) === "boolean" && BN.isBN(obj.amount.amount) &&
        typeof (obj.swapFee) === "object" && BN.isBN(obj.swapFee.inInputTokens) && BN.isBN(obj.swapFee.inOutputTokens);
}
exports.isPluginQuote = isPluginQuote;
function isToBtcPluginQuote(obj) {
    return typeof (obj.networkFee) === "object" && BN.isBN(obj.networkFee.inInputTokens) && BN.isBN(obj.networkFee.inOutputTokens) &&
        isPluginQuote(obj);
}
exports.isToBtcPluginQuote = isToBtcPluginQuote;
