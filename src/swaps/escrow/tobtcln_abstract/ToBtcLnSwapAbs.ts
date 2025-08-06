import {SwapData} from "@atomiqlabs/base";
import {SwapHandlerType} from "../../../index";
import {deserializeBN} from "../../../utils/Utils";
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
    payInitiated: boolean;

    secret: string;

    constructor(
        chainIdentifier: string,
        lnPaymentHash: string,
        pr: string,
        amountMtokens: bigint,
        swapFee: bigint,
        swapFeeInToken: bigint,
        quotedNetworkFee: bigint,
        quotedNetworkFeeInToken: bigint,
    );
    constructor(obj: any);

    constructor(chainIdOrObj: string | any, lnPaymentHash?: string, pr?: string, amount?: bigint, swapFee?: bigint, swapFeeInToken?: bigint, quotedNetworkFee?: bigint, quotedNetworkFeeInToken?: bigint) {
        if(typeof(chainIdOrObj)==="string") {
            super(chainIdOrObj, (amount + 999n) / 1000n, swapFee, swapFeeInToken, quotedNetworkFee, quotedNetworkFeeInToken);
            this.state = ToBtcLnSwapState.SAVED;
            this.lnPaymentHash = lnPaymentHash;
            this.pr = pr;
        } else {
            super(chainIdOrObj);
            this.pr = chainIdOrObj.pr;
            this.secret = chainIdOrObj.secret;
            this.lnPaymentHash = chainIdOrObj.lnPaymentHash;
            this.payInitiated = chainIdOrObj.payInitiated;

            //Compatibility with older versions
            this.quotedNetworkFee ??= deserializeBN(chainIdOrObj.maxFee);
            this.realNetworkFee ??= deserializeBN(chainIdOrObj.realRoutingFee);
        }
        this.type = SwapHandlerType.TO_BTCLN;
    }

    getIdentifierHash(): string {
        return this.lnPaymentHash;
    }

    serialize(): any {
        const partialSerialized = super.serialize();
        partialSerialized.pr = this.pr;
        partialSerialized.lnPaymentHash = this.lnPaymentHash;
        partialSerialized.secret = this.secret;
        partialSerialized.payInitiated = this.payInitiated;
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