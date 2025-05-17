import { Express } from "express";
import { FromBtcSwapAbs, FromBtcSwapState } from "./FromBtcSwapAbs";
import { MultichainData, SwapHandlerType } from "../../SwapHandler";
import { ISwapPrice } from "../../../prices/ISwapPrice";
import { ChainSwapType, ClaimEvent, InitializeEvent, RefundEvent, SwapData } from "@atomiqlabs/base";
import { IIntermediaryStorage } from "../../../storage/IIntermediaryStorage";
import { FromBtcBaseConfig, FromBtcBaseSwapHandler } from "../FromBtcBaseSwapHandler";
import { IBitcoinWallet } from "../../../wallets/IBitcoinWallet";
export type FromBtcConfig = FromBtcBaseConfig & {
    confirmations: number;
    swapCsvDelta: number;
};
export type FromBtcRequestType = {
    address: string;
    amount: bigint;
    token: string;
    sequence: bigint;
    exactOut?: boolean;
};
/**
 * Swap handler handling from BTC swaps using PTLCs (proof-time locked contracts) and btc relay (on-chain bitcoin SPV)
 */
export declare class FromBtcAbs extends FromBtcBaseSwapHandler<FromBtcSwapAbs, FromBtcSwapState> {
    readonly type = SwapHandlerType.FROM_BTC;
    readonly swapType = ChainSwapType.CHAIN;
    readonly config: FromBtcConfig & {
        swapTsCsvDelta: bigint;
    };
    readonly bitcoin: IBitcoinWallet;
    constructor(storageDirectory: IIntermediaryStorage<FromBtcSwapAbs>, path: string, chains: MultichainData, bitcoin: IBitcoinWallet, swapPricing: ISwapPrice, config: FromBtcConfig);
    /**
     * Returns the payment hash of the swap, takes swap nonce into account. Payment hash is chain-specific.
     *
     * @param chainIdentifier
     * @param address
     * @param amount
     */
    private getHash;
    /**
     * Processes past swap
     *
     * @param swap
     * @protected
     * @returns true if the swap should be refunded, false if nothing should be done
     */
    protected processPastSwap(swap: FromBtcSwapAbs): Promise<boolean>;
    /**
     * Checks past swaps, refunds and deletes ones that are already expired.
     */
    protected processPastSwaps(): Promise<void>;
    /**
     * Refunds all swaps (calls SC on-chain refund function)
     *
     * @param refundSwaps
     * @protected
     */
    protected refundSwaps(refundSwaps: FromBtcSwapAbs[]): Promise<void>;
    protected processInitializeEvent(chainIdentifier: string, savedSwap: FromBtcSwapAbs, event: InitializeEvent<SwapData>): Promise<void>;
    protected processClaimEvent(chainIdentifier: string, savedSwap: FromBtcSwapAbs, event: ClaimEvent<SwapData>): Promise<void>;
    protected processRefundEvent(chainIdentifier: string, savedSwap: FromBtcSwapAbs, event: RefundEvent<SwapData>): Promise<void>;
    /**
     * Calculates the requested claimer bounty, based on client's request
     *
     * @param req
     * @param expiry
     * @param signal
     * @throws {DefinedRuntimeError} will throw an error if the plugin cancelled the request
     * @returns {Promise<BN>} resulting claimer bounty to be used with the swap
     */
    private getClaimerBounty;
    private getDummySwapData;
    /**
     * Sets up required listeners for the REST server
     *
     * @param restServer
     */
    startRestServer(restServer: Express): void;
    /**
     * Initializes swap handler, loads data and subscribes to chain events
     */
    init(): Promise<void>;
    getInfoData(): any;
}
