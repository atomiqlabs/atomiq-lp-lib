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
                    this.replacedWithdrawals.set(val[0], new Map(val[1].map((raw) => {
                        const withdrawTxData = base_1.SpvWithdrawalTransactionData.deserialize(raw);
                        return [withdrawTxData.getTxId(), withdrawTxData];
                    })));
                });
            }
        }
        this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
    }
    addToReplacedWithdrawals(withdrawalIndex, withdrawalData) {
        let map = this.replacedWithdrawals.get(withdrawalIndex);
        if (map == null)
            this.replacedWithdrawals.set(withdrawalIndex, map = new Map());
        map.set(withdrawalData.getTxId(), withdrawalData);
    }
    update(event) {
        //Check if the transition is valid
        //Trip the data through deserializer, so we get new instance
        const clonedData = base_1.SpvVaultData.deserialize(this.data.serialize());
        clonedData.updateState(event);
        let removedWithdrawals;
        if ((0, base_1.isSpvVaultClaimEvent)(event) || (0, base_1.isSpvVaultCloseEvent)(event)) {
            const processedWithdrawalIndex = this.pendingWithdrawals.findIndex(val => val.btcTx.txid === event.btcTxId);
            if (processedWithdrawalIndex !== -1)
                removedWithdrawals = this.pendingWithdrawals.splice(0, processedWithdrawalIndex + 1);
        }
        //This throws if there is invalid withdrawal tx chain
        try {
            clonedData.calculateStateAfter(this.pendingWithdrawals);
        }
        catch (e) {
            //Roll-back pending withdrawals
            if (removedWithdrawals != null)
                this.pendingWithdrawals.unshift(...removedWithdrawals);
            throw e;
        }
        //Everything verified now
        //Handle replaced withdrawals and vault close events
        if ((0, base_1.isSpvVaultClaimEvent)(event)) {
            for (let key of this.replacedWithdrawals.keys()) {
                if (key <= event.withdrawCount)
                    this.replacedWithdrawals.delete(key);
            }
        }
        if ((0, base_1.isSpvVaultCloseEvent)(event)) {
            this.replacedWithdrawals.clear();
        }
        //Apply state update for real and recalculate the balance
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
        //We also have to remove all the subsequent withdrawals, otherwise the state calculation throws on discontinous chain
        this.pendingWithdrawals.splice(index);
        this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
        return true;
    }
    //Must only be called on the latest pending withdrawal!
    doubleSpendPendingWithdrawal(withdrawalData) {
        const index = this.pendingWithdrawals.indexOf(withdrawalData);
        if (index === -1)
            return false;
        if (index !== this.pendingWithdrawals.length - 1)
            throw new Error("Cannot remove not-last pending withdrawal!");
        this.pendingWithdrawals.splice(index, 1);
        this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
        this.addToReplacedWithdrawals(this.data.getWithdrawalCount() + index + 1, withdrawalData);
        return true;
    }
    replacePendingWithdrawals(newPendingWithdrawalData) {
        const backup = this.pendingWithdrawals.splice(0);
        try {
            newPendingWithdrawalData.forEach(newWithdrawal => this.addWithdrawal(newWithdrawal));
        }
        catch (e) {
            //Roll-back the original backup
            this.pendingWithdrawals.splice(0);
            this.pendingWithdrawals.push(...backup);
            this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
            throw e;
        }
        for (let i = 0; i < newPendingWithdrawalData.length; i++) {
            const newWithdrawal = newPendingWithdrawalData[i];
            if (backup[i] == null)
                continue; //Nothing needs to be done
            if (backup[i].getTxId() == newWithdrawal.getTxId())
                continue; //Same transaction
            //Different transaction, add the original to the replaced txs
            this.addToReplacedWithdrawals(this.data.getWithdrawalCount() + i + 1, backup[i]);
        }
        //The replacement is actually shorter than the original
        for (let i = newPendingWithdrawalData.length; i < backup.length; i++) {
            //Add the original to the replaced txs
            this.addToReplacedWithdrawals(this.data.getWithdrawalCount() + i + 1, backup[i]);
        }
        //Also purge the current newPendingWithdrawalData from the replacedWithdrawals
        for (let value of this.replacedWithdrawals.values()) {
            newPendingWithdrawalData.forEach(newTx => value.delete(newTx.getTxId()));
        }
    }
    toRawAmounts(amounts) {
        return amounts.map((amt, index) => {
            if (amt < 0n)
                throw new Error("Amount cannot be negative!");
            const tokenData = this.data.getTokenData()[index];
            if (tokenData == null)
                throw new Error("Amount index out of bounds!");
            const result = amt / tokenData.multiplier;
            if (result < 0n || result >= 2n ** 64n)
                throw new Error("Amount too large to be represented as uint64 after multiplier scaling!");
            return result;
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
            replacedWithdrawals.push([key, [...value.values()].map(val => val.serialize())]);
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
    getNextWithdrawalIndex() {
        return this.data.getWithdrawalCount() + this.pendingWithdrawals.length + 1;
    }
    /**
     * Returns whether the vault is ready for the next swap
     */
    isReady() {
        return this.data.isOpened() && this.getLatestUtxo() != null;
    }
}
exports.SpvVault = SpvVault;
