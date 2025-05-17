import {MultichainData, SwapBaseConfig} from "../SwapHandler";
import {SwapData} from "@atomiqlabs/base";
import {ServerParamEncoder} from "../../utils/paramcoders/server/ServerParamEncoder";
import {IParamReader} from "../../utils/paramcoders/IParamReader";
import {FieldTypeEnum} from "../../utils/paramcoders/SchemaVerifier";
import {Request} from "express";
import {ToBtcBaseSwap} from "./ToBtcBaseSwap";
import {EscrowHandler} from "./EscrowHandler";
import {ToBtcAmountAssertions} from "../assertions/ToBtcAmountAssertions";
import {IIntermediaryStorage} from "../../storage/IIntermediaryStorage";
import {ISwapPrice} from "../../prices/ISwapPrice";

export type ToBtcBaseConfig = SwapBaseConfig & {
    gracePeriod: bigint,
    refundAuthorizationTimeout: number
};

export abstract class ToBtcBaseSwapHandler<V extends ToBtcBaseSwap<SwapData, S>, S> extends EscrowHandler<V, S> {

    readonly AmountAssertions: ToBtcAmountAssertions;

    readonly pdaExistsForToken: {
        [chainIdentifier: string]: {
            [token: string]: boolean
        }
    } = {};

    constructor(
        storageDirectory: IIntermediaryStorage<V>,
        path: string,
        chainsData: MultichainData,
        swapPricing: ISwapPrice,
        config: ToBtcBaseConfig
    ) {
        super(storageDirectory, path, chainsData, swapPricing);
        this.AmountAssertions = new ToBtcAmountAssertions(config, swapPricing);
    }

    protected async checkVaultInitialized(chainIdentifier: string, token: string): Promise<void> {
        if(!this.pdaExistsForToken[chainIdentifier] || !this.pdaExistsForToken[chainIdentifier][token]) {
            this.logger.debug("checkVaultInitialized(): checking vault exists for chain: "+chainIdentifier+" token: "+token);
            const {swapContract, signer} = this.getChain(chainIdentifier);
            const reputation = await swapContract.getIntermediaryReputation(signer.getAddress(), token);
            this.logger.debug("checkVaultInitialized(): vault state, chain: "+chainIdentifier+" token: "+token+" exists: "+(reputation!=null));
            if(reputation!=null) {
                if(this.pdaExistsForToken[chainIdentifier]==null) this.pdaExistsForToken[chainIdentifier] = {};
                this.pdaExistsForToken[chainIdentifier][token] = true;
            } else {
                throw {
                    code: 20201,
                    msg: "Token not supported!"
                };
            }
        }
    }

    /**
     * Starts pre-fetches for swap pricing & signature data
     *
     * @param chainIdentifier
     * @param token
     * @param responseStream
     * @param abortController
     */
    protected getToBtcPrefetches(chainIdentifier: string, token: string, responseStream: ServerParamEncoder, abortController: AbortController): {
        pricePrefetchPromise?: Promise<bigint>,
        signDataPrefetchPromise?: Promise<any>
    } {
        //Fetch pricing & signature data in parallel
        const pricePrefetchPromise: Promise<bigint> = this.swapPricing.preFetchPrice(token, chainIdentifier).catch(e => {
            this.logger.error("getToBtcPrefetches(): pricePrefetch error", e);
            abortController.abort(e);
            return null;
        });

        return {
            pricePrefetchPromise,
            signDataPrefetchPromise: this.getSignDataPrefetch(chainIdentifier, abortController, responseStream)
        }
    }

    /**
     * Signs the created swap
     *
     * @param chainIdentifier
     * @param swapObject
     * @param req
     * @param abortSignal
     * @param signDataPrefetchPromise
     */
    protected async getToBtcSignatureData(
        chainIdentifier: string,
        swapObject: SwapData,
        req: Request & {paramReader: IParamReader},
        abortSignal: AbortSignal,
        signDataPrefetchPromise?: Promise<any>
    ): Promise<{
        prefix: string,
        timeout: string,
        signature: string,
        feeRate: string
    }> {
        const prefetchedSignData = signDataPrefetchPromise!=null ? await signDataPrefetchPromise : null;
        if(prefetchedSignData!=null) this.logger.debug("getToBtcSignatureData(): pre-fetched signature data: ", prefetchedSignData);
        abortSignal.throwIfAborted();

        const feeRateObj = await req.paramReader.getParams({
            feeRate: FieldTypeEnum.String
        }).catch(() => null);
        abortSignal.throwIfAborted();

        const feeRate = feeRateObj?.feeRate!=null && typeof(feeRateObj.feeRate)==="string" ? feeRateObj.feeRate : null;
        this.logger.debug("getToBtcSignatureData(): using fee rate from client: ", feeRate);
        const {swapContract, signer} = this.getChain(chainIdentifier);
        const sigData = await swapContract.getInitSignature(
            signer,
            swapObject,
            this.getInitAuthorizationTimeout(chainIdentifier),
            prefetchedSignData,
            feeRate
        );
        abortSignal.throwIfAborted();

        return {
            ...sigData,
            feeRate
        };
    }

}