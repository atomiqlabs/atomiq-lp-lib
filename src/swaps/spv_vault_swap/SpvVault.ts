import {
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
    D extends SpvWithdrawalTransactionData = SpvWithdrawalTransactionData,
    T extends SpvVaultData = SpvVaultData
> extends Lockable implements StorageObject {

    readonly chainId: string;

    readonly initialUtxo: string;
    readonly btcAddress: string;

    //Computed
    readonly pendingWithdrawals: D[];
    data: T;

    state: SpvVaultState;

    balances: SpvVaultTokenBalance[];

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
        } else {
            this.state = chainIdOrObj.state;
            this.chainId = chainIdOrObj.chainId;
            this.data = SpvVaultData.deserialize<T>(chainIdOrObj.data);
            this.initialUtxo = chainIdOrObj.initialUtxo;
            this.btcAddress = chainIdOrObj.btcAddress;
            this.pendingWithdrawals = chainIdOrObj.pendingWithdrawals.map(SpvWithdrawalTransactionData.deserialize<D>);
        }
        this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
    }

    update(event: SpvVaultOpenEvent | SpvVaultDepositEvent | SpvVaultCloseEvent | SpvVaultClaimEvent): void {
        this.data.updateState(event);
        this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
    }

    addWithdrawal(withdrawalData: D): void {
        this.pendingWithdrawals.push(withdrawalData);
        this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
    }

    removeWithdrawal(withdrawalData: D): boolean {
        const index = this.pendingWithdrawals.indexOf(withdrawalData);
        if(index===-1) return false;
        this.pendingWithdrawals.splice(index, 1);
        this.balances = this.data.calculateStateAfter(this.pendingWithdrawals).balances;
        return true;
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

    serialize(): any {
        return {
            state: this.state,
            chainId: this.chainId,
            data: this.data.serialize(),
            initialUtxo: this.initialUtxo,
            btcAddress: this.btcAddress,
            pendingWithdrawals: this.pendingWithdrawals.map(val => val.serialize())
        }
    }

    getIdentifier(): string {
        return this.chainId+"_"+this.data.getOwner()+"_"+this.data.getVaultId().toString(10);
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

    /**
     * Returns whether the vault is ready for the next swap
     */
    isReady(): boolean {
        return this.data.isOpened() && this.getLatestUtxo()!=null;
    }

}
