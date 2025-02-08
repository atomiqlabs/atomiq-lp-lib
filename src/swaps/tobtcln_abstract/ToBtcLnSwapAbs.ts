import * as BN from "bn.js";
import {SwapData} from "@atomiqlabs/base";
import {SwapHandlerType} from "../..";
import {deserializeBN, serializeBN} from "../../utils/Utils";
import {ToBtcBaseSwap} from "../ToBtcBaseSwap";

export enum ToBtcLnSwapState {
    REFUNDED = -3,
    CANCELED = -2,
    NON_PAYABLE = -1,
    SAVED = 0,
    COMMITED = 1,
    PAID = 2,
    CLAIMED = 3
}

export class ToBtcLnSwapAbs<T extends SwapData = SwapData> extends ToBtcBaseSwap<T, ToBtcLnSwapState> {

    lnPaymentHash: string;
    readonly pr: string;

    secret: string;

    constructor(
        chainIdentifier: string,
        lnPaymentHash: string,
        pr: string,
        amountMtokens: BN,
        swapFee: BN,
        swapFeeInToken: BN,
        quotedNetworkFee: BN,
        quotedNetworkFeeInToken: BN,
    );
    constructor(obj: any);

    constructor(chainIdOrObj: string | any, lnPaymentHash?: string, pr?: string, amount?: BN, swapFee?: BN, swapFeeInToken?: BN, quotedNetworkFee?: BN, quotedNetworkFeeInToken?: BN) {
        if(typeof(chainIdOrObj)==="string") {
            super(chainIdOrObj, amount.add(new BN(999)).div(new BN(1000)), swapFee, swapFeeInToken, quotedNetworkFee, quotedNetworkFeeInToken);
            this.state = ToBtcLnSwapState.SAVED;
            this.lnPaymentHash = lnPaymentHash;
            this.pr = pr;
        } else {
            super(chainIdOrObj);
            this.pr = chainIdOrObj.pr;
            this.secret = chainIdOrObj.secret;
            this.lnPaymentHash = chainIdOrObj.lnPaymentHash;

            //Compatibility with older versions
            this.quotedNetworkFee ??= deserializeBN(chainIdOrObj.maxFee);
            this.realNetworkFee ??= deserializeBN(chainIdOrObj.realRoutingFee);
        }
        this.type = SwapHandlerType.TO_BTCLN;
    }

    serialize(): any {
        const partialSerialized = super.serialize();
        partialSerialized.pr = this.pr;
        partialSerialized.lnPaymentHash = this.lnPaymentHash;
        partialSerialized.secret = this.secret;
        return partialSerialized;
    }

    isInitiated(): boolean {
        return this.state!==ToBtcLnSwapState.SAVED;
    }

    isFailed(): boolean {
        return this.state===ToBtcLnSwapState.NON_PAYABLE || this.state===ToBtcLnSwapState.CANCELED || this.state===ToBtcLnSwapState.REFUNDED;
    }

    isSuccess(): boolean {
        return this.state===ToBtcLnSwapState.CLAIMED;
    }

}