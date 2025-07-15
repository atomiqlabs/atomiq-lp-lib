import {SwapData} from "@atomiqlabs/base";
import {SwapHandlerType} from "../../../index";
import {FromBtcBaseSwap} from "../FromBtcBaseSwap";
import {deserializeBN, serializeBN} from "../../../utils/Utils";

export enum FromBtcLnAutoSwapState {
    REFUNDED = -2,
    CANCELED = -1,
    CREATED = 0,
    RECEIVED = 1,
    TXS_SENT = 2,
    COMMITED = 3,
    CLAIMED = 4,
    SETTLED = 5,
}

export class FromBtcLnAutoSwap<T extends SwapData = SwapData> extends FromBtcBaseSwap<T, FromBtcLnAutoSwapState> {

    readonly pr: string;
    readonly lnPaymentHash: string;
    readonly claimHash: string;

    readonly claimer: string;

    readonly token: string;
    readonly gasToken: string;
    readonly amountToken: bigint;
    readonly amountGasToken: bigint;

    readonly tokenSwapFee: bigint;
    readonly tokenSwapFeeInToken: bigint;
    readonly gasSwapFee: bigint;
    readonly gasSwapFeeInToken: bigint;

    readonly claimerBounty: bigint;

    secret: string;

    constructor(
        chainIdentifier: string,
        pr: string,
        lnPaymentHash: string,
        claimHash: string,
        amountMtokens: bigint,

        claimer: string,
        token: string,
        gasToken: string,
        amountToken: bigint,
        amountGasToken: bigint,

        tokenSwapFee: bigint,
        tokenSwapFeeInToken: bigint,
        gasSwapFee: bigint,
        gasSwapFeeInToken: bigint,

        claimerBounty: bigint
    );
    constructor(obj: any);

    constructor(
        chainIdOrObj: string | any,
        pr?: string,
        lnPaymentHash?: string,
        claimHash?: string,
        amountMtokens?: bigint,

        claimer?: string,
        token?: string,
        gasToken?: string,
        amountToken?: bigint,
        amountGasToken?: bigint,

        tokenSwapFee?: bigint,
        tokenSwapFeeInToken?: bigint,
        gasSwapFee?: bigint,
        gasSwapFeeInToken?: bigint,

        claimerBounty?: bigint
    ) {
        if(typeof(chainIdOrObj)==="string") {
            super(chainIdOrObj, (amountMtokens + 999n) / 1000n, tokenSwapFee + gasSwapFee, tokenSwapFeeInToken);
            this.state = FromBtcLnAutoSwapState.CREATED;
            this.pr = pr;
            this.lnPaymentHash = lnPaymentHash;
            this.claimHash = claimHash;
            this.claimer = claimer;
            this.token = token;
            this.gasToken = gasToken;
            this.amountToken = amountToken;
            this.amountGasToken = amountGasToken;
            this.tokenSwapFee = tokenSwapFee;
            this.tokenSwapFeeInToken = tokenSwapFeeInToken;
            this.gasSwapFee = gasSwapFee;
            this.gasSwapFeeInToken = gasSwapFeeInToken;
            this.claimerBounty = claimerBounty;
        } else {
            super(chainIdOrObj);
            this.pr = chainIdOrObj.pr;
            this.lnPaymentHash = chainIdOrObj.lnPaymentHash;
            this.claimHash = chainIdOrObj.claimHash;
            this.claimer = chainIdOrObj.claimer;
            this.token = chainIdOrObj.token;
            this.gasToken = chainIdOrObj.gasToken;
            this.amountToken = deserializeBN(chainIdOrObj.amountToken);
            this.amountGasToken = deserializeBN(chainIdOrObj.amountGasToken);
            this.tokenSwapFee = deserializeBN(chainIdOrObj.tokenSwapFee);
            this.tokenSwapFeeInToken = deserializeBN(chainIdOrObj.tokenSwapFeeInToken);
            this.gasSwapFee = deserializeBN(chainIdOrObj.gasSwapFee);
            this.gasSwapFeeInToken = deserializeBN(chainIdOrObj.gasSwapFeeInToken);
            this.claimerBounty = deserializeBN(chainIdOrObj.claimerBounty);
            this.secret = chainIdOrObj.secret;
        }
        this.type = SwapHandlerType.FROM_BTCLN;
    }

    serialize(): any {
        const partialSerialized = super.serialize();
        partialSerialized.pr = this.pr;
        partialSerialized.secret = this.secret;
        partialSerialized.lnPaymentHash = this.lnPaymentHash;
        partialSerialized.claimHash = this.claimHash;
        partialSerialized.claimer = this.claimer;
        partialSerialized.token = this.token;
        partialSerialized.gasToken = this.gasToken;
        partialSerialized.amountToken = serializeBN(this.amountToken);
        partialSerialized.amountGasToken = serializeBN(this.amountGasToken);
        partialSerialized.tokenSwapFee = serializeBN(this.tokenSwapFee);
        partialSerialized.tokenSwapFeeInToken = serializeBN(this.tokenSwapFeeInToken);
        partialSerialized.gasSwapFee = serializeBN(this.gasSwapFee);
        partialSerialized.gasSwapFeeInToken = serializeBN(this.gasSwapFeeInToken);
        partialSerialized.claimerBounty = serializeBN(this.claimerBounty);
        return partialSerialized;
    }

    getIdentifierHash(): string {
        return this.lnPaymentHash;
    }

    getOutputGasAmount(): bigint {
        return this.amountGasToken;
    }

    getOutputAmount(): bigint {
        return this.amountToken;
    }

    getTotalOutputAmount(): bigint {
        return this.amountToken;
    }

    getTotalOutputGasAmount(): bigint {
        return this.amountGasToken + this.claimerBounty;
    }

    getSequence(): bigint {
        return 0n;
    }

    getSwapFee(): { inInputToken: bigint; inOutputToken: bigint } {
        return {inInputToken: this.swapFee, inOutputToken: this.swapFeeInToken};
    }

    getTokenSwapFee(): { inInputToken: bigint; inOutputToken: bigint } {
        return {inInputToken: this.tokenSwapFee, inOutputToken: this.tokenSwapFeeInToken};
    }

    getGasSwapFee(): { inInputToken: bigint; inOutputToken: bigint } {
        return {inInputToken: this.gasSwapFee, inOutputToken: this.gasSwapFeeInToken};
    }

    getToken(): string {
        return this.token;
    }

    getGasToken(): string {
        return this.gasToken;
    }

    isInitiated(): boolean {
        return this.state!==FromBtcLnAutoSwapState.CREATED;
    }

    isFailed(): boolean {
        return this.state===FromBtcLnAutoSwapState.CANCELED || this.state===FromBtcLnAutoSwapState.REFUNDED;
    }

    isSuccess(): boolean {
        return this.state===FromBtcLnAutoSwapState.SETTLED;
    }

}
