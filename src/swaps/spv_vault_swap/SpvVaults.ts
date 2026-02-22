import {SpvVault, SpvVaultState} from "./SpvVault";
import {
    BitcoinRpc, BtcBlock, BtcTx,
    IStorageManager,
    SpvVaultClaimEvent,
    SpvVaultCloseEvent,
    SpvVaultDepositEvent,
    SpvVaultOpenEvent,
    SpvWithdrawalTransactionData
} from "@atomiqlabs/base";
import {SpvVaultSwap} from "./SpvVaultSwap";
import {bigIntSorter, getLogger} from "../../utils/Utils";
import {PluginManager} from "../../plugins/PluginManager";
import {IBitcoinWallet} from "../../wallets/IBitcoinWallet";
import {ISpvVaultSigner} from "../../wallets/ISpvVaultSigner";
import {AmountAssertions} from "../assertions/AmountAssertions";
import {MultichainData} from "../SwapHandler";
import {Transaction} from "@scure/btc-signer";
import {checkTransactionReplaced} from "../../utils/BitcoinUtils";

export const VAULT_DUST_AMOUNT = 600;
const VAULT_INIT_CONFIRMATIONS = 2;
const MAX_PARALLEL_VAULTS_OPENING = 10;

export class SpvVaults {

    readonly vaultStorage: IStorageManager<SpvVault>;

    readonly bitcoin: IBitcoinWallet;
    readonly vaultSigner: ISpvVaultSigner;
    readonly bitcoinRpc: BitcoinRpc<BtcBlock>;
    readonly config: {vaultsCheckInterval: number, maxUnclaimedWithdrawals?: number};
    readonly chains: MultichainData;

    readonly logger = getLogger("SpvVaults: ");

    constructor(
        vaultStorage: IStorageManager<SpvVault>,
        bitcoin: IBitcoinWallet,
        vaultSigner: ISpvVaultSigner,
        bitcoinRpc: BitcoinRpc<any>,
        chains: MultichainData,
        config: {vaultsCheckInterval: number, maxUnclaimedWithdrawals?: number}
    ) {
        this.vaultStorage = vaultStorage;
        this.bitcoin = bitcoin;
        this.vaultSigner = vaultSigner;
        this.bitcoinRpc = bitcoinRpc;
        this.chains = chains;
        this.config = config;

        for(let chainId in chains.chains) {
            const {chainInterface} = chains.chains[chainId];
            chainInterface.onBeforeTxReplace(async (oldTx: string, oldTxId: string, newTx: string, newTxId: string) => {
                for(let key in this.vaultStorage.data) {
                    const vaultData = this.vaultStorage.data[key];
                    if(vaultData.scOpenTxs!=null && vaultData.scOpenTxs[oldTxId]!=null){
                        vaultData.scOpenTxs[newTxId] = newTx;
                        await this.saveVault(vaultData);
                        break;
                    }
                }
            });
        }
    }

    async processDepositEvent(vault: SpvVault, event: SpvVaultDepositEvent): Promise<void> {
        vault.update(event);
        await this.saveVault(vault);
    }

    async processOpenEvent(vault: SpvVault, event: SpvVaultOpenEvent): Promise<void> {
        if(vault.state===SpvVaultState.BTC_CONFIRMED) {
            vault.state = SpvVaultState.OPENED;
        }
        vault.update(event);
        await this.saveVault(vault);
    }

    async processCloseEvent(vault: SpvVault, event: SpvVaultCloseEvent): Promise<void> {
        if(vault.state===SpvVaultState.OPENED) {
            vault.state = SpvVaultState.CLOSED;
        }
        vault.update(event);
        await this.saveVault(vault);
    }

    async processClaimEvent(vault: SpvVault, swap: SpvVaultSwap | null, event: SpvVaultClaimEvent): Promise<void> {
        //Update vault
        const foundPendingWithdrawal = vault.pendingWithdrawals.findIndex(val => val.btcTx.txid===event.btcTxId);
        if(foundPendingWithdrawal!==-1) vault.pendingWithdrawals.splice(foundPendingWithdrawal, 1);
        vault.update(event);
        await this.saveVault(vault);
    }

