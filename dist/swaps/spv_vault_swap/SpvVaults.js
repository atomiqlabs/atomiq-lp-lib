"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpvVaults = exports.VAULT_DUST_AMOUNT = void 0;
const SpvVault_1 = require("./SpvVault");
const Utils_1 = require("../../utils/Utils");
const PluginManager_1 = require("../../plugins/PluginManager");
const AmountAssertions_1 = require("../assertions/AmountAssertions");
const btc_signer_1 = require("@scure/btc-signer");
exports.VAULT_DUST_AMOUNT = 600;
const VAULT_INIT_CONFIRMATIONS = 2;
const BTC_FINALIZATION_CONFIRMATIONS = 6;
class SpvVaults {
    constructor(vaultStorage, bitcoin, vaultSigner, bitcoinRpc, getChain, config) {
        this.logger = {
            debug: (msg, ...args) => console.debug("SpvVaults: " + msg, ...args),
            info: (msg, ...args) => console.info("SpvVaults: " + msg, ...args),
            warn: (msg, ...args) => console.warn("SpvVaults: " + msg, ...args),
            error: (msg, ...args) => console.error("SpvVaults: " + msg, ...args)
        };
        this.vaultStorage = vaultStorage;
        this.bitcoin = bitcoin;
        this.vaultSigner = vaultSigner;
        this.bitcoinRpc = bitcoinRpc;
        this.getChain = getChain;
        this.config = config;
    }
    async processDepositEvent(vault, event) {
        vault.update(event);
        await this.saveVault(vault);
    }
    async processOpenEvent(vault, event) {
        if (vault.state === SpvVault_1.SpvVaultState.BTC_CONFIRMED) {
            vault.state = SpvVault_1.SpvVaultState.OPENED;
        }
        vault.update(event);
        await this.saveVault(vault);
    }
    async processCloseEvent(vault, event) {
        if (vault.state === SpvVault_1.SpvVaultState.OPENED) {
            vault.state = SpvVault_1.SpvVaultState.CLOSED;
        }
        vault.update(event);
        await this.saveVault(vault);
    }
    async processClaimEvent(vault, swap, event) {
        //Update vault
        const foundPendingWithdrawal = vault.pendingWithdrawals.findIndex(val => val.btcTx.txid === event.btcTxId);
        if (foundPendingWithdrawal !== -1)
            vault.pendingWithdrawals.splice(foundPendingWithdrawal, 1);
        vault.update(event);
        await this.saveVault(vault);
    }
    async createVaults(chainId, count, token, confirmations = 2, feeRate) {
        const { signer, chainInterface, tokenMultipliers, spvVaultContract } = this.getChain(chainId);
        const signerAddress = signer.getAddress();
        //Check vaultId of the latest saved vault
        let latestVaultId = -1n;
        for (let key in this.vaultStorage.data) {
            const vault = this.vaultStorage.data[key];
            if (vault.chainId !== chainId)
                continue;
            if (vault.data.getOwner() !== signerAddress)
                continue;
            if (vault.data.getVaultId() > latestVaultId)
                latestVaultId = vault.data.getVaultId();
        }
        latestVaultId++;
        const vaultAddreses = [];
        for (let i = 0; i < count; i++) {
            const vaultId = latestVaultId + BigInt(i);
            const address = await this.vaultSigner.getAddress(chainId, vaultId);
            vaultAddreses.push({ vaultId, address });
        }
        //Construct transaction
        const txResult = await this.bitcoin.getSignedMultiTransaction(vaultAddreses.map(val => {
            return { address: val.address, amount: exports.VAULT_DUST_AMOUNT };
        }), feeRate);
        const nativeToken = chainInterface.getNativeCurrencyAddress();
        const vaults = await Promise.all(vaultAddreses.map(async (val, index) => {
            const vaultData = await spvVaultContract.createVaultData(signerAddress, val.vaultId, txResult.txId + ":" + index, confirmations, [
                { token, multiplier: tokenMultipliers?.[token] ?? 1n },
                { token: nativeToken, multiplier: tokenMultipliers?.[nativeToken] ?? 1n }
            ]);
            return new SpvVault_1.SpvVault(chainId, vaultData, val.address);
        }));
        //Save vaults
        if (this.vaultStorage.saveDataArr != null) {
            await this.vaultStorage.saveDataArr(vaults.map(val => {
                return { id: val.getIdentifier(), object: val };
            }));
        }
        else {
            for (let vault of vaults) {
                await this.vaultStorage.saveData(vault.getIdentifier(), vault);
            }
        }
        //Send bitcoin tx
        await this.bitcoin.sendRawTransaction(txResult.raw);
        this.logger.info("createVaults(): Funding " + count + " vaults, bitcoin txId: " + txResult.txId);
        return {
            vaultsCreated: vaults.map(val => val.data.getVaultId()),
            btcTxId: txResult.txId
        };
    }
    async listVaults(chainId, token) {
        return Object.keys(this.vaultStorage.data)
            .map(key => this.vaultStorage.data[key])
            .filter(val => chainId == null ? true : val.chainId === chainId)
            .filter(val => val.data.getOwner() === this.getChain(val.chainId)?.signer?.getAddress())
            .filter(val => token == null ? true : val.data.getTokenData()[0].token === token);
    }
    async fundVault(vault, tokenAmounts) {
        if (vault.state !== SpvVault_1.SpvVaultState.OPENED)
            throw new Error("Vault not opened!");
        this.logger.info("fundVault(): Depositing tokens to the vault " + vault.data.getVaultId().toString(10) + ", amounts: " + tokenAmounts.map(val => val.toString(10)).join(", "));
        const { signer, spvVaultContract } = this.getChain(vault.chainId);
        const txId = await spvVaultContract.deposit(signer, vault.data, tokenAmounts, { waitForConfirmation: true });
        this.logger.info("fundVault(): Tokens deposited to vault " + vault.data.getVaultId().toString(10) + ", amounts: " + tokenAmounts.map(val => val.toString(10)).join(", ") + ", txId: " + txId);
        return txId;
    }
    async withdrawFromVault(vault, tokenAmounts, feeRate) {
        tokenAmounts.forEach((rawAmount, index) => {
            if (vault.balances[index] == null)
                throw new Error("Token not found in the vault");
            if (vault.balances[index].rawAmount < rawAmount)
                throw new Error("Not enough balance in the vault");
        });
        if (!vault.isReady())
            throw new Error("Vault not ready, wait for the latest swap to get at least 1 confirmation!");
        const { signer, spvVaultContract } = this.getChain(vault.chainId);
        const latestUtxo = vault.getLatestUtxo();
        const [txId, voutStr] = latestUtxo.split(":");
        const opReturnData = spvVaultContract.toOpReturnData(signer.getAddress(), tokenAmounts);
        let opReturnScript;
        if (opReturnData.length < 76) {
            opReturnScript = Buffer.concat([
                Buffer.from([0x6a, opReturnData.length]),
                opReturnData
            ]);
        }
        else {
            opReturnScript = Buffer.concat([
                Buffer.from([0x6a, 0x4c, opReturnData.length]),
                opReturnData
            ]);
        }
        let psbt = new btc_signer_1.Transaction({
            allowUnknownOutputs: true
        });
        psbt.addInput({
            txid: txId,
            index: parseInt(voutStr),
            witnessUtxo: {
                amount: BigInt(exports.VAULT_DUST_AMOUNT),
                script: this.bitcoin.toOutputScript(vault.btcAddress)
            }
        });
        psbt.addOutput({
            amount: BigInt(exports.VAULT_DUST_AMOUNT),
            script: this.bitcoin.toOutputScript(vault.btcAddress)
        });
        psbt.addOutput({
            amount: 0n,
            script: opReturnScript
        });
        psbt = await this.bitcoin.fundPsbt(psbt, feeRate);
        if (psbt.inputsLength < 2)
            throw new Error("PSBT needs at least 2 inputs!");
        psbt.updateInput(0, { sequence: 0x80000000 });
        psbt.updateInput(1, { sequence: 0x80000000 });
        psbt = await this.vaultSigner.signPsbt(vault.chainId, vault.data.getVaultId(), psbt, [0]);
        const res = await this.bitcoin.signPsbt(psbt);
        const parsedTransaction = await this.bitcoinRpc.parseTransaction(res.raw);
        const withdrawalData = await spvVaultContract.getWithdrawalData(parsedTransaction);
        if (withdrawalData.getSpentVaultUtxo() !== vault.getLatestUtxo()) {
            throw new Error("Latest vault UTXO already spent! Please try again later.");
        }
        vault.addWithdrawal(withdrawalData);
        await this.saveVault(vault);
        try {
            await this.bitcoin.sendRawTransaction(res.raw);
        }
        catch (e) {
            vault.removeWithdrawal(withdrawalData);
            await this.saveVault(vault);
            throw e;
        }
        return res.txId;
    }
    async checkVaults() {
        const vaults = Object.keys(this.vaultStorage.data).map(key => this.vaultStorage.data[key]);
        const claimWithdrawals = [];
        for (let vault of vaults) {
            const { signer, spvVaultContract } = this.getChain(vault.chainId);
            if (vault.data.getOwner() !== signer.getAddress())
                continue;
            if (vault.state === SpvVault_1.SpvVaultState.BTC_INITIATED) {
                //Check if btc tx confirmed
                const txId = vault.initialUtxo.split(":")[0];
                const btcTx = await this.bitcoinRpc.getTransaction(txId);
                if (btcTx.confirmations >= VAULT_INIT_CONFIRMATIONS) {
                    //Double-check the state here to prevent race condition
                    if (vault.state === SpvVault_1.SpvVaultState.BTC_INITIATED) {
                        vault.state = SpvVault_1.SpvVaultState.BTC_CONFIRMED;
                        await this.saveVault(vault);
                    }
                    this.logger.info("checkVaults(): Vault ID " + vault.data.getVaultId().toString(10) + " confirmed on bitcoin, opening vault on " + vault.chainId);
                }
            }
            if (vault.state === SpvVault_1.SpvVaultState.BTC_CONFIRMED) {
                //TODO: If we crash after open tx is sent (but not confirmed yet) we will be stuck in the loop here
                const txId = await spvVaultContract.open(signer, vault.data, { waitForConfirmation: true });
                this.logger.info("checkVaults(): Vault ID " + vault.data.getVaultId().toString(10) + " opened on " + vault.chainId + " txId: " + txId);
                vault.state = SpvVault_1.SpvVaultState.OPENED;
                await this.saveVault(vault);
            }
            if (vault.state === SpvVault_1.SpvVaultState.OPENED) {
                let changed = false;
                //Check if some of the pendingWithdrawals got confirmed
                let latestOwnWithdrawalIndex = -1;
                for (let i = 0; i < vault.pendingWithdrawals.length; i++) {
                    const pendingWithdrawal = vault.pendingWithdrawals[i];
                    //Check all the pending withdrawals that were not finalized yet
                    if (pendingWithdrawal.btcTx.confirmations == null || pendingWithdrawal.btcTx.confirmations < BTC_FINALIZATION_CONFIRMATIONS) {
                        const btcTx = await this.bitcoinRpc.getTransaction(pendingWithdrawal.btcTx.txid);
                        if (btcTx == null) {
                            //Probable double-spend, remove from pending withdrawals
                            const index = vault.pendingWithdrawals.indexOf(pendingWithdrawal);
                            if (index === -1) {
                                this.logger.warn("checkVaults(): Tried to remove pending withdrawal txId: " + pendingWithdrawal.btcTx.txid + ", but doesn't exist anymore!");
                            }
                            else {
                                vault.pendingWithdrawals.splice(index, 1);
                            }
                            changed = true;
                        }
                        else {
                            //Update confirmations count
                            if (pendingWithdrawal.btcTx.confirmations !== btcTx.confirmations ||
                                pendingWithdrawal.btcTx.blockhash !== btcTx.blockhash) {
                                pendingWithdrawal.btcTx.confirmations = btcTx.confirmations;
                                pendingWithdrawal.btcTx.blockhash = btcTx.blockhash;
                                changed = true;
                            }
                        }
                    }
                    //Check if the pending withdrawals contain a withdrawal to our own address
                    if (pendingWithdrawal.isRecipient(signer.getAddress())) {
                        //Check it has enough confirmations
                        if (pendingWithdrawal.btcTx.confirmations >= vault.data.getConfirmations()) {
                            latestOwnWithdrawalIndex = i;
                        }
                    }
                }
                if (changed) {
                    await this.saveVault(vault);
                }
                if (latestOwnWithdrawalIndex !== -1) {
                    claimWithdrawals.push({ vault, withdrawals: vault.pendingWithdrawals.slice(0, latestOwnWithdrawalIndex + 1) });
                }
            }
        }
        for (let { vault, withdrawals } of claimWithdrawals) {
            if (!await this.claimWithdrawals(vault, withdrawals)) {
                this.logger.error("checkVaults(): Cannot process withdrawals " + withdrawals.map(val => val.btcTx.txid).join(", ") + " for vault: " + vault.data.getVaultId());
                break;
            }
        }
    }
    async claimWithdrawals(vault, withdrawal) {
        const { signer, spvVaultContract } = this.getChain(vault.chainId);
        try {
            const txId = await spvVaultContract.claim(signer, vault.data, withdrawal.map(tx => {
                return { tx };
            }));
            this.logger.info("claimWithdrawal(): Successfully claimed withdrawals, btcTxIds: " + withdrawal.map(val => val.btcTx.txid).join(", ") + " smartChainTxId: " + txId);
            return true;
        }
        catch (e) {
            this.logger.error("claimWithdrawal(): Tried to claim but got error: ", e);
            return false;
        }
    }
    async getVault(chainId, owner, vaultId) {
        return this.vaultStorage.data[chainId + "_" + owner + "_" + vaultId.toString(10)];
    }
    /**
     * Returns a ready-to-use vault for a specific request
     *
     * @param chainIdentifier
     * @param token
     * @param amount
     * @param gasToken
     * @param gasTokenAmount
     * @protected
     */
    async findVaultForSwap(chainIdentifier, token, amount, gasToken, gasTokenAmount) {
        const { signer } = this.getChain(chainIdentifier);
        const candidates = Object.keys(this.vaultStorage.data)
            .map(key => this.vaultStorage.data[key])
            .filter(vault => vault.chainId === chainIdentifier && vault.data.getOwner() === signer.getAddress() && vault.isReady())
            .filter(vault => {
            const token0 = vault.balances[0];
            if (token0.token !== token || token0.scaledAmount < amount)
                return false;
            if (gasToken != null && gasTokenAmount !== 0n) {
                const token1 = vault.balances[1];
                if (token1.token !== gasToken || token1.scaledAmount < gasTokenAmount)
                    return false;
            }
            return true;
        });
        candidates.sort((a, b) => (0, Utils_1.bigIntSorter)(a.balances[0].scaledAmount, b.balances[0].scaledAmount));
        const pluginResponse = await PluginManager_1.PluginManager.onVaultSelection(chainIdentifier, { token, amount }, { token: gasToken, amount: gasTokenAmount }, candidates);
        if (pluginResponse != null) {
            AmountAssertions_1.AmountAssertions.handlePluginErrorResponses(pluginResponse);
        }
        const result = pluginResponse ?? candidates[0];
        if (result == null)
            throw {
                code: 20301,
                msg: "No suitable swap vault found, try again later!"
            };
        return result;
    }
    saveVault(vault) {
        return this.vaultStorage.saveData(vault.getIdentifier(), vault);
    }
    async startVaultsWatchdog() {
        let rerun;
        rerun = async () => {
            await this.checkVaults().catch(e => console.error(e));
            setTimeout(rerun, this.config.vaultsCheckInterval);
        };
        await rerun();
    }
    async init() {
        const vaults = await this.vaultStorage.loadData(SpvVault_1.SpvVault);
    }
}
exports.SpvVaults = SpvVaults;
