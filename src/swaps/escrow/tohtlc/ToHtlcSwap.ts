import {SwapData} from "@atomiqlabs/base";
import {SwapHandlerType} from "../../../index";
import {deserializeBN} from "../../../utils/Utils";
import {ToBtcBaseSwap} from "../ToBtcBaseSwap";

export enum ToHtlcSwapState {
    REFUNDED = -2,
    CANCELED = -1,
    SAVED = 0,
    NON_PAYABLE = 1,
    COMMITED = 2,
    PAID = 3,
    CLAIMED = 4
}

export class ToHtlcSwap<T extends SwapData = SwapData> extends ToBtcBaseSwap<T, ToHtlcSwapState> {

    readonly recipient: string;
    readonly paymentHash: string;
    htlcId?: string;
    createInitiated: boolean;

    secret?: string;

    constructor(
        chainIdentifier: string,
        recipient: string,
        paymentHash: string,
        amountMtokens: bigint,
        swapFee: bigint,
        swapFeeInToken: bigint,
        quotedNetworkFee: bigint,
        quotedNetworkFeeInToken: bigint,
    );
    constructor(obj: any);

    constructor(chainIdOrObj: string | any, recipient?: string, paymentHash?: string, amount?: bigint, swapFee?: bigint, swapFeeInToken?: bigint, quotedNetworkFee?: bigint, quotedNetworkFeeInToken?: bigint) {
        if(typeof(chainIdOrObj)==="string") {
            super(chainIdOrObj, (amount + 999n) / 1000n, swapFee, swapFeeInToken, quotedNetworkFee, quotedNetworkFeeInToken);
            this.state = ToHtlcSwapState.SAVED;
            this.paymentHash = paymentHash;
            this.recipient = recipient;
        } else {
            super(chainIdOrObj);
            this.recipient = chainIdOrObj.recipient;
            this.secret = chainIdOrObj.secret;
            this.paymentHash = chainIdOrObj.paymentHash;
            this.htlcId = chainIdOrObj.htlcId;
            this.createInitiated = chainIdOrObj.createInitiated;

            //Compatibility with older versions
            this.quotedNetworkFee ??= deserializeBN(chainIdOrObj.maxFee);
            this.realNetworkFee ??= deserializeBN(chainIdOrObj.realRoutingFee);
        }
        this.type = SwapHandlerType.TO_BTCLN;
    }

    getIdentifierHash(): string {
        return this.paymentHash;
    }

    serialize(): any {
        const partialSerialized = super.serialize();
        partialSerialized.recipient = this.recipient;
        partialSerialized.paymentHash = this.paymentHash;
        partialSerialized.htlcId = this.htlcId;
        partialSerialized.secret = this.secret;
        partialSerialized.createInitiated = this.createInitiated;
        return partialSerialized;
    }

    isInitiated(): boolean {
        return this.state!==ToHtlcSwapState.SAVED;
    }

    isFailed(): boolean {
        return this.state===ToHtlcSwapState.CANCELED || this.state===ToHtlcSwapState.REFUNDED;
    }

    isSuccess(): boolean {
        return this.state===ToHtlcSwapState.CLAIMED;
    }

}