    async createVaults(chainId: string, count: number, token: string, confirmations: number = 2, feeRate?: number): Promise<{vaultsCreated: bigint[], btcTxId: string}> {
        const {signer, chainInterface, tokenMultipliers, spvVaultContract} = this.chains.chains[chainId];

        const signerAddress = signer.getAddress();

        //Check vaultId of the latest saved vault
        let latestVaultId: bigint = -1n;
        for(let key in this.vaultStorage.data) {
            const vault = this.vaultStorage.data[key];
            if(vault.chainId!==chainId) continue;
            if(vault.data.getOwner()!==signerAddress) continue;
            if(vault.data.getVaultId() > latestVaultId) latestVaultId = vault.data.getVaultId();
        }

        latestVaultId++;

        const vaultAddreses: {vaultId: bigint, address: string}[] = [];
        for(let i=0;i<count;i++) {
            const vaultId = latestVaultId + BigInt(i);
            const address = await this.vaultSigner.getAddress(chainId, vaultId);
            vaultAddreses.push({vaultId, address});
        }

        const nativeToken = chainInterface.getNativeCurrencyAddress();

        let txId: string = null;
        let vaults: SpvVault[] = null;
        await this.bitcoin.execute(async () => {
            //Construct transaction
            const txResult = await this.bitcoin.getSignedMultiTransaction(vaultAddreses.map(val => {
                return {address: val.address, amount: VAULT_DUST_AMOUNT}
            }), feeRate);

            vaults = await Promise.all(vaultAddreses.map(async (val, index) => {
                const vaultData = await spvVaultContract.createVaultData(signerAddress, val.vaultId, txResult.txId+":"+index, confirmations, [
                    {token, multiplier: tokenMultipliers?.[token] ?? 1n},
                    {token: nativeToken, multiplier: tokenMultipliers?.[nativeToken] ?? 1n}
                ]);
                return new SpvVault(chainId, vaultData, val.address);
            }));

            //Save vaults
            if(this.vaultStorage.saveDataArr!=null) {
                await this.vaultStorage.saveDataArr(vaults.map(val => {
                    return {id: val.getIdentifier(), object: val}
                }));
            } else {
                for(let vault of vaults) {
                    await this.vaultStorage.saveData(vault.getIdentifier(), vault);
                }
            }

            //Send bitcoin tx
            await this.bitcoin.sendRawTransaction(txResult.raw);

            txId = txResult.txId;
        });

        this.logger.info("createVaults(): Funding "+count+" vaults, bitcoin txId: "+txId);

        return {
            vaultsCreated: vaults.map(val => val.data.getVaultId()),
            btcTxId: txId
        };
    }

    async listVaults(chainId?: string, token?: string) {
        return Object.keys(this.vaultStorage.data)
            .map(key => this.vaultStorage.data[key])
            .filter(val => chainId==null ? true : val.chainId===chainId)
            .filter(val => this.chains.chains[val.chainId]!=null && val.data.getOwner()===this.chains.chains[val.chainId]?.signer?.getAddress())
            .filter(val => token==null ? true : val.data.getTokenData()[0].token===token);
    }

    async fundVault(vault: SpvVault, tokenAmounts: bigint[]): Promise<string> {
        if(vault.state!==SpvVaultState.OPENED) throw new Error("Vault not opened!");

        this.logger.info("fundVault(): Depositing tokens to the vault "+vault.data.getVaultId().toString(10)+", amounts: "+tokenAmounts.map(val => val.toString(10)).join(", "));

        const {signer, spvVaultContract} = this.chains.chains[vault.chainId];

        const txId = await spvVaultContract.deposit(signer, vault.data, tokenAmounts, {waitForConfirmation: true});

        this.logger.info("fundVault(): Tokens deposited to vault "+vault.data.getVaultId().toString(10)+", amounts: "+tokenAmounts.map(val => val.toString(10)).join(", ")+", txId: "+txId);

        return txId;
    }

