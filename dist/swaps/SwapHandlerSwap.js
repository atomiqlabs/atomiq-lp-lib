"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapHandlerSwap = void 0;
const base_1 = require("@atomiqlabs/base");
const PluginManager_1 = require("../plugins/PluginManager");
const Utils_1 = require("../utils/Utils");
function objectBigIntsToString(obj) {
    for (let key in obj) {
        if (typeof obj[key] === "bigint")
            obj[key] = obj[key].toString(10);
        if (typeof obj[key] === "object")
            objectBigIntsToString(obj[key]);
    }
    return obj;
}
class SwapHandlerSwap extends base_1.Lockable {
    constructor(obj, swapFee, swapFeeInToken) {
        super();
        this.txIds = {};
        if (typeof (obj) === "string" && typeof (swapFee) === "bigint" && typeof (swapFeeInToken) === "bigint") {
            this.chainIdentifier = obj;
            this.swapFee = swapFee;
            this.swapFeeInToken = swapFeeInToken;
            return;
        }
        else {
            this.metadata = obj.metadata;
            this.chainIdentifier = obj.chainIdentifier;
            this.txIds = obj.txIds || {};
            this.state = obj.state;
            this.swapFee = (0, Utils_1.deserializeBN)(obj.swapFee);
            this.swapFeeInToken = (0, Utils_1.deserializeBN)(obj.swapFeeInToken);
        }
    }
    serialize() {
        return {
            state: this.state,
            chainIdentifier: this.chainIdentifier,
            metadata: objectBigIntsToString(this.metadata),
            txIds: this.txIds,
            swapFee: (0, Utils_1.serializeBN)(this.swapFee),
            swapFeeInToken: (0, Utils_1.serializeBN)(this.swapFeeInToken)
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
    /**
     * Returns the input amount paid by the user (excluding fees)
     */
    getInputAmount() {
        return this.getTotalInputAmount() - this.getSwapFee().inInputToken;
    }
}
exports.SwapHandlerSwap = SwapHandlerSwap;
