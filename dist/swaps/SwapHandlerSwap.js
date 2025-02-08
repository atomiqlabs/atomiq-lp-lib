"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapHandlerSwap = void 0;
const base_1 = require("@atomiqlabs/base");
const PluginManager_1 = require("../plugins/PluginManager");
const BN = require("bn.js");
const Utils_1 = require("../utils/Utils");
class SwapHandlerSwap extends base_1.Lockable {
    constructor(obj, swapFee, swapFeeInToken) {
        super();
        this.txIds = {};
        if (typeof (obj) === "string" && BN.isBN(swapFee) && BN.isBN(swapFeeInToken)) {
            this.chainIdentifier = obj;
            this.swapFee = swapFee;
            this.swapFeeInToken = swapFeeInToken;
            return;
        }
        else {
            this.data = obj.data == null ? null : base_1.SwapData.deserialize(obj.data);
            this.metadata = obj.metadata;
            this.chainIdentifier = obj.chainIdentifier;
            this.txIds = obj.txIds || {};
            this.state = obj.state;
            this.swapFee = (0, Utils_1.deserializeBN)(obj.swapFee);
            this.swapFeeInToken = (0, Utils_1.deserializeBN)(obj.swapFeeInToken);
            this.prefix = obj.prefix;
            this.timeout = obj.timeout;
            this.signature = obj.signature;
            this.feeRate = obj.feeRate;
        }
    }
    serialize() {
        return {
            state: this.state,
            data: this.data == null ? null : this.data.serialize(),
            chainIdentifier: this.chainIdentifier,
            metadata: this.metadata,
            txIds: this.txIds,
            swapFee: (0, Utils_1.serializeBN)(this.swapFee),
            swapFeeInToken: (0, Utils_1.serializeBN)(this.swapFeeInToken),
            prefix: this.prefix,
            timeout: this.timeout,
            signature: this.signature,
            feeRate: this.feeRate
        };
    }
    /**
     * Sets the state of the swap and also calls swap change listener on plugins
     *
     * @param newState
     */
    setState(newState) {
        const oldState = this.state;
        this.state = newState;
        return PluginManager_1.PluginManager.swapStateChange(this, oldState);
    }
    /**
     * Returns the escrow hash - i.e. hash of the escrow data
     */
    getEscrowHash() {
        return this.data.getEscrowHash();
    }
    /**
     * Returns the claim data hash - i.e. hash passed to the claim handler
     */
    getClaimHash() {
        return this.data.getClaimHash();
    }
    /**
     * Returns the identification hash of the swap, usually claim data hash, but can be overriden, e.g. for
     *  lightning swaps the identifier hash is used instead of claim data hash
     */
    getIdentifierHash() {
        return this.getClaimHash();
    }
    getSequence() {
        var _a;
        return ((_a = this.data) === null || _a === void 0 ? void 0 : _a.getSequence) == null ? null : this.data.getSequence();
    }
    /**
     * Returns unique identifier of the swap in the form <hash>_<sequence> or just <hash> if the swap type doesn't
     *  use sequence number
     */
    getIdentifier() {
        if (this.getSequence() != null) {
            return this.chainIdentifier + "_" + this.getIdentifierHash() + "_" + this.getSequence().toString(16);
        }
        return this.chainIdentifier + "_" + this.getIdentifierHash();
    }
    /**
     * Checks whether the swap is finished, such that it is final and either successful or failed
     */
    isFinished() {
        return this.isSuccess() || this.isFailed();
    }
}
exports.SwapHandlerSwap = SwapHandlerSwap;
