import { Express } from "express";
import * as BN from "bn.js";
import * as bitcoin from "bitcoinjs-lib";
import { ToBtcSwapAbs, ToBtcSwapState } from "./ToBtcSwapAbs";
import { MultichainData, SwapHandlerType } from "../SwapHandler";
import { ISwapPrice } from "../ISwapPrice";
import { BtcTx, ClaimEvent, InitializeEvent, RefundEvent, SwapData, BitcoinRpc, BtcBlock } from "@atomiqlabs/base";
import { AuthenticatedLnd } from "lightning";
import { IIntermediaryStorage } from "../../storage/IIntermediaryStorage";
import { IBtcFeeEstimator } from "../../fees/IBtcFeeEstimator";
import { CoinselectTxInput, CoinselectTxOutput } from "../../utils/coinselect2/utils";
import { ToBtcBaseConfig, ToBtcBaseSwapHandler } from "../ToBtcBaseSwapHandler";
import { PromiseQueue } from "promise-queue-ts";
type SpendableUtxo = {
    address: string;
    address_format: string;
    confirmation_count: number;
    output_script: string;
    tokens: number;
    transaction_id: string;
    transaction_vout: number;
};
export type ToBtcConfig = ToBtcBaseConfig & {
    sendSafetyFactor: BN;
    bitcoinNetwork: bitcoin.networks.Network;
    minChainCltv: BN;
    networkFeeMultiplierPPM: BN;
    minConfirmations: number;
    maxConfirmations: number;
    maxConfTarget: number;
    minConfTarget: number;
    txCheckInterval: number;
    feeEstimator?: IBtcFeeEstimator;
    onchainReservedPerChannel?: number;
};
export type ToBtcRequestType = {
    address: string;
    amount: BN;
    confirmationTarget: number;
    confirmations: number;
    nonce: BN;
    token: string;
    offerer: string;
    exactIn?: boolean;
};
/**
 * Handler for to BTC swaps, utilizing PTLCs (proof-time locked contracts) using btc relay (on-chain bitcoin SPV)
 */
