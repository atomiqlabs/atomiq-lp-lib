"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginManager = void 0;
const IPlugin_1 = require("./IPlugin");
const fs = require("fs");
const Utils_1 = require("../utils/Utils");
const SpvVault_1 = require("../swaps/spv_vault_swap/SpvVault");
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
    static async enable(chainsData, bitcoinRpc, bitcoinWallet, lightningWallet, swapPricing, tokens, directory) {
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
                await plugin.onEnable(chainsData, bitcoinRpc, bitcoinWallet, lightningWallet, swapPricing, tokens, directory + "/" + name);
            }
            catch (e) {
                pluginLogger.error(plugin, "enable(): plugin enable error", e);
            }
        }
    }
    static async disable() {
        for (let plugin of PluginManager.plugins.values()) {
            try {
                await plugin.onDisable();
            }
            catch (e) {
                pluginLogger.error(plugin, "disable(): plugin disable error", e);
            }
        }
    }
    static async serviceInitialize(handler) {
        for (let plugin of PluginManager.plugins.values()) {
            try {
                await plugin.onServiceInitialize(handler);
            }
            catch (e) {
                pluginLogger.error(plugin, "serviceInitialize(): plugin error", e);
            }
        }
    }
    static async onHttpServerStarted(httpServer) {
        for (let plugin of PluginManager.plugins.values()) {
            try {
                if (plugin.onHttpServerStarted != null)
                    await plugin.onHttpServerStarted(httpServer);
            }
            catch (e) {
                pluginLogger.error(plugin, "onHttpServerStarted(): plugin error", e);
            }
        }
    }
    static async swapStateChange(swap, oldState) {
        for (let plugin of PluginManager.plugins.values()) {
            try {
                if (plugin.onSwapStateChange != null)
                    await plugin.onSwapStateChange(swap);
            }
            catch (e) {
                pluginLogger.error(plugin, "swapStateChange(): plugin error", e);
            }
        }
    }
    static async swapCreate(swap) {
        for (let plugin of PluginManager.plugins.values()) {
            try {
                if (plugin.onSwapCreate != null)
                    await plugin.onSwapCreate(swap);
            }
            catch (e) {
                pluginLogger.error(plugin, "swapCreate(): plugin error", e);
            }
        }
    }
    static async swapRemove(swap) {
        for (let plugin of PluginManager.plugins.values()) {
            try {
                if (plugin.onSwapRemove != null)
                    await plugin.onSwapRemove(swap);
            }
            catch (e) {
                pluginLogger.error(plugin, "swapRemove(): plugin error", e);
            }
        }
    }
    static async onHandlePostFromBtcQuote(swapType, request, requestedAmount, chainIdentifier, constraints, fees, gasTokenAmount) {
        for (let plugin of PluginManager.plugins.values()) {
            try {
                if (plugin.onHandlePostFromBtcQuote != null) {
                    const result = await plugin.onHandlePostFromBtcQuote(swapType, request, requestedAmount, chainIdentifier, constraints, fees, gasTokenAmount);
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
    }
    static async onHandlePreFromBtcQuote(swapType, request, requestedAmount, chainIdentifier, constraints, fees, gasTokenAmount) {
        for (let plugin of PluginManager.plugins.values()) {
            try {
                if (plugin.onHandlePreFromBtcQuote != null) {
                    const result = await plugin.onHandlePreFromBtcQuote(swapType, request, requestedAmount, chainIdentifier, constraints, fees, gasTokenAmount);
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
    }
    static async onHandlePostToBtcQuote(swapType, request, requestedAmount, chainIdentifier, constraints, fees) {
        for (let plugin of PluginManager.plugins.values()) {
            try {
                if (plugin.onHandlePostToBtcQuote != null) {
                    let networkFeeData;
                    const result = await plugin.onHandlePostToBtcQuote(swapType, request, requestedAmount, chainIdentifier, constraints, {
                        baseFeeInBtc: fees.baseFeeInBtc,
                        feePPM: fees.feePPM,
                        networkFeeGetter: async (amount) => {
                            networkFeeData = await fees.networkFeeGetter(amount);
                            return networkFeeData.networkFee;
                        }
                    });
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
                            return {
                                ...result,
                                networkFeeData: networkFeeData
                            };
                        }
                    }
                }
            }
            catch (e) {
                pluginLogger.error(plugin, "onSwapRequestToBtcLn(): plugin error", e);
            }
        }
        return null;
    }
    static async onHandlePreToBtcQuote(swapType, request, requestedAmount, chainIdentifier, constraints, fees) {
        for (let plugin of PluginManager.plugins.values()) {
            try {
                if (plugin.onHandlePreToBtcQuote != null) {
                    const result = await plugin.onHandlePreToBtcQuote(swapType, request, requestedAmount, chainIdentifier, constraints, fees);
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
    }
    static async onVaultSelection(chainIdentifier, requestedAmount, gasAmount, candidates) {
        for (let plugin of PluginManager.plugins.values()) {
            try {
                if (plugin.onVaultSelection != null) {
                    const result = await plugin.onVaultSelection(chainIdentifier, requestedAmount, gasAmount, candidates);
                    if (result != null) {
                        if ((0, IPlugin_1.isQuoteThrow)(result))
                            return result;
                        if ((0, IPlugin_1.isQuoteAmountTooHigh)(result))
                            return result;
                        if ((0, IPlugin_1.isQuoteAmountTooLow)(result))
                            return result;
                        if (result instanceof SpvVault_1.SpvVault)
                            return result;
                    }
                }
            }
            catch (e) {
                pluginLogger.error(plugin, "onVaultSelection(): plugin error", e);
            }
        }
        return null;
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