    async withdrawFromVault(vault: SpvVault, tokenAmounts: bigint[], feeRate?: number): Promise<string> {
        tokenAmounts.forEach((rawAmount, index) => {
            if(vault.balances[index]==null) throw new Error("Token not found in the vault");
            if(vault.balances[index].rawAmount<rawAmount) throw new Error("Not enough balance in the vault");
        });

        if(!vault.isReady()) throw new Error("Vault not ready, wait for the latest swap to get at least 1 confirmation!");

        const {signer, spvVaultContract} = this.chains.chains[vault.chainId];

        const latestUtxo = vault.getLatestUtxo();
        const [txId, voutStr] = latestUtxo.split(":");

        const opReturnData = spvVaultContract.toOpReturnData(signer.getAddress(), tokenAmounts);
        let opReturnScript: Buffer;
        if(opReturnData.length<76) {
            opReturnScript = Buffer.concat([
                Buffer.from([0x6a, opReturnData.length]),
                opReturnData
            ]);
        } else {
            opReturnScript = Buffer.concat([
                Buffer.from([0x6a, 0x4c, opReturnData.length]),
                opReturnData
            ]);
        }

        let psbt = new Transaction({
            allowUnknownOutputs: true
        });
        psbt.addInput({
            txid: txId,
            index: parseInt(voutStr),
            witnessUtxo: {
                amount: BigInt(VAULT_DUST_AMOUNT),
                script: this.bitcoin.toOutputScript(vault.btcAddress)
            }
        });
        psbt.addOutput({
            amount: BigInt(VAULT_DUST_AMOUNT),
            script: this.bitcoin.toOutputScript(vault.btcAddress)
        });
        psbt.addOutput({
            amount: 0n,
            script: opReturnScript
        });

        let withdrawalTxId: string = null;
        await this.bitcoin.execute(async () => {
            psbt = await this.bitcoin.fundPsbt(psbt, feeRate);
            if(psbt.inputsLength<2) throw new Error("PSBT needs at least 2 inputs!");
            psbt.updateInput(0, {sequence: 0x80000000});
            psbt.updateInput(1, {sequence: 0x80000000});
            psbt = await this.vaultSigner.signPsbt(vault.chainId, vault.data.getVaultId(), psbt, [0]);
            const res = await this.bitcoin.signPsbt(psbt);
            withdrawalTxId = res.txId;

            const parsedTransaction = await this.bitcoinRpc.parseTransaction(res.raw);
            const withdrawalData = await spvVaultContract.getWithdrawalData(parsedTransaction);

            if(withdrawalData.getSpentVaultUtxo()!==vault.getLatestUtxo()) {
                throw new Error("Latest vault UTXO already spent! Please try again later.");
            }
            (withdrawalData as any).sending = true;
            vault.addWithdrawal(withdrawalData);
            await this.saveVault(vault);

            try {
                await this.bitcoin.sendRawTransaction(res.raw);
                (withdrawalData as any).sending = false;
            } catch (e) {
                (withdrawalData as any).sending = false;
                vault.removeWithdrawal(withdrawalData);
                await this.saveVault(vault);
                throw e;
            }
        });

        return withdrawalTxId;
    }

