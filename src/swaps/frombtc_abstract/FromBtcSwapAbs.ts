import {SwapData} from "@atomiqlabs/base";
import {SwapHandlerType} from "../SwapHandler";
import {FromBtcBaseSwap} from "../FromBtcBaseSwap";

export enum FromBtcSwapState {
    REFUNDED = -2,
    CANCELED = -1,
    CREATED = 0,
    COMMITED = 1,
    CLAIMED = 2
}

export class FromBtcSwapAbs<T extends SwapData = SwapData> extends FromBtcBaseSwap<T, FromBtcSwapState> {

    readonly address: string;
    readonly confirmations: number;
    txId: string;

    constructor(chainIdentifier: string, address: string, confirmations: number, amount: bigint, swapFee: bigint, swapFeeInToken: bigint);
    constructor(obj: any);

    constructor(prOrObj: string | any, address?: string, confirmations?: number, amount?: bigint, swapFee?: bigint, swapFeeInToken?: bigint) {
        if(typeof(prOrObj)==="string") {
            super(prOrObj, amount, swapFee, swapFeeInToken);
            this.state = FromBtcSwapState.CREATED;
            this.address = address;
            this.confirmations = confirmations;
        } else {
            super(prOrObj);
            this.address = prOrObj.address;
            this.confirmations = prOrObj.confirmations;
            this.txId = prOrObj.txId;
        }
        this.type = SwapHandlerType.FROM_BTC;
    }

    serialize(): any {
        const partialSerialized = super.serialize();
        partialSerialized.address = this.address;
        partialSerialized.confirmations = this.confirmations;
        partialSerialized.txId = this.txId;
        return partialSerialized;
    }

    isInitiated(): boolean {
        return this.state!==FromBtcSwapState.CREATED;
    }

    isFailed(): boolean {
        return this.state===FromBtcSwapState.CANCELED || this.state===FromBtcSwapState.REFUNDED;
    }

    isSuccess(): boolean {
        return this.state===FromBtcSwapState.CLAIMED;
    }

    getTotalInputAmount(): bigint {
        return this.amount;
    }

}
