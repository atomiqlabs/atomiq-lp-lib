import {SwapBaseConfig, SwapHandler} from "../SwapHandler";
import {
    ChainEvent, ChainSwapType, ClaimEvent, InitializeEvent, RefundEvent,
    SwapData,
    SwapEvent
} from "@atomiqlabs/base";
import {PluginManager} from "../../plugins/PluginManager";
import {EscrowHandlerSwap} from "./EscrowHandlerSwap";
import {ServerParamEncoder} from "../../utils/paramcoders/server/ServerParamEncoder";
import {SwapHandlerSwap} from "../SwapHandlerSwap";

export type ToBtcBaseConfig = SwapBaseConfig & {
    gracePeriod: bigint,
    refundAuthorizationTimeout: number
};

export abstract class EscrowHandler<V extends EscrowHandlerSwap<SwapData, S>, S> extends SwapHandler<V, S> {

    abstract readonly swapType: ChainSwapType;

    readonly escrowHashMap: Map<string, V> = new Map();

    protected swapLogger = {
        debug: (swap: SwapHandlerSwap | SwapEvent<SwapData> | SwapData, msg: string, ...args: any) => this.logger.debug(this.getIdentifier(swap)+": "+msg, ...args),
        info: (swap: SwapHandlerSwap | SwapEvent<SwapData> | SwapData, msg: string, ...args: any) => this.logger.info(this.getIdentifier(swap)+": "+msg, ...args),
        warn: (swap: SwapHandlerSwap | SwapEvent<SwapData> | SwapData, msg: string, ...args: any) => this.logger.warn(this.getIdentifier(swap)+": "+msg, ...args),
        error: (swap: SwapHandlerSwap | SwapEvent<SwapData> | SwapData, msg: string, ...args: any) => this.logger.error(this.getIdentifier(swap)+": "+msg, ...args)
    };

    protected abstract processInitializeEvent(chainIdentifier: string, swap: V, event: InitializeEvent<SwapData>): Promise<void>;
    protected abstract processClaimEvent(chainIdentifier: string, swap: V, event: ClaimEvent<SwapData>): Promise<void>;
    protected abstract processRefundEvent(chainIdentifier: string, swap: V, event: RefundEvent<SwapData>): Promise<void>;

    /**
     * Chain event processor
     *
     * @param chainIdentifier
     * @param eventData
     */
    protected async processEvent(chainIdentifier: string, eventData: ChainEvent<SwapData>[]): Promise<boolean> {
        if(this.swapType==null) return true;

        for(let event of eventData) {
            if(event instanceof InitializeEvent) {
                if(event.swapType!==this.swapType) continue;
                const swap = this.getSwapByEscrowHash(chainIdentifier, event.escrowHash);
                if(swap==null) continue;

                swap.txIds.init = event.meta?.txId;
                if(swap.metadata!=null) swap.metadata.times.initTxReceived = Date.now();

                await this.processInitializeEvent(chainIdentifier, swap, event);
            } else if(event instanceof ClaimEvent) {
                const swap = this.getSwapByEscrowHash(chainIdentifier, event.escrowHash);
                if(swap==null) continue;

                swap.txIds.claim = event.meta?.txId;
                if(swap.metadata!=null) swap.metadata.times.claimTxReceived = Date.now();

                await this.processClaimEvent(chainIdentifier, swap, event);
            } else if(event instanceof RefundEvent) {
                const swap = this.getSwapByEscrowHash(chainIdentifier, event.escrowHash);
                if(swap==null) continue;

                swap.txIds.refund = event.meta?.txId;
                if(swap.metadata!=null) swap.metadata.times.refundTxReceived = Date.now();

                await this.processRefundEvent(chainIdentifier, swap, event);
            }
        }

        return true;
    }

