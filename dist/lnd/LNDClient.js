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
exports.LNDClient = void 0;
const lightning_1 = require("lightning");
const fs_1 = require("fs");
const bip39 = require("bip39");
const aezeed_1 = require("aezeed");
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
class LNDClient {
    constructor(config) {
        this.status = "offline";
        if (config.CERT == null && config.CERT_FILE == null)
            throw new Error("Certificate for LND not provided, provide either CERT or CERT_FILE config!");
        if (config.MACAROON == null && config.MACAROON_FILE == null)
            throw new Error("Macaroon for LND not provided, provide either MACAROON or MACAROON_FILE config!");
        this.config = config;
    }
    getStatusInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.lnd == null)
                return {};
            const resp = yield (0, lightning_1.getWalletInfo)({ lnd: this.lnd });
            return {
                "Synced to chain": "" + resp.is_synced_to_chain,
                "Blockheight": resp.current_block_height.toString()
            };
        });
    }
    getUnauthenticatedLndGrpc() {
        let cert = this.config.CERT;
        if (this.config.CERT_FILE != null) {
            if (!fs_1.default.existsSync(this.config.CERT_FILE))
                throw new Error("Certificate file not found!");
            cert = fs_1.default.readFileSync(this.config.CERT_FILE).toString("base64");
        }
        const { lnd } = (0, lightning_1.unauthenticatedLndGrpc)({
            cert,
            socket: this.config.HOST + ':' + this.config.PORT,
        });
        return lnd;
    }
    ;
    getAuthenticatedLndGrpc() {
        let cert = this.config.CERT;
        if (this.config.CERT_FILE != null) {
            if (!fs_1.default.existsSync(this.config.CERT_FILE))
                throw new Error("Certificate file not found!");
            cert = fs_1.default.readFileSync(this.config.CERT_FILE).toString("base64");
        }
        let macaroon = this.config.MACAROON;
        if (this.config.MACAROON_FILE != null) {
            if (!fs_1.default.existsSync(this.config.MACAROON_FILE))
                throw new Error("Macaroon file not found!");
            macaroon = fs_1.default.readFileSync(this.config.MACAROON_FILE).toString("base64");
        }
        const { lnd } = (0, lightning_1.authenticatedLndGrpc)({
            cert,
            macaroon,
            socket: this.config.HOST + ':' + this.config.PORT,
        });
        return lnd;
    }
    /**
     * LND uses AEZEED mnemonic file, we need to convert the usual bip39 mnemonic into AEZEED
     * @private
     * @returns {string} Filename of the converted AEZEED mnemonic file
     */
    tryConvertMnemonic() {
        if (this.config.MNEMONIC_FILE != null) {
            const mnemonic = fs_1.default.readFileSync(this.config.MNEMONIC_FILE).toString();
            let entropy;
            try {
                entropy = Buffer.from(bip39.mnemonicToEntropy(mnemonic), "hex");
            }
            catch (e) {
                throw new Error("Error parsing mnemonic phrase!");
            }
            const aezeedMnemonicFile = this.config.MNEMONIC_FILE + ".lnd";
            if (!fs_1.default.existsSync(aezeedMnemonicFile)) {
                const cipherSeed = new aezeed_1.CipherSeed(entropy, (0, crypto_1.randomBytes)(5));
                fs_1.default.writeFileSync(aezeedMnemonicFile, cipherSeed.toMnemonic());
            }
            return aezeedMnemonicFile;
        }
        return null;
    }
    getLNDWalletStatus(lnd) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const walletStatus = yield (0, lightning_1.getWalletStatus)({ lnd });
                if (walletStatus.is_absent)
                    return "absent";
                if (walletStatus.is_active)
                    return "active";
                if (walletStatus.is_locked)
                    return "locked";
                if (walletStatus.is_ready)
                    return "ready";
                if (walletStatus.is_starting)
                    return "starting";
                if (walletStatus.is_waiting)
                    return "waiting";
            }
            catch (e) {
                console.error(e);
                return "offline";
            }
        });
    }
    createLNDWallet(lnd, mnemonic, password) {
        return new Promise((resolve, reject) => {
            lnd.unlocker.initWallet({
                aezeed_passphrase: undefined,
                cipher_seed_mnemonic: mnemonic.split(' '),
                wallet_password: Buffer.from(password, "utf8"),
                recovery_window: 1000
            }, (err, res) => {
                if (!!err) {
                    reject([503, 'UnexpectedInitWalletError', { err }]);
                    return;
                }
                if (!res) {
                    reject([503, 'ExpectedResponseForInitWallet']);
                    return;
                }
                if (!Buffer.isBuffer(res.admin_macaroon)) {
                    reject([503, 'ExpectedAdminMacaroonToCrateWallet']);
                    return;
                }
                resolve({
                    macaroon: res.admin_macaroon.toString("base64")
                });
            });
        });
    }
    loadPassword() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.config.WALLET_PASSWORD_FILE == null) {
                throw new Error("Error initializing LND, no wallet password provided!");
            }
            let password;
            try {
                const resultPass = yield promises_1.default.readFile(this.config.WALLET_PASSWORD_FILE);
                password = resultPass.toString();
            }
            catch (e) {
                console.error(e);
            }
            if (password == null) {
                throw new Error("Invalid LND wallet password file provided!");
            }
            return password;
        });
    }
    loadMnemonic() {
        return __awaiter(this, void 0, void 0, function* () {
            const mnemonicFile = this.tryConvertMnemonic();
            if (mnemonicFile == null) {
                throw new Error("Error initializing LND, no mnemonic provided!");
            }
            let mnemonic;
            try {
                const resultMnemonic = yield promises_1.default.readFile(mnemonicFile);
                mnemonic = resultMnemonic.toString();
            }
            catch (e) {
                console.error(e);
            }
            if (mnemonic == null) {
                throw new Error("Invalid LND mnemonic file provided!");
            }
            return mnemonic;
        });
    }
    unlockWallet(lnd) {
        return __awaiter(this, void 0, void 0, function* () {
            yield (0, lightning_1.unlockWallet)({
                lnd,
                password: yield this.loadPassword()
            });
        });
    }
    createWallet(lnd) {
        return __awaiter(this, void 0, void 0, function* () {
            const mnemonic = yield this.loadMnemonic();
            const password = yield this.loadPassword();
            yield this.createLNDWallet(lnd, mnemonic, password);
        });
    }
    tryConnect() {
        return __awaiter(this, void 0, void 0, function* () {
            let lnd;
            try {
                lnd = this.getUnauthenticatedLndGrpc();
            }
            catch (e) {
                console.error("LNDClient: tryConnect(): Error: ", e);
                return false;
            }
            const walletStatus = yield this.getLNDWalletStatus(lnd);
            if (walletStatus === "active" || walletStatus === "ready") {
                this.status = "syncing";
                return true;
            }
            this.status = walletStatus;
            if (walletStatus === "waiting" || walletStatus === "starting" || walletStatus === "offline")
                return false;
            if (walletStatus === "absent") {
                //New wallet has to be created based on the provided mnemonic file
                yield this.createWallet(lnd);
                return false;
            }
            if (walletStatus === "locked") {
                //Wallet has to be unlocked
                yield this.unlockWallet(lnd);
                return false;
            }
        });
    }
    isLNDSynced() {
        return __awaiter(this, void 0, void 0, function* () {
            const resp = yield (0, lightning_1.getWalletInfo)({
                lnd: this.lnd
            });
            console.log("LNDClient: isLNDSynced(): LND blockheight: " + resp.current_block_height + " is_synced: " + resp.is_synced_to_chain);
            return resp.is_synced_to_chain;
        });
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            let lndReady = false;
            console.log("LNDClient: init(): Waiting for LND node connection...");
            while (!lndReady) {
                lndReady = yield this.tryConnect();
                if (!lndReady)
                    yield new Promise(resolve => setTimeout(resolve, 30 * 1000));
            }
            this.lnd = this.getAuthenticatedLndGrpc();
            lndReady = false;
            console.log("LNDClient: init(): Waiting for LND node synchronization...");
            while (!lndReady) {
                lndReady = yield this.isLNDSynced();
                if (!lndReady)
                    yield new Promise(resolve => setTimeout(resolve, 30 * 1000));
            }
            this.status = "ready";
        });
    }
}
exports.LNDClient = LNDClient;