    /**
     * Call this to check whether some of the previously replaced transactions got re-introduced to the mempool
     *
     * @param vault
     * @param save
     */
    async checkVaultReplacedTransactions(vault: SpvVault, save?: boolean): Promise<boolean> {
        const {spvVaultContract} = this.chains.chains[vault.chainId];

        const initialVaultWithdrawalCount = vault.data.getWithdrawalCount();

        let latestWithdrawalIndex = initialVaultWithdrawalCount;
        const newPendingTxns: SpvWithdrawalTransactionData[] = [];
        const reintroducedTxIds: Set<string> = new Set();
        for(let [withdrawalIndex, replacedWithdrawalGroup] of vault.replacedWithdrawals) {
            if(withdrawalIndex<=latestWithdrawalIndex) continue; //Don't check txns that should already be included

            for(let replacedWithdrawal of replacedWithdrawalGroup) {
                if(reintroducedTxIds.has(replacedWithdrawal.getTxId())) continue;
                const tx = await this.bitcoinRpc.getTransaction(replacedWithdrawal.getTxId());
                if(tx==null) continue;

                //Re-introduce transaction to the pending withdrawals list
                if(withdrawalIndex>latestWithdrawalIndex) {
                    const txChain: SpvWithdrawalTransactionData[] = [replacedWithdrawal];
                    withdrawalIndex--;
                    while(withdrawalIndex>latestWithdrawalIndex) {
                        const tx = await this.bitcoinRpc.getTransaction(txChain[0].getSpentVaultUtxo().split(":")[0]);
                        if(tx==null) break;
                        reintroducedTxIds.add(tx.txid);
                        txChain.unshift(await spvVaultContract.getWithdrawalData(tx));
                        withdrawalIndex--;
                    }
                    if(withdrawalIndex>latestWithdrawalIndex) {
                        this.logger.warn(`checkVaultReplacedTransactions(${vault.getIdentifier()}): Tried to re-introduce previously replaced TX, but one of txns in the chain not found!`);
                        continue;
                    }
                    newPendingTxns.push(...txChain);
                    latestWithdrawalIndex += txChain.length;
                    break; //Don't check other txns at the same withdrawal index
                } else {
                    this.logger.warn(`checkVaultReplacedTransactions(${vault.getIdentifier()}): Tried to re-introduce previously replaced TX, but vault has already processed such withdrawal!`);
                }
            }
        }

        if(newPendingTxns.length===0) return false;

        if(initialVaultWithdrawalCount!==vault.data.getWithdrawalCount()) {
            this.logger.warn(`checkVaultReplacedTransactions(${vault.getIdentifier()}): Not saving vault after checking replaced transactions, due to withdrawal count changed!`);
            return false;
        }

        const backup = vault.pendingWithdrawals.splice(0, newPendingTxns.length);
        const txsToAddOnTop = vault.pendingWithdrawals.splice(0, vault.pendingWithdrawals.length);

        try {
            newPendingTxns.forEach(val => vault.addWithdrawal(val));
            txsToAddOnTop.forEach(val => vault.addWithdrawal(val));
            for(let i=0;i<newPendingTxns.length;i++) {
                const withdrawalIndex = initialVaultWithdrawalCount+i+1;
                const arr = vault.replacedWithdrawals.get(withdrawalIndex);
                if(arr==null) continue;
                const index = arr.indexOf(newPendingTxns[i]);
                if(index===-1) {
                    this.logger.warn(`checkVaultReplacedTransactions(${vault.getIdentifier()}): Cannot remove re-introduced tx ${newPendingTxns[i].getTxId()}, not found in the respective array!`);
                    continue;
                }
                arr.splice(index, 1);
                if(arr.length===0) vault.replacedWithdrawals.delete(withdrawalIndex);
            }
            this.logger.info(`checkVaultReplacedTransactions(${vault.getIdentifier()}): Re-introduced back ${newPendingTxns.length} txns that were re-added to the mempool!`);
            if(save) await this.saveVault(vault);
            return true;
        } catch (e) {
            this.logger.error(`checkVaultReplacedTransactions(${vault.getIdentifier()}): Failed to update the vault with new pending txns (rolling back): `, e);
            //Rollback the pending withdrawals
            vault.pendingWithdrawals.push(...backup, ...txsToAddOnTop);
            return false;
        }
    }

