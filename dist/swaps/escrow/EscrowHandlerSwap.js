"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EscrowHandlerSwap = void 0;
const base_1 = require("@atomiqlabs/base");
const SwapHandlerSwap_1 = require("../SwapHandlerSwap");
function objectBigIntsToString(obj) {
    for (let key in obj) {
        if (typeof obj[key] === "bigint")
            obj[key] = obj[key].toString(10);
        if (typeof obj[key] === "object")
            objectBigIntsToString(obj[key]);
    }
    return obj;
}
class EscrowHandlerSwap extends SwapHandlerSwap_1.SwapHandlerSwap {
    constructor(obj, swapFee, swapFeeInToken) {
        super(obj, swapFee, swapFeeInToken);
        this.txIds = {};
        if (typeof (obj) === "string" && typeof (swapFee) === "bigint" && typeof (swapFeeInToken) === "bigint") {
            return;
        }
        else {
            this.data = obj.data == null ? null : base_1.SwapData.deserialize(obj.data);
            this.prefix = obj.prefix;
            this.timeout = obj.timeout;
            this.signature = obj.signature;
            this.feeRate = obj.feeRate;
        }
    }
    serialize() {
        return {
            ...super.serialize(),
            data: this.data == null ? null : this.data.serialize(),
            prefix: this.prefix,
            timeout: this.timeout,
            signature: this.signature,
            feeRate: this.feeRate
        };
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
        return this.data?.getSequence == null ? null : this.data.getSequence();
    }
    /**
     * Returns the smart chain token used for the swap
     */
    getToken() {
        return this.data?.getToken();
    }
}
exports.EscrowHandlerSwap = EscrowHandlerSwap;
