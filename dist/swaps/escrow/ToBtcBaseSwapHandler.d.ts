import { MultichainData, SwapBaseConfig } from "../SwapHandler";
import { SwapData } from "@atomiqlabs/base";
import { ServerParamEncoder } from "../../utils/paramcoders/server/ServerParamEncoder";
import { IParamReader } from "../../utils/paramcoders/IParamReader";
import { Request } from "express";
import { ToBtcBaseSwap } from "./ToBtcBaseSwap";
import { EscrowHandler } from "./EscrowHandler";
import { ToBtcAmountAssertions } from "../assertions/ToBtcAmountAssertions";
import { IIntermediaryStorage } from "../../storage/IIntermediaryStorage";
import { ISwapPrice } from "../../prices/ISwapPrice";
export type ToBtcBaseConfig = SwapBaseConfig & {
    gracePeriod: bigint;
    refundAuthorizationTimeout: number;
};
export declare abstract class ToBtcBaseSwapHandler<V extends ToBtcBaseSwap<SwapData, S>, S> extends EscrowHandler<V, S> {
    readonly AmountAssertions: ToBtcAmountAssertions;
    readonly pdaExistsForToken: {
        [chainIdentifier: string]: {
            [token: string]: boolean;
        };
    };
    constructor(storageDirectory: IIntermediaryStorage<V>, path: string, chainsData: MultichainData, swapPricing: ISwapPrice, config: ToBtcBaseConfig);
    protected checkVaultInitialized(chainIdentifier: string, token: string): Promise<void>;
    /**
     * Starts pre-fetches for swap pricing & signature data
     *
     * @param chainIdentifier
     * @param token
     * @param responseStream
     * @param abortController
     */
    protected getToBtcPrefetches(chainIdentifier: string, token: string, responseStream: ServerParamEncoder, abortController: AbortController): {
        pricePrefetchPromise?: Promise<bigint>;
        signDataPrefetchPromise?: Promise<any>;
    };
    /**
     * Signs the created swap
     *
     * @param chainIdentifier
     * @param swapObject
     * @param req
     * @param abortSignal
     * @param signDataPrefetchPromise
     */
    protected getToBtcSignatureData(chainIdentifier: string, swapObject: SwapData, req: Request & {
        paramReader: IParamReader;
    }, abortSignal: AbortSignal, signDataPrefetchPromise?: Promise<any>): Promise<{
        prefix: string;
        timeout: string;
        signature: string;
        feeRate: string;
    }>;
}
