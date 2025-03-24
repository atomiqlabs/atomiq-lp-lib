import { Transaction } from "@scure/btc-signer";
export interface ISpvVaultSigner {
    init(): Promise<void>;
    getAddressType(): "p2wpkh" | "p2tr";
    getAddress(chainId: string, vaultId: bigint): Promise<string>;
    signPsbt(chainId: string, vaultId: bigint, psbt: Transaction, inputs: number[]): Promise<Transaction>;
}