    /**
     * Initializes chain events subscription
     */
    protected subscribeToEvents() {
        for(let key in this.chains.chains) {
            this.chains.chains[key].chainEvents.registerListener((events: ChainEvent<SwapData>[]) => this.processEvent(key, events));
        }
        this.logger.info("SC: Events: subscribed to smartchain events");
    }

    protected async loadData(ctor: new (data: any) => V) {
        await super.loadData(ctor);
        for(let {obj: swap, hash, sequence} of await this.storageManager.query([])) {
            this.saveSwapToEscrowHashMap(swap);
        }
    }

    protected async removeSwapData(swap: V, ultimateState?: S) {
        this.inflightSwaps.delete(swap.getIdentifier());
        this.logger.debug("removeSwapData(): Removing in-flight swap, current in-flight swaps: "+this.inflightSwaps.size);
        if(ultimateState!=null) await swap.setState(ultimateState);
        if(swap!=null) await PluginManager.swapRemove(swap);
        this.swapLogger.debug(swap, "removeSwapData(): removing swap final state: "+swap.state);
        this.removeSwapFromEscrowHashMap(swap);
        await this.storageManager.removeData(swap.getIdentifierHash(), swap.getSequence());
    }

    protected async saveSwapData(swap: V) {
        this.saveSwapToEscrowHashMap(swap);
        return super.saveSwapData(swap);
    }

    protected saveSwapToEscrowHashMap(swap: V) {
        if(swap.data!=null) this.escrowHashMap.set(swap.chainIdentifier+"_"+swap.getEscrowHash(), swap);
    }

    protected removeSwapFromEscrowHashMap(swap: V) {
        if(swap.data!=null) this.escrowHashMap.delete(swap.chainIdentifier+"_"+swap.getEscrowHash());
    }

    protected getSwapByEscrowHash(chainIdentifier: string, escrowHash: string) {
        return this.escrowHashMap.get(chainIdentifier+"_"+escrowHash);
    }

    protected getIdentifierFromEvent(event: SwapEvent<SwapData>): string {
        if(event instanceof SwapEvent) {
            const foundSwap = this.escrowHashMap.get(event.escrowHash);
            if(foundSwap!=null) {
                return foundSwap.getIdentifier();
            }
            return "UNKNOWN_"+event.escrowHash;
        }
    }

    protected getIdentifierFromSwapData(swapData: SwapData): string {
        if(swapData.getSequence==null) return swapData.getClaimHash();
        return swapData.getClaimHash()+"_"+swapData.getSequence().toString(16);
    }

    protected getIdentifier(swap: SwapHandlerSwap | SwapEvent<SwapData> | SwapData) {
        if(swap instanceof SwapHandlerSwap) {
            return swap.getIdentifier();
        }
        if(swap instanceof ChainEvent) {
            return this.getIdentifierFromEvent(swap);
        }
        return this.getIdentifierFromSwapData(swap);
    }

    /**
     * Starts a pre-fetch for signature data
     *
     * @param chainIdentifier
     * @param abortController
     * @param responseStream
     */
    protected getSignDataPrefetch(chainIdentifier: string, abortController: AbortController, responseStream?: ServerParamEncoder): Promise<any> {
        const {swapContract} = this.getChain(chainIdentifier);
        let signDataPrefetchPromise: Promise<any> = swapContract.preFetchBlockDataForSignatures!=null ? swapContract.preFetchBlockDataForSignatures().catch(e => {
            this.logger.error("getSignDataPrefetch(): signDataPrefetch: ", e);
            abortController.abort(e);
            return null;
        }) : null;

        if(signDataPrefetchPromise!=null && responseStream!=null) {
            signDataPrefetchPromise = signDataPrefetchPromise.then(val => val==null || abortController.signal.aborted ? null : responseStream.writeParams({
                signDataPrefetch: val
            }).then(() => val).catch(e => {
                this.logger.error("getSignDataPrefetch(): signDataPreFetch: error when sending sign data to the client: ", e);
                abortController.abort(e);
                return null;
            }));
        }

        return signDataPrefetchPromise;
    }

}
