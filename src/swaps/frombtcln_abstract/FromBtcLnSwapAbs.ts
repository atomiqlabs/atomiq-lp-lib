import * as BN from "bn.js";
import {SwapData} from "@atomiqlabs/base";
import {SwapHandlerType} from "../..";
import {FromBtcBaseSwap} from "../FromBtcBaseSwap";
import {deserializeBN, serializeBN} from "../../utils/Utils";

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
    readonly totalTokens: BN;
    readonly claimHash: string;
    readonly securityDeposit: BN;
    readonly depositToken: string;

    secret: string;

    constructor(
        chainIdentifier: string,
        pr: string,
        lnPaymentHash: string,
        amountMtokens: BN,
        swapFee: BN,
        swapFeeInToken: BN,
        claimer: string,
        token: string,
        totalTokens: BN,
        claimHash: string,
        securityDeposit: BN,
        depositToken: string
    );
    constructor(obj: any);

    constructor(
        chainIdOrObj: string | any,
        pr?: string,
        lnPaymentHash?: string,
        amountMtokens?: BN,
        swapFee?: BN,
        swapFeeInToken?: BN,
        claimer?: string,
        token?: string,
        totalTokens?: BN,
        claimHash?: string,
        securityDeposit?: BN,
        depositToken?: string
    ) {
        if(typeof(chainIdOrObj)==="string") {
            super(chainIdOrObj, amountMtokens.add(new BN(999)).div(new BN(1000)), swapFee, swapFeeInToken);
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

    getIdentifierHash(): string {
        return this.lnPaymentHash;
    }

    getSequence(): BN {
        return new BN(0);
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
