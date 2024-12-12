/// <reference types="node" />
import { BitcoinUtxo, IBitcoinWallet, SignPsbtResponse } from "../wallets/IBitcoinWallet";
import { LNDClient, LNDConfig } from "./LNDClient";
import BN from "bn.js";
import { BtcTx } from "@atomiqlabs/base";
import { Network, Psbt } from "bitcoinjs-lib";
import { IBtcFeeEstimator } from "../fees/IBtcFeeEstimator";
import * as bitcoin from "bitcoinjs-lib";
export type LNDBitcoinWalletConfig = {
    network?: Network;
    feeEstimator?: IBtcFeeEstimator;
    onchainReservedPerChannel?: number;
};
export declare class LNDBitcoinWallet implements IBitcoinWallet {
    protected readonly LND_ADDRESS_TYPE_ENUM: {
        p2wpkh: number;
        "p2sh-p2wpkh": number;
        p2tr: number;
    };
    protected readonly ADDRESS_FORMAT_MAP: {
        p2wpkh: string;
        np2wpkh: string;
        p2tr: string;
    };
    protected readonly CHANGE_ADDRESS_TYPE = "p2tr";
    protected readonly RECEIVE_ADDRESS_TYPE = "p2wpkh";
    protected readonly CONFIRMATIONS_REQUIRED = 1;
    protected readonly UTXO_CACHE_TIMEOUT: number;
    cachedUtxos: {
        utxos: BitcoinUtxo[];
        timestamp: number;
    };
    readonly CHANNEL_COUNT_CACHE_TIMEOUT: number;
    cachedChannelCount: {
        count: number;
        timestamp: number;
    };
    private readonly lndClient;
    readonly config: LNDBitcoinWalletConfig;
    constructor(lndConfig: LNDConfig, config?: LNDBitcoinWalletConfig);
    constructor(client: LNDClient, config?: LNDBitcoinWalletConfig);
    init(): Promise<void>;
    toOutputScript(_address: string): Buffer;
    getBlockheight(): Promise<number>;
    getFeeRate(): Promise<number>;
    getAddressType(): "p2wpkh" | "p2sh-p2wpkh" | "p2tr";
    getAddress(): Promise<string>;
    getRequiredReserve(useCached?: boolean): Promise<number>;
    getWalletTransactions(startHeight?: number): Promise<BtcTx[]>;
    getWalletTransaction(txId: string): Promise<BtcTx | null>;
    subscribeToWalletTransactions(callback: (tx: BtcTx) => void, abortSignal?: AbortSignal): void;
    getUtxos(useCached?: boolean): Promise<BitcoinUtxo[]>;
    sendRawTransaction(tx: string): Promise<void>;
    signPsbt(psbt: Psbt): Promise<SignPsbtResponse>;
    /**
     * Computes bitcoin on-chain network fee, takes channel reserve & network fee multiplier into consideration
     *
     * @param targetAddress Bitcoin address to send the funds to
     * @param targetAmount Amount of funds to send to the address
     * @param estimate Whether the chain fee should be just estimated and therefore cached utxo set could be used
     * @param multiplier Multiplier for the sats/vB returned from the fee estimator
     * @param feeRate Fee rate in sats/vB to use for the transaction
     * @private
     * @returns Fee estimate & inputs/outputs to use when constructing transaction, or null in case of not enough funds
     */
    private getChainFee;
    /**
     * Gets the change address from the underlying LND instance
     *
     * @private
     */
    getChangeAddress(): Promise<string>;
    /**
     * Create PSBT for swap payout from coinselection result
     *
     * @param nonce
     * @param coinselectResult
     * @private
     */
    private getPsbt;
    /**
     * Runs sanity check on the calculated fee for the transaction
     *
     * @param psbt
     * @param tx
     * @param maxAllowedSatsPerVbyte
     * @param actualSatsPerVbyte
     * @private
     * @throws {Error} Will throw an error if the fee sanity check doesn't pass
     */
    protected checkPsbtFee(psbt: bitcoin.Psbt, tx: bitcoin.Transaction, maxAllowedSatsPerVbyte: number, actualSatsPerVbyte: number): void;
    getSignedTransaction(destination: string, amount: number, feeRate?: number, nonce?: BN, maxAllowedFeeRate?: number): Promise<SignPsbtResponse>;
    drainAll(_destination: string | Buffer, inputs: Omit<BitcoinUtxo, "address">[], feeRate?: number): Promise<SignPsbtResponse>;
    burnAll(inputs: Omit<BitcoinUtxo, "address">[]): Promise<SignPsbtResponse>;
    estimateFee(destination: string, amount: number, feeRate?: number, feeRateMultiplier?: number): Promise<{
        satsPerVbyte: number;
        networkFee: number;
    }>;
}