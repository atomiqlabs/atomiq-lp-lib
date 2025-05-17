import { ILightningWallet, LightningNetworkChannel } from "../../wallets/ILightningWallet";
import { LoggerType } from "../../utils/Utils";
export declare class LightningAssertions {
    protected readonly LIGHTNING_LIQUIDITY_CACHE_TIMEOUT: number;
    lightningLiquidityCache: {
        liquidity: bigint;
        timestamp: number;
    };
    readonly lightning: ILightningWallet;
    readonly logger: LoggerType;
    constructor(logger: LoggerType, lightning: ILightningWallet);
    /**
     * Checks if the prior payment with the same paymentHash exists
     *
     * @param paymentHash
     * @param abortSignal
     * @throws {DefinedRuntimeError} will throw an error if payment already exists
     */
    checkPriorPayment(paymentHash: string, abortSignal: AbortSignal): Promise<void>;
    /**
     * Checks if the underlying LND backend has enough liquidity in channels to honor the swap
     *
     * @param amount
     * @param abortSignal
     * @param useCached Whether to use cached liquidity values
     * @throws {DefinedRuntimeError} will throw an error if there isn't enough liquidity
     */
    checkLiquidity(amount: bigint, abortSignal: AbortSignal, useCached?: boolean): Promise<void>;
    /**
     * Checks if we have enough inbound liquidity to be able to receive an LN payment (without MPP)
     *
     * @param amountBD
     * @param channelsPrefetch
     * @param signal
     * @throws {DefinedRuntimeError} will throw an error if there isn't enough inbound liquidity to receive the LN payment
     */
    checkInboundLiquidity(amountBD: bigint, channelsPrefetch: Promise<LightningNetworkChannel[]>, signal: AbortSignal): Promise<void>;
    /**
     * Starts LN channels pre-fetch
     *
     * @param abortController
     */
    getChannelsPrefetch(abortController: AbortController): Promise<LightningNetworkChannel[]>;
}
