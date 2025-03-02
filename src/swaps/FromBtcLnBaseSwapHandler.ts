import {SwapHandlerSwap} from "./SwapHandlerSwap";
import {SwapData} from "@atomiqlabs/base";
import {FromBtcBaseSwapHandler} from "./FromBtcBaseSwapHandler";
import {ILightningWallet, LightningNetworkChannel} from "../wallets/ILightningWallet";
import {IIntermediaryStorage} from "../storage/IIntermediaryStorage";
import {MultichainData} from "./SwapHandler";
import {ISwapPrice} from "./ISwapPrice";


export abstract class FromBtcLnBaseSwapHandler<V extends SwapHandlerSwap<SwapData, S>, S> extends FromBtcBaseSwapHandler<V, S> {

    readonly lightning: ILightningWallet;

    constructor(
        storageDirectory: IIntermediaryStorage<V>,
        path: string,
        chains: MultichainData,
        lightning: ILightningWallet,
        swapPricing: ISwapPrice
    ) {
        super(storageDirectory, path, chains, swapPricing);
        this.lightning = lightning;
    }

    /**
     * Checks if we have enough inbound liquidity to be able to receive an LN payment (without MPP)
     *
     * @param amountBD
     * @param channelsPrefetch
     * @param signal
     * @throws {DefinedRuntimeError} will throw an error if there isn't enough inbound liquidity to receive the LN payment
     */
    protected async checkInboundLiquidity(amountBD: bigint, channelsPrefetch: Promise<LightningNetworkChannel[]>, signal: AbortSignal) {
        const channelsResponse = await channelsPrefetch;

        signal.throwIfAborted();

        let hasEnoughInboundLiquidity = false;
        channelsResponse.forEach(channel => {
            if(channel.remoteBalance >= amountBD) hasEnoughInboundLiquidity = true;
        });
        if(!hasEnoughInboundLiquidity) {
            throw {
                code: 20050,
                msg: "Not enough LN inbound liquidity"
            };
        }
    }

    /**
     * Starts LN channels pre-fetch
     *
     * @param abortController
     */
    protected getChannelsPrefetch(abortController: AbortController): Promise<LightningNetworkChannel[]> {
        return this.lightning.getChannels(true).catch(e => {
            this.logger.error("getChannelsPrefetch(): error", e);
            abortController.abort(e);
            return null;
        });
    }

}