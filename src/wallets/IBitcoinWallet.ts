import {Psbt, Transaction} from "bitcoinjs-lib";
import {BtcTx} from "@atomiqlabs/base";
import {Command} from "@atomiqlabs/server-base";

export type BitcoinUtxo = {
    address: string,
    type: "p2wpkh" | "p2sh-p2wpkh" | "p2tr",
    confirmations: number,
    outputScript: Buffer,
    value: number,
    txId: string,
    vout: number
};

export type SignPsbtResponse = {
    psbt: Psbt,
    tx: Transaction,
    raw: string,
    txId: string,
    networkFee: number
};

export interface IBitcoinWallet {

    init(): Promise<void>;

    isReady(): boolean;
    getStatus(): string;
    getStatusInfo(): Promise<Record<string, string>>;
    getCommands(): Command<any>[];

    toOutputScript(address: string): Buffer;

    getAddressType(): "p2wpkh" | "p2sh-p2wpkh" | "p2tr";
    /**
     * Returns an unused address suitable for receiving
     */
    getAddress(): Promise<string>;
    /**
     * Adds previously returned address (with getAddress call), to the pool of unused addresses
     * @param address
     */
    addUnusedAddress(address: string): Promise<void>;

    getUtxos(): Promise<BitcoinUtxo[]>;
    getBalance(): Promise<{confirmed: number, unconfirmed: number}>;
    /**
     * Returns required reserve amount that needs to be kept in the wallet (for e.g. lightning anchor channels)
     */
    getRequiredReserve(): Promise<number>;
    getWalletTransactions(startHeight?: number): Promise<BtcTx[]>;
    getWalletTransaction(txId: string): Promise<BtcTx | null>;
    subscribeToWalletTransactions(callback: (tx: BtcTx) => void, abortSignal?: AbortSignal): void;

    signPsbt(psbt: Psbt): Promise<SignPsbtResponse>;
    sendRawTransaction(tx: string): Promise<void>;
    getSignedTransaction(destination: string, amount: number, feeRate?: number, nonce?: bigint, maxAllowedFeeRate?: number): Promise<SignPsbtResponse>;
    estimateFee(destination: string, amount: number, feeRate?: number, feeRateMultiplier?: number): Promise<{satsPerVbyte: number, networkFee: number}>;
    drainAll(destination: string | Buffer, inputs: Omit<BitcoinUtxo, "address">[], feeRate?: number): Promise<SignPsbtResponse>;
    burnAll(inputs: Omit<BitcoinUtxo, "address">[]): Promise<SignPsbtResponse>;

    getBlockheight(): Promise<number>;
    getFeeRate(): Promise<number>;

}