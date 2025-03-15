import {SwapData} from "@atomiqlabs/base";
import {SwapHandlerType} from "../../../index";
import {FromBtcBaseSwap} from "../FromBtcBaseSwap";
import {deserializeBN, serializeBN} from "../../../utils/Utils";

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
    lnPaymentHash: string;

    readonly claimer: string;
    readonly token: string;
    readonly totalTokens: bigint;
    readonly claimHash: string;
    readonly securityDeposit: bigint;
    readonly depositToken: string;

    secret: string;

    constructor(
        chainIdentifier: string,
        pr: string,
        lnPaymentHash: string,
        amountMtokens: bigint,
        swapFee: bigint,
        swapFeeInToken: bigint,
        claimer: string,
        token: string,
        totalTokens: bigint,
        claimHash: string,
        securityDeposit: bigint,
        depositToken: string
    );
    constructor(obj: any);

    constructor(
        chainIdOrObj: string | any,
        pr?: string,
        lnPaymentHash?: string,
        amountMtokens?: bigint,
        swapFee?: bigint,
        swapFeeInToken?: bigint,
        claimer?: string,
        token?: string,
        totalTokens?: bigint,
        claimHash?: string,
        securityDeposit?: bigint,
        depositToken?: string
    ) {
        if(typeof(chainIdOrObj)==="string") {
            super(chainIdOrObj, (amountMtokens + 999n) / 1000n, swapFee, swapFeeInToken);
            this.state = FromBtcLnSwapState.CREATED;
            this.pr = pr;
            this.lnPaymentHash = lnPaymentHash;
            this.claimer = claimer;
            this.token = token;
            this.totalTokens = totalTokens;
            this.claimHash = claimHash;
            this.securityDeposit = securityDeposit;
            this.depositToken = depositToken;
        } else {
            super(chainIdOrObj);
            this.pr = chainIdOrObj.pr;
            this.lnPaymentHash = chainIdOrObj.lnPaymentHash;
            this.claimer = chainIdOrObj.claimer;
            this.token = chainIdOrObj.token;
            this.totalTokens = deserializeBN(chainIdOrObj.totalTokens);
            this.claimHash = chainIdOrObj.claimHash;
            this.securityDeposit = deserializeBN(chainIdOrObj.securityDeposit);
            this.secret = chainIdOrObj.secret;
            this.depositToken = chainIdOrObj.depositToken;

            //Compatibility
            if(this.state===FromBtcLnSwapState.CREATED && this.data!=null) {
                this.claimer = this.data.getClaimer();
                this.token = this.data.getToken();
                this.totalTokens = this.data.getAmount();
                this.claimHash = this.data.getClaimHash();
                this.securityDeposit = this.data.getSecurityDeposit();
            }
        }
        this.type = SwapHandlerType.FROM_BTCLN;
    }

    serialize(): any {
        const partialSerialized = super.serialize();
        partialSerialized.pr = this.pr;
        partialSerialized.secret = this.secret;
        partialSerialized.lnPaymentHash = this.lnPaymentHash;
        partialSerialized.claimer = this.claimer;
        partialSerialized.token = this.token;
        partialSerialized.totalTokens = serializeBN(this.totalTokens);
        partialSerialized.claimHash = this.claimHash;
        partialSerialized.securityDeposit = serializeBN(this.securityDeposit);
        partialSerialized.depositToken = this.depositToken;
        return partialSerialized;
    }

    getToken(): string {
        return this.token;
    }

    getOutputAmount(): bigint {
        return this.totalTokens;
    }

    getIdentifierHash(): string {
        return this.lnPaymentHash;
    }

    getSequence(): bigint {
        return 0n;
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
