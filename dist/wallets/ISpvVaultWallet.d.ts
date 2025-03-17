/// <reference types="node" />
import { Command } from "@atomiqlabs/server-base";
import { Transaction } from "@scure/btc-signer";
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
export interface ISpvVaultSigner {
    init(): Promise<void>;
    isReady(): boolean;
    getStatus(): string;
    getStatusInfo(): Promise<Record<string, string>>;
    getCommands(): Command<any>[];
    getAddressType(): "p2wpkh" | "p2sh-p2wpkh" | "p2tr";
    /**
     * Returns an unused address suitable for receiving
     */
    getAddress(vaultId: bigint): Promise<string>;
    signPsbt(vaultId: bigint, psbt: Transaction): Promise<SignPsbtResponse>;
    sendRawTransaction(tx: string): Promise<void>;
    getSignedTransaction(destination: string, amount: number, feeRate?: number, nonce?: bigint, maxAllowedFeeRate?: number): Promise<SignPsbtResponse>;
    estimateFee(destination: string, amount: number, feeRate?: number, feeRateMultiplier?: number): Promise<{
        satsPerVbyte: number;
        networkFee: number;
    }>;
    drainAll(destination: string | Buffer, inputs: Omit<BitcoinUtxo, "address">[], feeRate?: number): Promise<SignPsbtResponse>;
    burnAll(inputs: Omit<BitcoinUtxo, "address">[]): Promise<SignPsbtResponse>;
    getBlockheight(): Promise<number>;
    getFeeRate(): Promise<number>;
}
