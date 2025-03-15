"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EscrowHandler = void 0;
const SwapHandler_1 = require("../SwapHandler");
const base_1 = require("@atomiqlabs/base");
const PluginManager_1 = require("../../plugins/PluginManager");
const SwapHandlerSwap_1 = require("../SwapHandlerSwap");
class EscrowHandler extends SwapHandler_1.SwapHandler {
    constructor() {
        super(...arguments);
        this.escrowHashMap = new Map();
        this.swapLogger = {
            debug: (swap, msg, ...args) => this.logger.debug(this.getIdentifier(swap) + ": " + msg, ...args),
            info: (swap, msg, ...args) => this.logger.info(this.getIdentifier(swap) + ": " + msg, ...args),
            warn: (swap, msg, ...args) => this.logger.warn(this.getIdentifier(swap) + ": " + msg, ...args),
            error: (swap, msg, ...args) => this.logger.error(this.getIdentifier(swap) + ": " + msg, ...args)
        };
    }
    /**
     * Chain event processor
     *
     * @param chainIdentifier
     * @param eventData
     */
    async processEvent(chainIdentifier, eventData) {
        if (this.swapType == null)
            return true;
        for (let event of eventData) {
            if (event instanceof base_1.InitializeEvent) {
                if (event.swapType !== this.swapType)
                    continue;
                const swap = this.getSwapByEscrowHash(chainIdentifier, event.escrowHash);
                if (swap == null)
                    continue;
                swap.txIds.init = event.meta?.txId;
                if (swap.metadata != null)
                    swap.metadata.times.initTxReceived = Date.now();
                await this.processInitializeEvent(chainIdentifier, swap, event);
            }
            else if (event instanceof base_1.ClaimEvent) {
                const swap = this.getSwapByEscrowHash(chainIdentifier, event.escrowHash);
                if (swap == null)
                    continue;
                swap.txIds.claim = event.meta?.txId;
                if (swap.metadata != null)
                    swap.metadata.times.claimTxReceived = Date.now();
                await this.processClaimEvent(chainIdentifier, swap, event);
            }
            else if (event instanceof base_1.RefundEvent) {
                const swap = this.getSwapByEscrowHash(chainIdentifier, event.escrowHash);
                if (swap == null)
                    continue;
                swap.txIds.refund = event.meta?.txId;
                if (swap.metadata != null)
                    swap.metadata.times.refundTxReceived = Date.now();
                await this.processRefundEvent(chainIdentifier, swap, event);
            }
        }
        return true;
    }
    /**
     * Initializes chain events subscription
     */
    subscribeToEvents() {
        for (let key in this.chains.chains) {
            this.chains.chains[key].chainEvents.registerListener((events) => this.processEvent(key, events));
        }
        this.logger.info("SC: Events: subscribed to smartchain events");
    }
    async loadData(ctor) {
        await super.loadData(ctor);
        for (let { obj: swap, hash, sequence } of await this.storageManager.query([])) {
            this.saveSwapToEscrowHashMap(swap);
        }
    }
    async removeSwapData(hashOrSwap, sequenceOrUltimateState) {
        let swap;
        if (typeof (hashOrSwap) === "string") {
            if (typeof (sequenceOrUltimateState) !== "bigint")
                throw new Error("Sequence must be a BN instance!");
            swap = await this.storageManager.getData(hashOrSwap, sequenceOrUltimateState);
        }
        else {
            swap = hashOrSwap;
            if (sequenceOrUltimateState != null && typeof (sequenceOrUltimateState) !== "bigint")
                await swap.setState(sequenceOrUltimateState);
        }
        if (swap != null)
            await PluginManager_1.PluginManager.swapRemove(swap);
        this.swapLogger.debug(swap, "removeSwapData(): removing swap final state: " + swap.state);
        this.removeSwapFromEscrowHashMap(swap);
        await this.storageManager.removeData(swap.getIdentifierHash(), swap.getSequence());
    }
    async saveSwapData(swap) {
        this.saveSwapToEscrowHashMap(swap);
        return super.saveSwapData(swap);
    }
    saveSwapToEscrowHashMap(swap) {
        if (swap.data != null)
            this.escrowHashMap.set(swap.chainIdentifier + "_" + swap.getEscrowHash(), swap);
    }
    removeSwapFromEscrowHashMap(swap) {
        if (swap.data != null)
            this.escrowHashMap.delete(swap.chainIdentifier + "_" + swap.getEscrowHash());
    }
    getSwapByEscrowHash(chainIdentifier, escrowHash) {
        return this.escrowHashMap.get(chainIdentifier + "_" + escrowHash);
    }
    getIdentifierFromEvent(event) {
        if (event instanceof base_1.SwapEvent) {
            const foundSwap = this.escrowHashMap.get(event.escrowHash);
            if (foundSwap != null) {
                return foundSwap.getIdentifier();
            }
            return "UNKNOWN_" + event.escrowHash;
        }
    }
    getIdentifierFromSwapData(swapData) {
        if (swapData.getSequence == null)
            return swapData.getClaimHash();
        return swapData.getClaimHash() + "_" + swapData.getSequence().toString(16);
    }
    getIdentifier(swap) {
        if (swap instanceof SwapHandlerSwap_1.SwapHandlerSwap) {
            return swap.getIdentifier();
        }
        if (swap instanceof base_1.ChainEvent) {
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
    getSignDataPrefetch(chainIdentifier, abortController, responseStream) {
        const { swapContract } = this.getChain(chainIdentifier);
        let signDataPrefetchPromise = swapContract.preFetchBlockDataForSignatures != null ? swapContract.preFetchBlockDataForSignatures().catch(e => {
            this.logger.error("getSignDataPrefetch(): signDataPrefetch: ", e);
            abortController.abort(e);
            return null;
        }) : null;
        if (signDataPrefetchPromise != null && responseStream != null) {
            signDataPrefetchPromise = signDataPrefetchPromise.then(val => val == null || abortController.signal.aborted ? null : responseStream.writeParams({
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
exports.EscrowHandler = EscrowHandler;
