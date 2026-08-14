import {
    isSpvVaultClaimEvent, isSpvVaultCloseEvent,
    Lockable,
    SpvVaultClaimEvent,
    SpvVaultCloseEvent,
    SpvVaultData,
    SpvVaultDepositEvent,
    SpvVaultOpenEvent,
    SpvVaultTokenBalance,
    SpvWithdrawalTransactionData,
    StorageObject
} from "@atomiqlabs/base";

export enum SpvVaultState {
    CLOSED = -1,
    BTC_INITIATED = 0,
    BTC_CONFIRMED = 1,
    OPENED = 2
}

export class SpvVault<
    D extends SpvWithdrawalTransactionData = SpvWithdrawalTransactionData & {sending?: boolean},
    T extends SpvVaultData = SpvVaultData
> extends Lockable implements StorageObject {

    readonly chainId: string;

    readonly initialUtxo: string;
    readonly btcAddress: string;

    readonly pendingWithdrawals: D[];
    readonly replacedWithdrawals: Map<number, Map<string, D>>;
    data: T;

    state: SpvVaultState;

    balances: SpvVaultTokenBalance[];

    scOpenTxs: {[txId: string]: string};

    constructor(chainId: string, vault: T, btcAddress: string);
    constructor(obj: any);
    constructor(chainIdOrObj: string | any, vault?: T, btcAddress?: string) {
        super();
        if(typeof(chainIdOrObj)==="string") {
            this.state = SpvVaultState.BTC_INITIATED;
            this.chainId = chainIdOrObj;
            this.data = vault;
            this.initialUtxo = vault.getUtxo();
            this.btcAddress = btcAddress;
            this.pendingWithdrawals = [];
            this.replacedWithdrawals = new Map();
        } else {
            this.state = chainIdOrObj.state;
            this.chainId = chainIdOrObj.chainId;
            this.data = SpvVaultData.deserialize<T>(chainIdOrObj.data);
            this.initialUtxo = chainIdOrObj.initialUtxo;
            this.btcAddress = chainIdOrObj.btcAddress;
            this.pendingWithdrawals = chainIdOrObj.pendingWithdrawals.map(SpvWithdrawalTransactionData.deserialize<D>);
            this.scOpenTxs = chainIdOrObj.scOpenTxs;
            this.replacedWithdrawals = new Map();
            if(chainIdOrObj.replacedWithdrawals!=null) {
                chainIdOrObj.replacedWithdrawals.forEach((val: [number, any[]]) => {
                    this.replacedWithdrawals.set(val[0], new Map(val[1].map((raw) => {
                        const withdrawTxData = SpvWithdrawalTransactionData.deserialize<D>(raw);
                        return [withdrawTxData.getTxId(), withdrawTxData];
                    })));
                });
            }
        }
        this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
    }

    private addToReplacedWithdrawals(withdrawalIndex: number, withdrawalData: D) {
        let map = this.replacedWithdrawals.get(withdrawalIndex);
        if(map==null) this.replacedWithdrawals.set(withdrawalIndex, map = new Map());
        map.set(withdrawalData.getTxId(), withdrawalData);
    }

    update(event: SpvVaultOpenEvent | SpvVaultDepositEvent | SpvVaultCloseEvent | SpvVaultClaimEvent): void {
        //Check if the transition is valid
        //Trip the data through deserializer, so we get new instance
        const clonedData = SpvVaultData.deserialize<T>(this.data.serialize());
        clonedData.updateState(event);

        let removedWithdrawals: D[];
        if(isSpvVaultClaimEvent(event) || isSpvVaultCloseEvent(event)) {
            const processedWithdrawalIndex = this.pendingWithdrawals.findIndex(val => val.btcTx.txid === event.btcTxId);
            if (processedWithdrawalIndex !== -1) removedWithdrawals = this.pendingWithdrawals.splice(0, processedWithdrawalIndex + 1);
        }

        //This throws if there is invalid withdrawal tx chain
        try {
            clonedData.calculateStateAfter(this.pendingWithdrawals);
        } catch (e) {
            //Roll-back pending withdrawals
            if(removedWithdrawals!=null) this.pendingWithdrawals.unshift(...removedWithdrawals);
            throw e;
        }
        //Everything verified now

        //Handle replaced withdrawals and vault close events
        if(isSpvVaultClaimEvent(event)) {
            for(let key of this.replacedWithdrawals.keys()) {
                if(key<=event.withdrawCount) this.replacedWithdrawals.delete(key);
            }
        }
        if(isSpvVaultCloseEvent(event)) {
            this.replacedWithdrawals.clear();
        }

        //Apply state update for real and recalculate the balance
        this.data.updateState(event);
        this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
    }

    addWithdrawal(withdrawalData: D): void {
        //Make sure this is a valid state transition before adding the tx to pending withdrawals
        this.balances = this.data.calculateStateAfter([...this.pendingWithdrawals, withdrawalData]).balances;
        this.pendingWithdrawals.push(withdrawalData);
    }

    removeWithdrawal(withdrawalData: D): boolean {
        const index = this.pendingWithdrawals.indexOf(withdrawalData);
        if(index===-1) return false;
        //We also have to remove all the subsequent withdrawals, otherwise the state calculation throws on discontinous chain
        this.pendingWithdrawals.splice(index);
        this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
        return true;
    }

    //Must only be called on the latest pending withdrawal!
    doubleSpendPendingWithdrawal(withdrawalData: D): boolean {
        const index = this.pendingWithdrawals.indexOf(withdrawalData);
        if(index===-1) return false;
        if(index!==this.pendingWithdrawals.length-1) throw new Error("Cannot remove not-last pending withdrawal!");
        this.pendingWithdrawals.splice(index, 1);
        this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;

        this.addToReplacedWithdrawals(this.data.getWithdrawalCount()+index+1, withdrawalData);
        return true;
    }

    replacePendingWithdrawals(newPendingWithdrawalData: D[]) {
        const backup = this.pendingWithdrawals.splice(0);
        try {
            newPendingWithdrawalData.forEach(newWithdrawal => this.addWithdrawal(newWithdrawal));
        } catch (e) {
            //Roll-back the original backup
            this.pendingWithdrawals.splice(0);
            this.pendingWithdrawals.push(...backup);
            this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
            throw e;
        }

        for(let i=0;i<newPendingWithdrawalData.length;i++) {
            const newWithdrawal = newPendingWithdrawalData[i];
            if(backup[i]==null) continue; //Nothing needs to be done
            if(backup[i].getTxId()==newWithdrawal.getTxId()) continue; //Same transaction
            //Different transaction, add the original to the replaced txs
            this.addToReplacedWithdrawals(this.data.getWithdrawalCount()+i+1, backup[i]);
        }
        //The replacement is actually shorter than the original
        for(let i= newPendingWithdrawalData.length; i<backup.length; i++) {
            //Add the original to the replaced txs
            this.addToReplacedWithdrawals(this.data.getWithdrawalCount()+i+1, backup[i]);
        }
    }

    toRawAmounts(amounts: bigint[]): bigint[] {
        return amounts.map((amt, index) => {
            const tokenData = this.data.getTokenData()[index];
            if(tokenData==null) throw new Error("Amount index out of bounds!");
            return amt / tokenData.multiplier;
        });
    }

    fromRawAmounts(rawAmounts: bigint[]): bigint[] {
        return rawAmounts.map((amt, index) => {
            const tokenData = this.data.getTokenData()[index];
            if(tokenData==null) throw new Error("Amount index out of bounds!");
            return amt * tokenData.multiplier;
        });
    }

    /**
     * Returns the vault balance after processing all currently confirmed (at least 1 btc confirmation) withdrawals
     */
    getConfirmedBalance(): SpvVaultTokenBalance[] {
        return this.data.calculateStateAfter(this.pendingWithdrawals.filter(val => val.btcTx.confirmations>=1)).balances;
    }

    serialize(): any {
        const replacedWithdrawals: [number, any[]][] = [];
        this.replacedWithdrawals.forEach((value, key) => {
            replacedWithdrawals.push([key, [...value.values()].map(val => val.serialize())])
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
        }
    }

    static _getIdentifier(chainId: string, data: SpvVaultData): string {
        return chainId+"_"+data.getOwner()+"_"+data.getVaultId().toString(10);
    }

    getIdentifier(): string {
        return SpvVault._getIdentifier(this.chainId, this.data);
    }

    /**
     * Returns the latest vault utxo
     */
    getLatestUtxo(): string {
        if(this.pendingWithdrawals.length===0) {
            return this.data.getUtxo();
        }
        const latestWithdrawal = this.pendingWithdrawals[this.pendingWithdrawals.length - 1];
        if(latestWithdrawal.btcTx.confirmations>=1) return latestWithdrawal.btcTx.txid+":0";
        return null;
    }

    getNextWithdrawalIndex(): number {
        return this.data.getWithdrawalCount() + this.pendingWithdrawals.length + 1;
    }

    /**
     * Returns whether the vault is ready for the next swap
     */
    isReady(): boolean {
        return this.data.isOpened() && this.getLatestUtxo()!=null;
    }

}
