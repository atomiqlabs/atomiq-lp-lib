"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToBtcBaseSwapHandler = void 0;
const SchemaVerifier_1 = require("../../utils/paramcoders/SchemaVerifier");
const EscrowHandler_1 = require("./EscrowHandler");
const ToBtcAmountAssertions_1 = require("../assertions/ToBtcAmountAssertions");
class ToBtcBaseSwapHandler extends EscrowHandler_1.EscrowHandler {
    constructor(storageDirectory, path, chainsData, swapPricing, config) {
        super(storageDirectory, path, chainsData, swapPricing);
        this.pdaExistsForToken = {};
        this.AmountAssertions = new ToBtcAmountAssertions_1.ToBtcAmountAssertions(config, swapPricing);
    }
    async checkVaultInitialized(chainIdentifier, token) {
        if (!this.pdaExistsForToken[chainIdentifier] || !this.pdaExistsForToken[chainIdentifier][token]) {
            this.logger.debug("checkVaultInitialized(): checking vault exists for chain: " + chainIdentifier + " token: " + token);
            const { swapContract, signer } = this.getChain(chainIdentifier);
            const reputation = await swapContract.getIntermediaryReputation(signer.getAddress(), token);
            this.logger.debug("checkVaultInitialized(): vault state, chain: " + chainIdentifier + " token: " + token + " exists: " + (reputation != null));
            if (reputation != null) {
                if (this.pdaExistsForToken[chainIdentifier] == null)
                    this.pdaExistsForToken[chainIdentifier] = {};
                this.pdaExistsForToken[chainIdentifier][token] = true;
            }
            else {
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
    getToBtcPrefetches(chainIdentifier, token, responseStream, abortController) {
        //Fetch pricing & signature data in parallel
        const pricePrefetchPromise = this.swapPricing.preFetchPrice(token, chainIdentifier).catch(e => {
            this.logger.error("getToBtcPrefetches(): pricePrefetch error", e);
            abortController.abort(e);
            return null;
        });
        return {
            pricePrefetchPromise,
            signDataPrefetchPromise: this.getSignDataPrefetch(chainIdentifier, abortController, responseStream)
        };
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
    async getToBtcSignatureData(chainIdentifier, swapObject, req, abortSignal, signDataPrefetchPromise) {
        const prefetchedSignData = signDataPrefetchPromise != null ? await signDataPrefetchPromise : null;
        if (prefetchedSignData != null)
            this.logger.debug("getToBtcSignatureData(): pre-fetched signature data: ", prefetchedSignData);
        abortSignal.throwIfAborted();
        const feeRateObj = await req.paramReader.getParams({
            feeRate: SchemaVerifier_1.FieldTypeEnum.String
        }).catch(() => null);
        abortSignal.throwIfAborted();
        const feeRate = feeRateObj?.feeRate != null && typeof (feeRateObj.feeRate) === "string" ? feeRateObj.feeRate : null;
        this.logger.debug("getToBtcSignatureData(): using fee rate from client: ", feeRate);
        const { swapContract, signer } = this.getChain(chainIdentifier);
        const sigData = await swapContract.getInitSignature(signer, swapObject, this.getInitAuthorizationTimeout(chainIdentifier), prefetchedSignData, feeRate);
        abortSignal.throwIfAborted();
        return {
            ...sigData,
            feeRate
        };
    }
}
exports.ToBtcBaseSwapHandler = ToBtcBaseSwapHandler;
