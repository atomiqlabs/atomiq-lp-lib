import * as BN from "bn.js";
import {createHash} from "crypto";
import {SwapData} from "@atomiqlabs/base";
import {SwapHandlerType} from "../SwapHandler";
import {deserializeBN, serializeBN} from "../../utils/Utils";
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
    authorizationExpiry: BN;
    txId: string;

    constructor(chainIdentifier: string, address: string, amount: BN, swapFee: BN, swapFeeInToken: BN);
    constructor(obj: any);

    constructor(prOrObj: string | any, address?: string, amount?: BN, swapFee?: BN, swapFeeInToken?: BN) {
        if(typeof(prOrObj)==="string") {
            super(prOrObj, amount, swapFee, swapFeeInToken);
            this.state = FromBtcSwapState.CREATED;
            this.address = address;
        } else {
            super(prOrObj);
            this.address = prOrObj.address;
            this.authorizationExpiry = deserializeBN(prOrObj.authorizationExpiry);
            this.txId = prOrObj.txId;
        }
        this.type = SwapHandlerType.FROM_BTC;
    }

    serialize(): any {
        const partialSerialized = super.serialize();
        partialSerialized.address = this.address;
        partialSerialized.authorizationExpiry = serializeBN(this.authorizationExpiry);
        partialSerialized.txId = this.txId;
        return partialSerialized;
    }

    getTxoHash(): Buffer {
        return Buffer.from(this.data.getTxoHash(), "hex");
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

    getTotalInputAmount(): BN {
        return this.amount;
    }

}