    async checkVaults() {
        const vaults = Object.keys(this.vaultStorage.data).map(key => this.vaultStorage.data[key]);

        const claimWithdrawals: {vault: SpvVault, withdrawals: SpvWithdrawalTransactionData[]}[] = [];

        let promises: Promise<void>[] = [];

        for(let vault of vaults) {
            const chainData = this.chains.chains[vault.chainId];
            if(chainData==null) continue;
            const {signer, spvVaultContract, chainInterface} = chainData;
            if(vault.data.getOwner()!==signer.getAddress()) continue;

            if(vault.state===SpvVaultState.BTC_INITIATED) {
                //Check if btc tx confirmed
                const txId = vault.initialUtxo.split(":")[0];
                const btcTx = await this.bitcoinRpc.getTransaction(txId);
                if(btcTx.confirmations >= VAULT_INIT_CONFIRMATIONS) {
                    //Double-check the state here to prevent race condition
                    if(vault.state===SpvVaultState.BTC_INITIATED) {
                        vault.state = SpvVaultState.BTC_CONFIRMED;
                        await this.saveVault(vault);
                    }
                    this.logger.info("checkVaults(): Vault ID "+vault.data.getVaultId().toString(10)+" confirmed on bitcoin, opening vault on "+vault.chainId);
                }
            }

            if(vault.state===SpvVaultState.BTC_CONFIRMED) {
                //Check if open txs were sent already
                if(vault.scOpenTxs!=null) {
                    //Check if confirmed
                    let _continue = false;
                    for(let txId in vault.scOpenTxs) {
                        const tx = vault.scOpenTxs[txId];
                        const status = await chainInterface.getTxStatus(tx);
                        if(status==="pending") {
                            _continue = true;
                            break;
                        }
                        if(status==="success") {
                            vault.state = SpvVaultState.OPENED;
                            await this.saveVault(vault);
                            _continue = true;
                            break;
                        }
                    }
                    if(_continue) continue;
                }

                const txs = await spvVaultContract.txsOpen(signer.getAddress(), vault.data);
                let numTx = 0;
                promises.push(
                    chainInterface.sendAndConfirm(
                        signer, txs, true, undefined, true,
                        async (txId: string, rawTx: string) => {
                            numTx++;
                            if(numTx===txs.length) {
                                //Final tx
                                vault.scOpenTxs = {[txId]: rawTx};
                                await this.saveVault(vault);
                            }
                        }
                    ).then(txIds => {
                        this.logger.info("checkVaults(): Vault ID "+vault.data.getVaultId().toString(10)+" opened on "+vault.chainId+" txId: "+txIds.join(", "));

                        vault.state = SpvVaultState.OPENED;
                        return this.saveVault(vault);
                    })
                );
                if(promises.length>=MAX_PARALLEL_VAULTS_OPENING) {
                    await Promise.all(promises);
                    promises = [];
                }
                continue;
            }

            if(vault.state===SpvVaultState.OPENED) {
                let changed = await this.checkVaultReplacedTransactions(vault);

                //Check if some of the pendingWithdrawals got confirmed
                let latestOwnWithdrawalIndex = -1;
                let latestConfirmedWithdrawalIndex = -1;
                for(let i = vault.pendingWithdrawals.length-1; i>=0; i--) {
                    const pendingWithdrawal = vault.pendingWithdrawals[i];
                    if(pendingWithdrawal.sending) continue;

                    //Check all the pending withdrawals that were not finalized yet
                    const btcTx = await checkTransactionReplaced(pendingWithdrawal.btcTx.txid, pendingWithdrawal.btcTx.raw, this.bitcoinRpc);
                    if(btcTx==null) {
                        //Probable double-spend, remove from pending withdrawals
                        if(!vault.doubleSpendPendingWithdrawal(pendingWithdrawal)) {
                            this.logger.warn("checkVaults(): Tried to remove pending withdrawal txId: "+pendingWithdrawal.btcTx.txid+", but doesn't exist anymore!");
                        } else {
                            this.logger.info("checkVaults(): Successfully removed withdrawal txId: "+pendingWithdrawal.btcTx.txid+", due to being replaced in the mempool!");
                        }
                        changed = true;
                    } else {
                        //Update confirmations count
                        if(
                            pendingWithdrawal.btcTx.confirmations !== btcTx.confirmations ||
                            pendingWithdrawal.btcTx.blockhash !== btcTx.blockhash
                        ) {
                            pendingWithdrawal.btcTx.confirmations = btcTx.confirmations;
                            pendingWithdrawal.btcTx.blockhash = btcTx.blockhash;
                            changed = true;
                        }
                    }

                    //Check it has enough confirmations
                    if(pendingWithdrawal.btcTx.confirmations >= vault.data.getConfirmations()) {
                        latestConfirmedWithdrawalIndex = i;
                        //Check if the pending withdrawals contain a withdrawal to our own address
                        if (pendingWithdrawal.isRecipient(signer.getAddress())) {
                            latestOwnWithdrawalIndex = i;
                        }
                    }
                }
                if(changed) {
                    await this.saveVault(vault);
                }
                if(this.config.maxUnclaimedWithdrawals!=null && latestConfirmedWithdrawalIndex+1 >= this.config.maxUnclaimedWithdrawals) {
                    this.logger.info("checkVaults(): Processing withdrawals by self, because a lot of them are unclaimed!");
                    claimWithdrawals.push({vault, withdrawals: vault.pendingWithdrawals.slice(0, latestConfirmedWithdrawalIndex+1)});
                } else if(latestOwnWithdrawalIndex!==-1) {
                    claimWithdrawals.push({vault, withdrawals: vault.pendingWithdrawals.slice(0, latestOwnWithdrawalIndex+1)});
                }
            }
        }

        for(let {vault, withdrawals} of claimWithdrawals) {
            if(!await this.claimWithdrawals(vault, withdrawals)) {
                this.logger.error("checkVaults(): Cannot process withdrawals "+withdrawals.map(val => val.btcTx.txid).join(", ")+" for vault: "+vault.data.getVaultId());
                break;
            }
        }
    }

