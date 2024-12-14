import * as BN from "bn.js";
import {SwapData} from "@atomiqlabs/base";
import {SwapHandlerType} from "../..";
import {FromBtcBaseSwap} from "../FromBtcBaseSwap";

export enum FromBtcLnSwapState {
    REFUNDED = -2,
    CANCELED = -1,
    CREATED = 0,
    RECEIVED = 1,
    COMMITED = 2,
    CLAIMED = 3,
    SETTLED = 4,
}

export class FromBtcLnSwapAbs<T extends SwapData = SwapData> extends FromBtcBaseSwap<T, FromBtcLnSwapState> {

    readonly pr: string;

    nonce: number;

    secret: string;

    constructor(chainIdentifier: string, pr: string, amountMtokens: BN, swapFee: BN, swapFeeInToken: BN);
    constructor(obj: any);

    constructor(chainIdOrObj: string | any, pr?: string, amountMtokens?: BN, swapFee?: BN, swapFeeInToken?: BN) {
        if(typeof(chainIdOrObj)==="string") {
            super(chainIdOrObj, amountMtokens.add(new BN(999)).div(new BN(1000)), swapFee, swapFeeInToken);
            this.state = FromBtcLnSwapState.CREATED;
            this.pr = pr;
        } else {
            super(chainIdOrObj);
            this.pr = chainIdOrObj.pr;
            this.secret = chainIdOrObj.secret;
            this.nonce = chainIdOrObj.nonce;
        }
        this.type = SwapHandlerType.FROM_BTCLN;
    }

    serialize(): any {
        const partialSerialized = super.serialize();
        partialSerialized.pr = this.pr;
        partialSerialized.secret = this.secret;
        partialSerialized.nonce = this.nonce;
        return partialSerialized;
    }

    getSequence(): BN {
        return null;
    }

    isInitiated(): boolean {
        return this.state!==FromBtcLnSwapState.CREATED;
    }

    isFailed(): boolean {
        return this.state===FromBtcLnSwapState.CANCELED || this.state===FromBtcLnSwapState.REFUNDED;
    }

    isSuccess(): boolean {
        return this.state===FromBtcLnSwapState.SETTLED;
    }

}
