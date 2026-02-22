"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpvVault = exports.SpvVaultState = void 0;
const base_1 = require("@atomiqlabs/base");
var SpvVaultState;
(function (SpvVaultState) {
    SpvVaultState[SpvVaultState["CLOSED"] = -1] = "CLOSED";
    SpvVaultState[SpvVaultState["BTC_INITIATED"] = 0] = "BTC_INITIATED";
    SpvVaultState[SpvVaultState["BTC_CONFIRMED"] = 1] = "BTC_CONFIRMED";
    SpvVaultState[SpvVaultState["OPENED"] = 2] = "OPENED";
})(SpvVaultState = exports.SpvVaultState || (exports.SpvVaultState = {}));
class SpvVault extends base_1.Lockable {
    constructor(chainIdOrObj, vault, btcAddress) {
        super();
        if (typeof (chainIdOrObj) === "string") {
            this.state = SpvVaultState.BTC_INITIATED;
            this.chainId = chainIdOrObj;
            this.data = vault;
            this.initialUtxo = vault.getUtxo();
            this.btcAddress = btcAddress;
            this.pendingWithdrawals = [];
            this.replacedWithdrawals = new Map();
        }
        else {
            this.state = chainIdOrObj.state;
            this.chainId = chainIdOrObj.chainId;
            this.data = base_1.SpvVaultData.deserialize(chainIdOrObj.data);
            this.initialUtxo = chainIdOrObj.initialUtxo;
            this.btcAddress = chainIdOrObj.btcAddress;
            this.pendingWithdrawals = chainIdOrObj.pendingWithdrawals.map((base_1.SpvWithdrawalTransactionData.deserialize));
            this.scOpenTxs = chainIdOrObj.scOpenTxs;
            this.replacedWithdrawals = new Map();
            if (chainIdOrObj.replacedWithdrawals != null) {
                chainIdOrObj.replacedWithdrawals.forEach((val) => {
                    this.replacedWithdrawals.set(val[0], val[1].map((base_1.SpvWithdrawalTransactionData.deserialize)));
                });
            }
        }
        this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
    }
    update(event) {
        if (event instanceof base_1.SpvVaultClaimEvent || event instanceof base_1.SpvVaultCloseEvent) {
            const processedWithdrawalIndex = this.pendingWithdrawals.findIndex(val => val.btcTx.txid === event.btcTxId);
            if (processedWithdrawalIndex !== -1)
                this.pendingWithdrawals.splice(0, processedWithdrawalIndex + 1);
            if (event instanceof base_1.SpvVaultClaimEvent) {
                for (let key of this.replacedWithdrawals.keys()) {
                    if (key <= event.withdrawCount)
                        this.replacedWithdrawals.delete(key);
                }
            }
            if (event instanceof base_1.SpvVaultCloseEvent) {
                this.replacedWithdrawals.clear();
            }
        }
        this.data.updateState(event);
        this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
    }
    addWithdrawal(withdrawalData) {
        //Make sure this is a valid state transition before adding the tx to pending withdrawals
        this.balances = this.data.calculateStateAfter([...this.pendingWithdrawals, withdrawalData]).balances;
        this.pendingWithdrawals.push(withdrawalData);
    }
    removeWithdrawal(withdrawalData) {
        const index = this.pendingWithdrawals.indexOf(withdrawalData);
        if (index === -1)
            return false;
        this.pendingWithdrawals.splice(index, 1);
        this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
        return true;
    }
    doubleSpendPendingWithdrawal(withdrawalData) {
        const index = this.pendingWithdrawals.indexOf(withdrawalData);
        if (index === -1)
            return false;
        this.pendingWithdrawals.splice(index, 1);
        this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
        const withdrawalIndex = this.data.getWithdrawalCount() + index + 1;
        let arr = this.replacedWithdrawals.get(withdrawalIndex);
        if (arr == null)
            this.replacedWithdrawals.set(withdrawalIndex, arr = []);
        arr.push(withdrawalData);
        return true;
    }
    toRawAmounts(amounts) {
        return amounts.map((amt, index) => {
            const tokenData = this.data.getTokenData()[index];
            if (tokenData == null)
                throw new Error("Amount index out of bounds!");
            return amt / tokenData.multiplier;
        });
    }
    fromRawAmounts(rawAmounts) {
        return rawAmounts.map((amt, index) => {
            const tokenData = this.data.getTokenData()[index];
            if (tokenData == null)
                throw new Error("Amount index out of bounds!");
            return amt * tokenData.multiplier;
        });
    }
    /**
     * Returns the vault balance after processing all currently confirmed (at least 1 btc confirmation) withdrawals
     */
    getConfirmedBalance() {
        return this.data.calculateStateAfter(this.pendingWithdrawals.filter(val => val.btcTx.confirmations >= 1)).balances;
    }
    serialize() {
        const replacedWithdrawals = [];
        this.replacedWithdrawals.forEach((value, key) => {
            replacedWithdrawals.push([key, value.map(val => val.serialize())]);
        });
        return {
            state: this.state,
            chainId: this.chainId,
            data: this.data.serialize(),
            initialUtxo: this.initialUtxo,
            btcAddress: this.btcAddress,
            pendingWithdrawals: this.pendingWithdrawals.map(val => val.serialize()),
            replacedWithdrawals,
            scOpenTxs: this.scOpenTxs
        };
    }
    static _getIdentifier(chainId, data) {
        return chainId + "_" + data.getOwner() + "_" + data.getVaultId().toString(10);
    }
    getIdentifier() {
        return SpvVault._getIdentifier(this.chainId, this.data);
    }
    /**
     * Returns the latest vault utxo
     */
    getLatestUtxo() {
        if (this.pendingWithdrawals.length === 0) {
            return this.data.getUtxo();
        }
        const latestWithdrawal = this.pendingWithdrawals[this.pendingWithdrawals.length - 1];
        if (latestWithdrawal.btcTx.confirmations >= 1)
            return latestWithdrawal.btcTx.txid + ":0";
        return null;
    }
    /**
     * Returns whether the vault is ready for the next swap
     */
    isReady() {
        return this.data.isOpened() && this.getLatestUtxo() != null;
    }
}
exports.SpvVault = SpvVault;
