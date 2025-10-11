import { SwapBaseConfig, SwapHandler } from "../SwapHandler";
import { ChainEvent, ChainSwapType, ClaimEvent, InitializeEvent, RefundEvent, SwapData, SwapEvent } from "@atomiqlabs/base";
import { EscrowHandlerSwap } from "./EscrowHandlerSwap";
import { ServerParamEncoder } from "../../utils/paramcoders/server/ServerParamEncoder";
import { SwapHandlerSwap } from "../SwapHandlerSwap";
export type ToBtcBaseConfig = SwapBaseConfig & {
    gracePeriod: bigint;
    refundAuthorizationTimeout: number;
};
export declare abstract class EscrowHandler<V extends EscrowHandlerSwap<SwapData, S>, S> extends SwapHandler<V, S> {
    abstract readonly swapType: ChainSwapType;
    readonly escrowHashMap: Map<string, V>;
    protected swapLogger: {
        debug: (swap: SwapHandlerSwap | SwapEvent<SwapData> | SwapData, msg: string, ...args: any) => void;
        info: (swap: SwapHandlerSwap | SwapEvent<SwapData> | SwapData, msg: string, ...args: any) => void;
        warn: (swap: SwapHandlerSwap | SwapEvent<SwapData> | SwapData, msg: string, ...args: any) => void;
        error: (swap: SwapHandlerSwap | SwapEvent<SwapData> | SwapData, msg: string, ...args: any) => void;
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
    protected processEvent(chainIdentifier: string, eventData: ChainEvent<SwapData>[]): Promise<boolean>;
    /**
     * Initializes chain events subscription
     */
    protected subscribeToEvents(): void;
    protected loadData(ctor: new (data: any) => V): Promise<void>;
    protected removeSwapData(swap: V, ultimateState?: S): Promise<void>;
    protected saveSwapData(swap: V): Promise<void>;
    protected saveSwapToEscrowHashMap(swap: V): void;
    protected removeSwapFromEscrowHashMap(swap: V): void;
    protected getSwapByEscrowHash(chainIdentifier: string, escrowHash: string): V;
    protected getIdentifierFromEvent(event: SwapEvent<SwapData>): string;
    protected getIdentifierFromSwapData(swapData: SwapData): string;
    protected getIdentifier(swap: SwapHandlerSwap | SwapEvent<SwapData> | SwapData): string;
    /**
     * Starts a pre-fetch for signature data
     *
     * @param chainIdentifier
     * @param abortController
     * @param responseStream
     */
    protected getSignDataPrefetch(chainIdentifier: string, abortController: AbortController, responseStream?: ServerParamEncoder): Promise<any>;
}
