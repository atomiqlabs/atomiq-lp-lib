import {BigIntBufferUtils, BtcTx, SwapData} from "@atomiqlabs/base";
import {FromBtcBaseSwap} from "../FromBtcBaseSwap";
import {deserializeBN, serializeBN} from "../../utils/Utils";
import {createHash, randomBytes} from "crypto";


export enum FromBtcTrustedSwapState {
    DOUBLE_SPENT = -4,
    REFUNDED = -3,
    REFUNDABLE = -2,
    EXPIRED = -1,
    CREATED = 0,
    RECEIVED = 1,
    BTC_CONFIRMED = 2,
    SENT = 3,
    CONFIRMED = 4,
    FINISHED = 5
}

export class FromBtcTrustedSwap<T extends SwapData = SwapData> extends FromBtcBaseSwap<T, FromBtcTrustedSwapState> {

    readonly sequence: bigint;
    readonly btcAddress: string;

    readonly dstAddress: string;
    readonly outputTokens: bigint;

    readonly createdHeight: number;
    readonly expiresAt: number;
    readonly recommendedFee: number;

    readonly token: string;

    refundAddress: string;

    adjustedInput: bigint;
    adjustedOutput: bigint;

    doubleSpent: boolean;
    scRawTx: string;

    btcTx: BtcTx;
    txFee: number;
    txSize: number;
    txId: string;
    vout: number;

    burnTxId: string;
    refundTxId: string;

    constructor(
        chainIdentifier: string,
        swapFee: bigint,
        swapFeeInToken: bigint,
        btcAddress: string,
        inputSats: bigint,
        dstAddress: string,
        outputTokens: bigint,
        createdHeight: number,
        expiresAt: number,
        recommendedFee: number,
        refundAddress: string,
        token: string
    );
    constructor(obj: any);

    constructor(
        objOrChainIdentifier: any | string,
        swapFee?: bigint,
        swapFeeInToken?: bigint,
        btcAddress?: string,
        inputSats?: bigint,
        dstAddress?: string,
        outputTokens?: bigint,
        createdHeight?: number,
        expiresAt?: number,
        recommendedFee?: number,
        refundAddress?: string,
        token?: string
    ) {
        if(typeof(objOrChainIdentifier)==="string") {
            super(objOrChainIdentifier, inputSats, swapFee, swapFeeInToken);
            this.state = FromBtcTrustedSwapState.CREATED;
            this.doubleSpent = false;
            this.sequence = BigIntBufferUtils.fromBuffer(randomBytes(8));
            this.btcAddress = btcAddress;
            this.dstAddress = dstAddress;
            this.outputTokens = outputTokens;
            this.createdHeight = createdHeight;
            this.expiresAt = expiresAt;
            this.recommendedFee = recommendedFee;
            this.refundAddress = refundAddress;
            this.token = token;
        } else {
            super(objOrChainIdentifier);
            this.btcAddress = objOrChainIdentifier.btcAddress;
            this.sequence = deserializeBN(objOrChainIdentifier.sequence);
            this.dstAddress = objOrChainIdentifier.dstAddress;
            this.outputTokens = deserializeBN(objOrChainIdentifier.outputTokens);
            this.adjustedInput = deserializeBN(objOrChainIdentifier.adjustedInput);
            this.adjustedOutput = deserializeBN(objOrChainIdentifier.adjustedOutput);
            this.createdHeight = objOrChainIdentifier.createdHeight;
            this.expiresAt = objOrChainIdentifier.expiresAt;
            this.recommendedFee = objOrChainIdentifier.recommendedFee;
            this.refundAddress = objOrChainIdentifier.refundAddress;
            this.doubleSpent = objOrChainIdentifier.doubleSpent;
            this.scRawTx = objOrChainIdentifier.scRawTx;
            this.btcTx = objOrChainIdentifier.btcTx;
            this.txFee = objOrChainIdentifier.txFee;
            this.txSize = objOrChainIdentifier.txSize;
            this.txId = objOrChainIdentifier.txId;
            this.vout = objOrChainIdentifier.vout;
            this.burnTxId = objOrChainIdentifier.burnTxId;
            this.refundTxId = objOrChainIdentifier.refundTxId;
            this.token = objOrChainIdentifier.token;
        }
    }

    serialize(): any {
        const partialSerialized = super.serialize();
        partialSerialized.btcAddress = this.btcAddress;
        partialSerialized.sequence = serializeBN(this.sequence);
        partialSerialized.dstAddress = this.dstAddress;
        partialSerialized.outputTokens = serializeBN(this.outputTokens);
        partialSerialized.adjustedInput = serializeBN(this.adjustedInput);
        partialSerialized.adjustedOutput = serializeBN(this.adjustedOutput);
        partialSerialized.createdHeight = this.createdHeight;
        partialSerialized.expiresAt = this.expiresAt;
        partialSerialized.recommendedFee = this.recommendedFee;
        partialSerialized.refundAddress = this.refundAddress;
        partialSerialized.doubleSpent = this.doubleSpent;
        partialSerialized.scRawTx = this.scRawTx;
        partialSerialized.btcTx = this.btcTx;
        partialSerialized.txFee = this.txFee;
        partialSerialized.txSize = this.txSize;
        partialSerialized.txId = this.txId;
        partialSerialized.vout = this.vout;
        partialSerialized.burnTxId = this.burnTxId;
        partialSerialized.refundTxId = this.refundTxId;
        partialSerialized.token = this.token;
        return partialSerialized;
    }

    getClaimHash(): string {
        return createHash("sha256").update(this.btcAddress).digest().toString("hex");
    }

    getSequence(): bigint {
        return this.sequence;
    }

    getToken(): string {
        return this.token;
    }

    getOutputAmount(): bigint {
        return this.adjustedOutput || this.outputTokens;
    }

    getTotalInputAmount(): bigint {
        return this.adjustedInput || this.amount;
    }

    isFailed(): boolean {
        return this.state===FromBtcTrustedSwapState.EXPIRED || this.state===FromBtcTrustedSwapState.REFUNDED || this.state===FromBtcTrustedSwapState.DOUBLE_SPENT;
    }

    isInitiated(): boolean {
        return this.state!==FromBtcTrustedSwapState.CREATED;
    }

    isSuccess(): boolean {
        return this.state===FromBtcTrustedSwapState.CONFIRMED;
    }

}