    async claimWithdrawals(vault: SpvVault, withdrawal: SpvWithdrawalTransactionData[]): Promise<boolean> {
        const {signer, spvVaultContract} = this.chains.chains[vault.chainId];

        try {
            const txId = await spvVaultContract.claim(signer, vault.data, withdrawal.map(tx => {
                return {tx};
            }), undefined, true, {waitForConfirmation: true});
            this.logger.info("claimWithdrawal(): Successfully claimed withdrawals, btcTxIds: "+withdrawal.map(val => val.btcTx.txid).join(", ")+" smartChainTxId: "+txId);
            return true;
        } catch (e) {
            this.logger.error("claimWithdrawal(): Tried to claim but got error: ", e);
            return false;
        }
    }

    async getVault(chainId: string, owner: string, vaultId: bigint) {
        return this.vaultStorage.data[chainId+"_"+owner+"_"+vaultId.toString(10)];
    }

    /**
     * Returns a ready-to-use vault for a specific request
     *
     * @param chainIdentifier
     * @param totalSats
     * @param token
     * @param amount
     * @param gasToken
     * @param gasTokenAmount
     * @protected
     */
    async findVaultForSwap(chainIdentifier: string, totalSats: bigint, token: string, amount: bigint, gasToken: string, gasTokenAmount: bigint): Promise<SpvVault | null> {
        const {signer} = this.chains.chains[chainIdentifier];

        const pluginResponse = await PluginManager.onVaultSelection(
            chainIdentifier, totalSats, {token, amount}, {token: gasToken, amount: gasTokenAmount}
        );
        if(pluginResponse!=null) {
            AmountAssertions.handlePluginErrorResponses(pluginResponse);
            return pluginResponse as SpvVault;
        }

        const candidates = Object.keys(this.vaultStorage.data)
            .map(key => this.vaultStorage.data[key])
            .filter(vault =>
                vault.chainId===chainIdentifier && vault.data.getOwner()===signer.getAddress() && vault.isReady()
            )
            .filter(vault => {
                const token0 = vault.balances[0];
                if(token0.token!==token || token0.scaledAmount < amount) return false;
                if(gasToken!=null && gasTokenAmount!==0n) {
                    const token1 = vault.balances[1];
                    if(token1.token!==gasToken || token1.scaledAmount < gasTokenAmount) return false;
                }
                return true;
            });

        candidates.sort((a, b) => bigIntSorter(a.balances[0].scaledAmount, b.balances[0].scaledAmount));

        const result = candidates[0];

        if(result==null) throw {
            code: 20301,
            msg: "No suitable swap vault found, try again later!"
        };

        return result;
    }

