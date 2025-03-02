"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isToBtcPluginQuote = exports.isPluginQuote = exports.isQuoteAmountTooHigh = exports.isQuoteAmountTooLow = exports.isQuoteSetFees = exports.isQuoteThrow = void 0;
function isQuoteThrow(obj) {
    return obj.type === "throw" && typeof (obj.message) === "string";
}
exports.isQuoteThrow = isQuoteThrow;
function isQuoteSetFees(obj) {
    return obj.type === "fees" &&
        (obj.baseFee == null || typeof (obj.baseFee) === "bigint") &&
        (obj.feePPM == null || typeof (obj.feePPM) === "bigint");
}
exports.isQuoteSetFees = isQuoteSetFees;
function isQuoteAmountTooLow(obj) {
    return obj.type === "low" && typeof (obj.data) === "object" && typeof (obj.data.min) === "bigint" && typeof (obj.data.max) === "bigint";
}
exports.isQuoteAmountTooLow = isQuoteAmountTooLow;
function isQuoteAmountTooHigh(obj) {
    return obj.type === "high" && typeof (obj.data) === "object" && typeof (obj.data.min) === "bigint" && typeof (obj.data.max) === "bigint";
}
exports.isQuoteAmountTooHigh = isQuoteAmountTooHigh;
function isPluginQuote(obj) {
    return obj.type === "success" &&
        typeof (obj.amount) === "object" && typeof (obj.amount.input) === "boolean" && typeof (obj.amount.amount) === "bigint" &&
        typeof (obj.swapFee) === "object" && typeof (obj.swapFee.inInputTokens) === "bigint" && typeof (obj.swapFee.inOutputTokens) === "bigint";
}
exports.isPluginQuote = isPluginQuote;
function isToBtcPluginQuote(obj) {
    return typeof (obj.networkFee) === "object" && typeof (obj.networkFee.inInputTokens) === "bigint" && typeof (obj.networkFee.inOutputTokens) === "bigint" &&
        isPluginQuote(obj);
}
exports.isToBtcPluginQuote = isToBtcPluginQuote;
