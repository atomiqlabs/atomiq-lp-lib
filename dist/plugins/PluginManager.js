"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginManager = void 0;
const IPlugin_1 = require("./IPlugin");
const fs = require("fs");
const Utils_1 = require("../utils/Utils");
const logger = (0, Utils_1.getLogger)("PluginManager: ");
const pluginLogger = {
    debug: (plugin, msg, ...args) => logger.debug(plugin.name + ": " + msg, ...args),
    info: (plugin, msg, ...args) => logger.info(plugin.name + ": " + msg, ...args),
    warn: (plugin, msg, ...args) => logger.warn(plugin.name + ": " + msg, ...args),
    error: (plugin, msg, ...args) => logger.error(plugin.name + ": " + msg, ...args)
};
class PluginManager {
    static registerPlugin(name, plugin) {
        PluginManager.plugins.set(name, plugin);
    }
    static unregisterPlugin(name) {
        return PluginManager.plugins.delete(name);
    }
    static enable(chainsData, bitcoinRpc, bitcoinWallet, lightningWallet, swapPricing, tokens, directory) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                fs.mkdirSync(directory);
            }
            catch (e) { }
            for (let [name, plugin] of PluginManager.plugins.entries()) {
                try {
                    try {
                        fs.mkdirSync(directory + "/" + name);
                    }
                    catch (e) { }
                    yield plugin.onEnable(chainsData, bitcoinRpc, bitcoinWallet, lightningWallet, swapPricing, tokens, directory + "/" + name);
                }
                catch (e) {
                    pluginLogger.error(plugin, "enable(): plugin enable error", e);
                }
            }
        });
    }
    static disable() {
        return __awaiter(this, void 0, void 0, function* () {
            for (let plugin of PluginManager.plugins.values()) {
                try {
                    yield plugin.onDisable();
                }
                catch (e) {
                    pluginLogger.error(plugin, "disable(): plugin disable error", e);
                }
            }
        });
    }
    static serviceInitialize(handler) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let plugin of PluginManager.plugins.values()) {
                try {
                    yield plugin.onServiceInitialize(handler);
                }
                catch (e) {
                    pluginLogger.error(plugin, "serviceInitialize(): plugin error", e);
                }
            }
        });
    }
    static onHttpServerStarted(httpServer) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let plugin of PluginManager.plugins.values()) {
                try {
                    if (plugin.onHttpServerStarted != null)
                        yield plugin.onHttpServerStarted(httpServer);
                }
                catch (e) {
                    pluginLogger.error(plugin, "onHttpServerStarted(): plugin error", e);
                }
            }
        });
    }
    static swapStateChange(swap, oldState) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let plugin of PluginManager.plugins.values()) {
                try {
                    if (plugin.onSwapStateChange != null)
                        yield plugin.onSwapStateChange(swap);
                }
                catch (e) {
                    pluginLogger.error(plugin, "swapStateChange(): plugin error", e);
                }
            }
        });
    }
    static swapCreate(swap) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let plugin of PluginManager.plugins.values()) {
                try {
                    if (plugin.onSwapCreate != null)
                        yield plugin.onSwapCreate(swap);
                }
                catch (e) {
                    pluginLogger.error(plugin, "swapCreate(): plugin error", e);
                }
            }
        });
    }
    static swapRemove(swap) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let plugin of PluginManager.plugins.values()) {
                try {
                    if (plugin.onSwapRemove != null)
                        yield plugin.onSwapRemove(swap);
                }
                catch (e) {
                    pluginLogger.error(plugin, "swapRemove(): plugin error", e);
                }
            }
        });
    }
    static onHandlePostFromBtcQuote(request, requestedAmount, chainIdentifier, token, constraints, fees, pricePrefetchPromise) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let plugin of PluginManager.plugins.values()) {
                try {
                    if (plugin.onHandlePostFromBtcQuote != null) {
                        const result = yield plugin.onHandlePostFromBtcQuote(request, requestedAmount, chainIdentifier, token, constraints, fees, pricePrefetchPromise);
                        if (result != null) {
                            if ((0, IPlugin_1.isQuoteSetFees)(result))
                                return result;
                            if ((0, IPlugin_1.isQuoteThrow)(result))
                                return result;
                            if ((0, IPlugin_1.isQuoteAmountTooHigh)(result))
                                return result;
                            if ((0, IPlugin_1.isQuoteAmountTooLow)(result))
                                return result;
                            if ((0, IPlugin_1.isPluginQuote)(result)) {
                                if (result.amount.input === requestedAmount.input)
                                    throw new Error("Invalid quoting response returned, when input is set, output must be returned, and vice-versa!");
                                return result;
                            }
                        }
                    }
                }
                catch (e) {
                    pluginLogger.error(plugin, "onSwapRequestToBtcLn(): plugin error", e);
                }
            }
            return null;
        });
    }
    static onHandlePreFromBtcQuote(request, requestedAmount, chainIdentifier, token, constraints, fees) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let plugin of PluginManager.plugins.values()) {
                try {
                    if (plugin.onHandlePreFromBtcQuote != null) {
                        const result = yield plugin.onHandlePreFromBtcQuote(request, requestedAmount, chainIdentifier, token, constraints, fees);
                        if (result != null) {
                            if ((0, IPlugin_1.isQuoteSetFees)(result))
                                return result;
                            if ((0, IPlugin_1.isQuoteThrow)(result))
                                return result;
                            if ((0, IPlugin_1.isQuoteAmountTooHigh)(result))
                                return result;
                            if ((0, IPlugin_1.isQuoteAmountTooLow)(result))
                                return result;
                        }
                    }
                }
                catch (e) {
                    pluginLogger.error(plugin, "onSwapRequestToBtcLn(): plugin error", e);
                }
            }
            return null;
        });
    }
    static onHandlePostToBtcQuote(request, requestedAmount, chainIdentifier, token, constraints, fees, pricePrefetchPromise) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let plugin of PluginManager.plugins.values()) {
                try {
                    if (plugin.onHandlePostToBtcQuote != null) {
                        let networkFeeData;
                        const result = yield plugin.onHandlePostToBtcQuote(request, requestedAmount, chainIdentifier, token, constraints, {
                            baseFeeInBtc: fees.baseFeeInBtc,
                            feePPM: fees.feePPM,
                            networkFeeGetter: (amount) => __awaiter(this, void 0, void 0, function* () {
                                networkFeeData = yield fees.networkFeeGetter(amount);
                                return networkFeeData.networkFee;
                            })
                        }, pricePrefetchPromise);
                        if (result != null) {
                            if ((0, IPlugin_1.isQuoteSetFees)(result))
                                return result;
                            if ((0, IPlugin_1.isQuoteThrow)(result))
                                return result;
                            if ((0, IPlugin_1.isQuoteAmountTooHigh)(result))
                                return result;
                            if ((0, IPlugin_1.isQuoteAmountTooLow)(result))
                                return result;
                            if ((0, IPlugin_1.isToBtcPluginQuote)(result)) {
                                if (result.amount.input === requestedAmount.input)
                                    throw new Error("Invalid quoting response returned, when input is set, output must be returned, and vice-versa!");
                                return Object.assign(Object.assign({}, result), { networkFeeData: networkFeeData });
                            }
                        }
                    }
                }
                catch (e) {
                    pluginLogger.error(plugin, "onSwapRequestToBtcLn(): plugin error", e);
                }
            }
            return null;
        });
    }
    static onHandlePreToBtcQuote(request, requestedAmount, chainIdentifier, token, constraints, fees) {
        return __awaiter(this, void 0, void 0, function* () {
            for (let plugin of PluginManager.plugins.values()) {
                try {
                    if (plugin.onHandlePreToBtcQuote != null) {
                        const result = yield plugin.onHandlePreToBtcQuote(request, requestedAmount, chainIdentifier, token, constraints, fees);
                        if (result != null) {
                            if ((0, IPlugin_1.isQuoteSetFees)(result))
                                return result;
                            if ((0, IPlugin_1.isQuoteThrow)(result))
                                return result;
                            if ((0, IPlugin_1.isQuoteAmountTooHigh)(result))
                                return result;
                            if ((0, IPlugin_1.isQuoteAmountTooLow)(result))
                                return result;
                        }
                    }
                }
                catch (e) {
                    pluginLogger.error(plugin, "onSwapRequestToBtcLn(): plugin error", e);
                }
            }
            return null;
        });
    }
    static getWhitelistedTxIds() {
        const whitelist = new Set();
        for (let plugin of PluginManager.plugins.values()) {
            try {
                if (plugin.getWhitelistedTxIds != null) {
                    const result = plugin.getWhitelistedTxIds();
                    if (result != null) {
                        result.forEach(e => whitelist.add(e));
                    }
                }
            }
            catch (e) {
                pluginLogger.error(plugin, "getWhitelistedTxIds(): plugin error", e);
            }
        }
        return whitelist;
    }
}
exports.PluginManager = PluginManager;
PluginManager.plugins = new Map();
