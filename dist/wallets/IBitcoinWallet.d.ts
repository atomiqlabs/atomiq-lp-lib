/// <reference types="node" />
import { BtcTx } from "@atomiqlabs/base";
import { Command } from "@atomiqlabs/server-base";
import { Transaction } from "@scure/btc-signer";
import { BTC_NETWORK } from "@scure/btc-signer/utils";
export type BitcoinUtxo = {
    address: string;
    type: "p2wpkh" | "p2sh-p2wpkh" | "p2tr";
    confirmations: number;
    outputScript: Buffer;
    value: number;
    txId: string;
    vout: number;
};
export type SignPsbtResponse = {
    psbt: Transaction;
    tx: Transaction;
    raw: string;
    txId: string;
    networkFee: number;
};
export declare abstract class IBitcoinWallet {
    readonly network: BTC_NETWORK;
    protected constructor(network: BTC_NETWORK);
    toOutputScript(address: string): Buffer;
    getSignedTransaction(destination: string, amount: number, feeRate?: number, nonce?: bigint, maxAllowedFeeRate?: number): Promise<SignPsbtResponse>;
    getSignedMultiTransaction(destinations: {
        address: string;
        amount: number;
    }[], feeRate?: number, nonce?: bigint, maxAllowedFeeRate?: number): Promise<SignPsbtResponse>;
    estimateFee(destination: string, amount: number, feeRate?: number, feeRateMultiplier?: number): Promise<{
        satsPerVbyte: number;
        networkFee: number;
    }>;
    drainAll(destination: string | Buffer, inputs: Omit<BitcoinUtxo, "address">[], feeRate?: number): Promise<SignPsbtResponse>;
    burnAll(inputs: Omit<BitcoinUtxo, "address">[]): Promise<SignPsbtResponse>;
    /**
     * Initializes the wallet, called before any actions on the wallet
     */
    abstract init(): Promise<void>;
    /**
     * Returns whether the wallet is ready
     */
    abstract isReady(): boolean;
    /**
     * Returns the status defined string to be displayed in the status message
     */
    abstract getStatus(): string;
    /**
     * Additional status information to be displayed in the status message
     */
    abstract getStatusInfo(): Promise<Record<string, string>>;
    /**
     * Returns the commands that will be exposed
     */
    abstract getCommands(): Command<any>[];
    /**
     * Returns the address type of the wallet
     */
    abstract getAddressType(): "p2wpkh" | "p2sh-p2wpkh" | "p2tr";
    /**
     * Returns an unused address suitable for receiving
     */
    abstract getAddress(): Promise<string>;
    /**
     * Adds previously returned address (with getAddress call), to the pool of unused addresses
     * @param address
     */
    abstract addUnusedAddress(address: string): Promise<void>;
    /**
     * Returns the wallet balance, separated between confirmed and unconfirmed balance (both in sats)
     */
    abstract getBalance(): Promise<{
        confirmed: number;
        unconfirmed: number;
    }>;
    /**
     * Returns the total spendable wallet balance in sats
     */
    abstract getSpendableBalance(): Promise<number>;
    /**
     * Returns all wallet transactions confirmed after the specified blockheight (includes also unconfirmed
     *  wallet transaction!!)
     *
     * @param startHeight
     */
    abstract getWalletTransactions(startHeight?: number): Promise<BtcTx[]>;
    /**
     * Returns the in-wallet transaction as identified by its transaction ID
     *
     * @param txId
     */
    abstract getWalletTransaction(txId: string): Promise<BtcTx | null>;
    /**
     * Subscribes to wallet transactions, should fire when transaction enters mempool, and then also
     *  for the first confirmation of the transactions
     *
     * @param callback
     * @param abortSignal
     */
    abstract subscribeToWalletTransactions(callback: (tx: BtcTx) => void, abortSignal?: AbortSignal): void;
    /**
     * Estimates a network fee (in sats), for sending a specific PSBT, the provided PSBT might not contain
     *  any inputs, hence the fee returned should also reflect the transaction size increase by adding
     *  wallet UTXOs as inputs
     *
     * @param psbt
     * @param feeRate
     */
    abstract estimatePsbtFee(psbt: Transaction, feeRate?: number): Promise<{
        satsPerVbyte: number;
        networkFee: number;
    }>;
    /**
     * Funds the provided PSBT (adds wallet UTXOs)
     *
     * @param psbt
     * @param feeRate
     * @param maxAllowedFeeRate
     */
    abstract fundPsbt(psbt: Transaction, feeRate?: number, maxAllowedFeeRate?: number): Promise<Transaction>;
    /**
     * Signs the provided PSBT
     *
     * @param psbt
     */
    abstract signPsbt(psbt: Transaction): Promise<SignPsbtResponse>;
    /**
     * Broadcasts a raw bitcoin hex encoded transaction
     *
     * @param tx
     */
    abstract sendRawTransaction(tx: string): Promise<void>;
    /**
     * Returns bitcoin network fee in sats/vB
     */
    abstract getFeeRate(): Promise<number>;
    /**
     * Returns the blockheight of the bitcoin chain
     */
    abstract getBlockheight(): Promise<number>;
    /**
     * Post a task to be executed on the sequential thread of the wallet, in case wallets requires
     *  the UTXOs staying consistent during operation, it is recommended to implement this function
     *
     * @param executor
     */
    execute(executor: () => Promise<void>): Promise<void>;
}
