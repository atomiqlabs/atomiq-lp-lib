import * as BN from "bn.js";
import {SwapData} from "@atomiqlabs/base";
import {SwapHandlerType} from "../..";
import {ToBtcBaseSwap} from "../ToBtcBaseSwap";
import {deserializeBN, serializeBN} from "../../utils/Utils";

export enum ToBtcSwapState {
    REFUNDED = -3,
    CANCELED = -2,
    NON_PAYABLE = -1,
    SAVED = 0,
    COMMITED = 1,
    BTC_SENDING = 2,
    BTC_SENT = 3,
    CLAIMED = 4
}

export class ToBtcSwapAbs<T extends SwapData = SwapData> extends ToBtcBaseSwap<T, ToBtcSwapState> {

    readonly address: string;
    readonly satsPerVbyte: BN;
    readonly nonce: BN;
    readonly preferedConfirmationTarget: number;

    txId: string;

    constructor(
        chainIdentifier: string,
        address: string,
        amount: BN,
        swapFee: BN,
        swapFeeInToken: BN,
        networkFee: BN,
        networkFeeInToken: BN,
        satsPerVbyte: BN,
        nonce: BN,
        preferedConfirmationTarget: number
    );
    constructor(obj: any);

    constructor(
        chainIdOrObj: string | any,
        address?: string,
        amount?: BN,
        swapFee?: BN,
        swapFeeInToken?: BN,
        networkFee?: BN,
        networkFeeInToken?: BN,
        satsPerVbyte?: BN,
        nonce?: BN,
        preferedConfirmationTarget?: number
    ) {
        if(typeof(chainIdOrObj)==="string") {
            super(chainIdOrObj, amount, swapFee, swapFeeInToken, networkFee, networkFeeInToken);
            this.state = ToBtcSwapState.SAVED;
            this.address = address;
            this.satsPerVbyte = satsPerVbyte;
            this.nonce = nonce;
            this.preferedConfirmationTarget = preferedConfirmationTarget;
        } else {
            super(chainIdOrObj);
            this.address = chainIdOrObj.address;
            this.satsPerVbyte = new BN(chainIdOrObj.satsPerVbyte);
            this.nonce = new BN(chainIdOrObj.nonce);
            this.preferedConfirmationTarget = chainIdOrObj.preferedConfirmationTarget;

            this.txId = chainIdOrObj.txId;

            //Compatibility
            this.quotedNetworkFee ??= deserializeBN(chainIdOrObj.networkFee);
        }
        this.type = SwapHandlerType.TO_BTC;
    }

    serialize(): any {
        const partialSerialized = super.serialize();
        partialSerialized.address = this.address;
        partialSerialized.satsPerVbyte = this.satsPerVbyte.toString(10);
        partialSerialized.nonce = this.nonce.toString(10);
        partialSerialized.preferedConfirmationTarget = this.preferedConfirmationTarget;
        partialSerialized.txId = this.txId;
        return partialSerialized;
    }

    isInitiated(): boolean {
        return this.state!==ToBtcSwapState.SAVED;
    }

    isFailed(): boolean {
        return this.state===ToBtcSwapState.NON_PAYABLE || this.state===ToBtcSwapState.REFUNDED || this.state===ToBtcSwapState.CANCELED;
    }

    isSuccess(): boolean {
        return this.state===ToBtcSwapState.CLAIMED;
    }

}
