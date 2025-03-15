import { Express } from "express";
import { ToBtcSwapAbs, ToBtcSwapState } from "./ToBtcSwapAbs";
import { MultichainData, SwapHandlerType } from "../../SwapHandler";
import { ISwapPrice } from "../../../prices/ISwapPrice";
import { BtcTx, ChainSwapType, ClaimEvent, InitializeEvent, RefundEvent, SwapData, BitcoinRpc, BtcBlock } from "@atomiqlabs/base";
import { IIntermediaryStorage } from "../../../storage/IIntermediaryStorage";
import { ToBtcBaseConfig, ToBtcBaseSwapHandler } from "../ToBtcBaseSwapHandler";
import { PromiseQueue } from "promise-queue-ts";
import { IBitcoinWallet } from "../../../wallets/IBitcoinWallet";
export type ToBtcConfig = ToBtcBaseConfig & {
    sendSafetyFactor: bigint;
    minChainCltv: bigint;
    networkFeeMultiplier: number;
    minConfirmations: number;
    maxConfirmations: number;
    maxConfTarget: number;
    minConfTarget: number;
    txCheckInterval: number;
};
export type ToBtcRequestType = {
    address: string;
    amount: bigint;
    confirmationTarget: number;
    confirmations: number;
    nonce: bigint;
    token: string;
    offerer: string;
    exactIn?: boolean;
};
/**
 * Handler for to BTC swaps, utilizing PTLCs (proof-time locked contracts) using btc relay (on-chain bitcoin SPV)
 */
export declare class ToBtcAbs extends ToBtcBaseSwapHandler<ToBtcSwapAbs, ToBtcSwapState> {
    readonly type = SwapHandlerType.TO_BTC;
    readonly swapType = ChainSwapType.CHAIN_NONCED;
    activeSubscriptions: {
        [txId: string]: ToBtcSwapAbs;
    };
    bitcoinRpc: BitcoinRpc<BtcBlock>;
    bitcoin: IBitcoinWallet;
    sendBtcQueue: PromiseQueue;
    readonly config: ToBtcConfig;
    constructor(storageDirectory: IIntermediaryStorage<ToBtcSwapAbs>, path: string, chainData: MultichainData, bitcoin: IBitcoinWallet, swapPricing: ISwapPrice, bitcoinRpc: BitcoinRpc<BtcBlock>, config: ToBtcConfig);
    /**
     * Returns the payment hash of the swap, takes swap nonce into account. Payment hash is chain-specific.
     *
     * @param chainIdentifier
     * @param address
     * @param confirmations
     * @param nonce
     * @param amount
     */
    private getHash;
    /**
     * Tries to claim the swap after our transaction was confirmed
     *
     * @param tx
     * @param swap
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
    protected checkCalculatedTxFee(quotedSatsPerVbyte: bigint, actualSatsPerVbyte: bigint): void;
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
    protected processInitializeEvent(chainIdentifier: string, swap: ToBtcSwapAbs, event: InitializeEvent<SwapData>): Promise<void>;
    protected processClaimEvent(chainIdentifier: string, swap: ToBtcSwapAbs, event: ClaimEvent<SwapData>): Promise<void>;
    protected processRefundEvent(chainIdentifier: string, swap: ToBtcSwapAbs, event: RefundEvent<SwapData>): Promise<void>;
    /**
     * Returns required expiry delta for swap params
     *
     * @param confirmationTarget
     * @param confirmations
     */
    protected getExpiryFromCLTV(confirmationTarget: number, confirmations: number): bigint;
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
    protected checkExpired(swap: ToBtcSwapAbs): Promise<void>;
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