    saveVault(vault: SpvVault) {
        return this.vaultStorage.saveData(vault.getIdentifier(), vault);
    }

    async startVaultsWatchdog() {
        let rerun: () => Promise<void>;
        rerun = async () => {
            await this.checkVaults().catch( e => this.logger.error("startVaultsWatchdog(): Error when periodically checking SPV vaults: ", e));
            setTimeout(rerun, this.config.vaultsCheckInterval);
        };
        await rerun();
    }

    async init() {
        const vaults = await this.vaultStorage.loadData(SpvVault);
    }

    /**
     * Recovers already created vaults for a given chain from on-chain data. Requires initialized BTC wallet to
     *  fetch wallet transactions
     *
     * @param chainId
     */
    async recoverVaults(chainId: string): Promise<SpvVault[]> {
        const chain = this.chains.chains[chainId];
        if(chainId==null) throw new Error(`Chain ${chainId} not found in known chains!`);
        const vaults = await chain.spvVaultContract.getAllVaults(chain.signer.getAddress());

        const recoveredVaults: SpvVault[] = [];
        let minimumBlockheight = null;

        for(let vaultData of vaults) {
            const vaultIdentifier = SpvVault._getIdentifier(chainId, vaultData);
            if(this.vaultStorage.data[vaultIdentifier]!=null) {
                this.logger.info(`recoverVaults(${chainId}): Skipping vault ${vaultIdentifier}, because it is already known!`);
                continue;
            }
            const [txId, voutStr] = vaultData.getUtxo().split(":");
            const btcTx = await this.bitcoinRpc.getTransaction(txId);
            const btcTxOutput = btcTx.outs[parseInt(voutStr)];
            const vaultAddress = this.bitcoin.fromOutputScript(Buffer.from(btcTxOutput.scriptPubKey.hex, "hex"));
            const vault = new SpvVault(chainId, vaultData, vaultAddress);
            vault.state = SpvVaultState.OPENED;
            await this.saveVault(vault);
            if(await this.bitcoinRpc.isSpent(vaultData.getUtxo())) {
                if(!this.bitcoin.isReady())
                    throw new Error("Bitcoin wallet is not ready, but is required to check wallet transactions!");

                //The latest smart chain UTXO is spent, we need to check if we have some further transactions
                // spending the vault UTXO in our wallet history
                recoveredVaults.push(vault);
                const btcTxBlock = await this.bitcoinRpc.getBlockHeader(btcTx.blockhash);
                minimumBlockheight = minimumBlockheight==null
                    ? btcTxBlock.getHeight()
                    : Math.min(minimumBlockheight, btcTxBlock.getHeight());
            }
        }

        if(minimumBlockheight!=null) {
            const txinMap = new Map<string, BtcTx>();
            const txs = await this.bitcoin.getWalletTransactions(minimumBlockheight);
            txs.forEach(tx => {
                tx.ins.forEach(txin => {
                    txinMap.set(txin.txid+":"+txin.vout, tx);
                })
            });

            for(let vault of recoveredVaults) {
                let utxo = vault.data.getUtxo();
                let btcTx: BtcTx;
                do {
                    btcTx = txinMap.get(utxo);
                    if(btcTx!=null) {
                        const withdrawalData = await chain.spvVaultContract.getWithdrawalData(btcTx);
                        vault.addWithdrawal(withdrawalData);
                        utxo = withdrawalData.getCreatedVaultUtxo();
                    }
                } while(btcTx!=null);
            }
        }

        for(let vault of recoveredVaults) {
            await this.saveVault(vault);
        }

        return recoveredVaults;
    }

}