import {SwapData} from "@atomiqlabs/base";
import {createHash} from "crypto";
import {FromBtcBaseSwap} from "../FromBtcBaseSwap";
import {deserializeBN, serializeBN} from "../../utils/Utils";

export enum FromBtcLnTrustedSwapState {
    REFUNDED = -2,
    CANCELED = -1,
    CREATED = 0,
    RECEIVED = 1,
    SENT = 2,
    CONFIRMED = 3,
    SETTLED = 4,
}

export class FromBtcLnTrustedSwap<T extends SwapData = SwapData> extends FromBtcBaseSwap<T, FromBtcLnTrustedSwapState> {

    readonly pr: string;
    readonly output: bigint;
    readonly dstAddress: string;
    readonly secret: string;
    readonly token: string;

    scRawTx: string;

    constructor(
        chainIdentifier: string,
        pr: string,
        inputMtokens: bigint,
        swapFee: bigint,
        swapFeeInToken: bigint,
        output: bigint,
        secret: string,
        dstAddress: string,
        token: string
    );
    constructor(obj: any);

    constructor(
        chainIdOrObj: string | any,
        pr?: string,
        inputMtokens?: bigint,
        swapFee?: bigint,
        swapFeeInToken?: bigint,
        output?: bigint,
        secret?: string,
        dstAddress?: string,
        token?: string
    ) {
        if(typeof(chainIdOrObj)==="string") {
            super(chainIdOrObj, (inputMtokens + 999n) / 1000n, swapFee, swapFeeInToken);
            this.state = FromBtcLnTrustedSwapState.CREATED;
            this.pr = pr;
            this.output = output;
            this.secret = secret;
            this.dstAddress = dstAddress;
            this.token = token;
        } else {
            super(chainIdOrObj);
            this.pr = chainIdOrObj.pr;
            this.output = deserializeBN(chainIdOrObj.output);
            this.secret = chainIdOrObj.secret;
            this.dstAddress = chainIdOrObj.dstAddress;
            this.token = chainIdOrObj.token;
            this.scRawTx = chainIdOrObj.scRawTx;
        }
        this.type = null;
    }

    getToken(): string {
        return this.token;
    }

    getOutputAmount(): bigint {
        return this.output;
    }

    getClaimHash(): string {
        return createHash("sha256").update(Buffer.from(this.secret, "hex")).digest().toString("hex");
    }

    getSequence(): bigint {
        return 0n;
    }

    serialize(): any {
        const partialSerialized = super.serialize();
        partialSerialized.pr = this.pr;
        partialSerialized.output = serializeBN(this.output);
        partialSerialized.secret = this.secret;
        partialSerialized.dstAddress = this.dstAddress;
        partialSerialized.token = this.token;
        partialSerialized.scRawTx = this.scRawTx;
        return partialSerialized;
    }

    isFailed(): boolean {
        return this.state===FromBtcLnTrustedSwapState.CANCELED || this.state===FromBtcLnTrustedSwapState.REFUNDED;
    }

    isInitiated(): boolean {
        return this.state!==FromBtcLnTrustedSwapState.CREATED;
    }

    isSuccess(): boolean {
        return this.state===FromBtcLnTrustedSwapState.SETTLED;
    }

}