export declare class ToBtcAbs extends ToBtcBaseSwapHandler<ToBtcSwapAbs, ToBtcSwapState> {
    protected readonly CONFIRMATIONS_REQUIRED = 1;
    protected readonly ADDRESS_FORMAT_MAP: {
        p2wpkh: string;
        np2wpkh: string;
        p2tr: string;
    };
    protected readonly LND_CHANGE_OUTPUT_TYPE = "p2tr";
    protected readonly UTXO_CACHE_TIMEOUT: number;
    protected readonly CHANNEL_COUNT_CACHE_TIMEOUT: number;
    readonly type = SwapHandlerType.TO_BTC;
    activeSubscriptions: {
        [txId: string]: ToBtcSwapAbs;
    };
    cachedUtxos: {
        utxos: (CoinselectTxInput & {
            confirmations: number;
        })[];
        timestamp: number;
    };
    cachedChannelCount: {
        count: number;
        timestamp: number;
    };
    bitcoinRpc: BitcoinRpc<BtcBlock>;
    sendBtcQueue: PromiseQueue;
    readonly config: ToBtcConfig;
    constructor(storageDirectory: IIntermediaryStorage<ToBtcSwapAbs>, path: string, chainData: MultichainData, lnd: AuthenticatedLnd, swapPricing: ISwapPrice, bitcoinRpc: BitcoinRpc<BtcBlock>, config: ToBtcConfig);
    /**
     * Returns the payment hash of the swap, takes swap nonce into account. Payment hash is chain-specific.
     *
     * @param chainIdentifier
     * @param address
     * @param nonce
     * @param amount
     * @param bitcoinNetwork
     */
    private getHash;
    /**
     * Returns spendable UTXOs, these are either confirmed UTXOs, or unconfirmed ones that are either whitelisted,
     *  or created by our transactions (and therefore only we could doublespend)
     *
     * @private
     */
    protected getSpendableUtxos(): Promise<SpendableUtxo[]>;
    /**
     * Returns utxo pool to be used by the coinselection algorithm
     *
     * @private
     */
    protected getUtxoPool(useCached?: boolean): Promise<(CoinselectTxInput & {
        confirmations: number;
    })[]>;
    /**
     * Checks whether a coinselect result leaves enough funds to cover potential lightning anchor transaction fees
     *
     * @param utxoPool
     * @param obj
     * @param satsPerVbyte
     * @param useCached Whether to use a cached channel count
     * @param initialOutputLength
     * @private
     * @returns true if alright, false if the coinselection doesn't leave enough funds for anchor fees
     */
    protected isLeavingEnoughForLightningAnchors(utxoPool: CoinselectTxInput[], obj: {
        inputs?: CoinselectTxInput[];
        outputs?: CoinselectTxOutput[];
    }, satsPerVbyte: BN, useCached?: boolean, initialOutputLength?: number): Promise<boolean>;
    /**
     * Gets the change address from the underlying LND instance
     *
     * @private
     */
    protected getChangeAddress(): Promise<string>;
    /**
     * Computes bitcoin on-chain network fee, takes channel reserve & network fee multiplier into consideration
     *
     * @param targetAddress Bitcoin address to send the funds to
     * @param targetAmount Amount of funds to send to the address
     * @param estimate Whether the chain fee should be just estimated and therefore cached utxo set could be used
     * @param multiplierPPM Multiplier for the sats/vB returned from the fee estimator in PPM (parts per million)
     * @private
     * @returns Fee estimate & inputs/outputs to use when constructing transaction, or null in case of not enough funds
     */
    private getChainFee;
    /**
     * Tries to claim the swap after our transaction was confirmed
     *
     * @param tx
     * @param payment
     * @param vout
     */
    private tryClaimSwap;
    protected processPastSwap(swap: ToBtcSwapAbs): Promise<void>;
    /**
     * Checks past swaps, deletes ones that are already expired.
     */
    protected processPastSwaps(): Promise<void>;
    protected processBtcTx(swap: ToBtcSwapAbs, tx: BtcTx): Promise<boolean>;
    /**
     * Checks active sent out bitcoin transactions
     */
    private processBtcTxs;
    /**
     * Subscribes to and periodically checks txId used to send out funds for the swap for enough confirmations
     *
     * @param payment
     */
    protected subscribeToPayment(payment: ToBtcSwapAbs): void;
    protected unsubscribePayment(payment: ToBtcSwapAbs): void;
    /**
     * Checks if expiry time on the swap leaves us enough room to send a transaction and for the transaction to confirm
     *
     * @param swap
     * @private
     * @throws DefinedRuntimeError will throw an error in case there isn't enough time for us to send a BTC payout tx
     */
    protected checkExpiresTooSoon(swap: ToBtcSwapAbs): void;
    /**
     * Checks if the actual fee for the swap is no higher than the quoted estimate
     *
     * @param quotedSatsPerVbyte
     * @param actualSatsPerVbyte
     * @private
     * @throws DefinedRuntimeError will throw an error in case the actual fee is higher than quoted fee
     */
    protected checkCalculatedTxFee(quotedSatsPerVbyte: BN, actualSatsPerVbyte: BN): void;
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
    protected checkPsbtFee(psbt: bitcoin.Psbt, tx: bitcoin.Transaction, maxAllowedSatsPerVbyte: BN, actualSatsPerVbyte: BN): BN;
    /**
     * Create PSBT for swap payout from coinselection result
     *
     * @param address
     * @param amount
     * @param escrowNonce
     * @param coinselectResult
     * @private
     */
    private getPsbt;
    /**
     * Signs provided PSBT and also returns a raw signed transaction
     *
     * @param psbt
     * @private
     */
    protected signPsbt(psbt: bitcoin.Psbt): Promise<{
        psbt: bitcoin.Psbt;
        rawTx: string;
    }>;
    /**
     * Sends raw bitcoin transaction
     *
     * @param rawTx
     * @private
     */
    protected sendRawTransaction(rawTx: string): Promise<void>;
    /**
     * Sends a bitcoin transaction to payout BTC for a swap
     *
     * @param swap
     * @private
     * @throws DefinedRuntimeError will throw an error in case the payment cannot be initiated
     */
    private sendBitcoinPayment;
    /**
     * Called after swap was successfully committed, will check if bitcoin tx is already sent, if not tries to send it and subscribes to it
     *
     * @param swap
     */
    private processInitialized;
    protected processInitializeEvent(chainIdentifier: string, event: InitializeEvent<SwapData>): Promise<void>;
    protected processClaimEvent(chainIdentifier: string, event: ClaimEvent<SwapData>): Promise<void>;
    protected processRefundEvent(chainIdentifier: string, event: RefundEvent<SwapData>): Promise<void>;
    /**
     * Returns required expiry delta for swap params
     *
     * @param confirmationTarget
     * @param confirmations
     */
    protected getExpiryFromCLTV(confirmationTarget: number, confirmations: number): BN;
    /**
     * Checks if the requested nonce is valid
     *
     * @param nonce
     * @throws {DefinedRuntimeError} will throw an error if the nonce is invalid
     */
    private checkNonceValid;
    /**
     * Checks if confirmation target is within configured bounds
     *
     * @param confirmationTarget
     * @throws {DefinedRuntimeError} will throw an error if the confirmationTarget is out of bounds
     */
    protected checkConfirmationTarget(confirmationTarget: number): void;
    /**
     * Checks if the required confirmations are within configured bounds
     *
     * @param confirmations
     * @throws {DefinedRuntimeError} will throw an error if the confirmations are out of bounds
     */
    protected checkRequiredConfirmations(confirmations: number): void;
    /**
     * Checks the validity of the provided address, also checks if the resulting output script isn't too large
     *
     * @param address
     * @throws {DefinedRuntimeError} will throw an error if the address is invalid
     */
    protected checkAddress(address: string): void;
    /**
     * Checks if the swap is expired, taking into consideration on-chain time skew
     *
     * @param swap
     * @throws {DefinedRuntimeError} will throw an error if the swap is expired
     */
    protected checkExpired(swap: ToBtcSwapAbs): void;
    /**
     * Checks & returns the network fee needed for a transaction
     *
     * @param address
     * @param amount
     * @throws {DefinedRuntimeError} will throw an error if there are not enough BTC funds
     */
    private checkAndGetNetworkFee;
    startRestServer(restServer: Express): void;
    /**
     * Starts watchdog checking sent bitcoin transactions
     */
    protected startTxTimer(): Promise<void>;
    startWatchdog(): Promise<void>;
    init(): Promise<void>;
    getInfoData(): any;
}
export {};
