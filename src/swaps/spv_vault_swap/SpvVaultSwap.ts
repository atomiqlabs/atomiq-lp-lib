import {SwapHandlerSwap} from "../SwapHandlerSwap";
import {SpvVault} from "./SpvVault";
import {deserializeBN, serializeBN} from "../../utils/Utils";

export enum SpvVaultSwapState {
    FAILED = -3,
    DOUBLE_SPENT = -2,
    EXPIRED = -1,
    CREATED = 0,
    SIGNED = 1,
    SENT = 2,
    BTC_CONFIRMED = 3,
    CLAIMED = 4
}

export class SpvVaultSwap extends SwapHandlerSwap<SpvVaultSwapState> {

    readonly vaultOwner: string;
    readonly vaultId: bigint;
    readonly vaultUtxo: string;
    readonly vaultAddress: string;

    readonly expiry: number;

    readonly tokenSwapFee: bigint;
    readonly tokenSwapFeeInToken: bigint;
    readonly gasSwapFee: bigint;
    readonly gasSwapFeeInToken: bigint;

    readonly btcFeeRate: number;
    readonly btcAddress: string;
    readonly recipient: string;
    readonly amountBtc: bigint;
    readonly amountToken: bigint;
    readonly amountGasToken: bigint;
    readonly rawAmountToken: bigint;
    readonly rawAmountGasToken: bigint;
    readonly callerFeeShare: bigint;
    readonly frontingFeeShare: bigint;
    readonly executionFeeShare: bigint;

    readonly token: string;
    readonly gasToken: string;

    btcTxId: string;

    constructor(
        chainIdentifier: string, expiry: number,
        vault: SpvVault, vaultUtxo: string,
        btcAddress: string, btcFeeRate: number, recipient: string, amountBtc: bigint, amountToken: bigint, amountGasToken: bigint,
        swapFee: bigint, swapFeeInToken: bigint,
        gasSwapFee: bigint, gasSwapFeeInToken: bigint,
        callerFeeShare: bigint, frontingFeeShare: bigint, executionFeeShare: bigint,
        token: string, gasToken: string
    );
    constructor(data: any);
    constructor(
        chainIdentifierOrObj: string | any, expiry?: number,
        vault?: SpvVault, vaultUtxo?: string,
        btcAddress?: string, btcFeeRate?: number, recipient?: string, amountBtc?: bigint, amountToken?: bigint, amountGasToken?: bigint,
        swapFee?: bigint, swapFeeInToken?: bigint,
        gasSwapFee?: bigint, gasSwapFeeInToken?: bigint,
        callerFeeShare?: bigint, frontingFeeShare?: bigint, executionFeeShare?: bigint,
        token?: string, gasToken?: string
    ) {
        if(typeof(chainIdentifierOrObj)==="string") {
            super(chainIdentifierOrObj, swapFee + gasSwapFee, swapFeeInToken * (swapFee + gasSwapFee) / swapFee);
            this.expiry = expiry;
            this.vaultOwner = vault.data.getOwner();
            this.vaultId = vault.data.getVaultId();
            this.vaultAddress = vault.btcAddress;
            this.vaultUtxo = vaultUtxo;
            this.tokenSwapFee = swapFee;
            this.tokenSwapFeeInToken = swapFeeInToken;
            this.gasSwapFee = gasSwapFee;
            this.gasSwapFeeInToken = gasSwapFeeInToken;
            this.btcFeeRate = btcFeeRate;
            this.btcAddress = btcAddress;
            this.recipient = recipient;
            this.amountBtc = amountBtc;
            this.amountToken = amountToken;
            this.amountGasToken = amountGasToken;
            const [rawAmountToken, rawAmountGasToken] = vault.toRawAmounts([amountToken, amountGasToken]);
            this.rawAmountToken = rawAmountToken;
            this.rawAmountGasToken = rawAmountGasToken;
            this.callerFeeShare = callerFeeShare;
            this.frontingFeeShare = frontingFeeShare;
            this.executionFeeShare = executionFeeShare;
            this.token = token;
            this.gasToken = gasToken;
        } else {
            super(chainIdentifierOrObj);
            this.expiry = chainIdentifierOrObj.expiry;
            this.vaultOwner = chainIdentifierOrObj.owner;
            this.vaultId = deserializeBN(chainIdentifierOrObj.vaultId);
            this.vaultAddress = chainIdentifierOrObj.vaultAddress;
            this.vaultUtxo = chainIdentifierOrObj.vaultUtxo;
            this.tokenSwapFee = deserializeBN(chainIdentifierOrObj.swapFee);
            this.tokenSwapFeeInToken = deserializeBN(chainIdentifierOrObj.swapFeeInToken);
            this.gasSwapFee = deserializeBN(chainIdentifierOrObj.gasSwapFee);
            this.gasSwapFeeInToken = deserializeBN(chainIdentifierOrObj.gasSwapFeeInToken);
            this.btcFeeRate = chainIdentifierOrObj.btcFeeRate;
            this.btcAddress = chainIdentifierOrObj.btcAddress;
            this.recipient = chainIdentifierOrObj.recipient;
            this.amountBtc = deserializeBN(chainIdentifierOrObj.amountBtc);
            this.amountToken = deserializeBN(chainIdentifierOrObj.amountToken);
            this.amountGasToken = deserializeBN(chainIdentifierOrObj.amountGasToken);
            this.rawAmountToken = deserializeBN(chainIdentifierOrObj.rawAmountToken);
            this.rawAmountGasToken = deserializeBN(chainIdentifierOrObj.rawAmountGasToken);
            this.callerFeeShare = deserializeBN(chainIdentifierOrObj.callerFeeShare);
            this.frontingFeeShare = deserializeBN(chainIdentifierOrObj.frontingFeeShare);
            this.executionFeeShare = deserializeBN(chainIdentifierOrObj.executionFeeShare);
            this.token = chainIdentifierOrObj.token;
            this.gasToken = chainIdentifierOrObj.gasToken;
            this.btcTxId = chainIdentifierOrObj.btcTxId;
        }
    }

    serialize(): any {
        return {
            ...super.serialize(),
            owner: this.vaultOwner,
            vaultId: serializeBN(this.vaultId),
            vaultAddress: this.vaultAddress,
            vaultUtxo: this.vaultUtxo,
            tokenSwapFee: serializeBN(this.tokenSwapFee),
            tokenSwapFeeInToken: serializeBN(this.tokenSwapFeeInToken),
            gasSwapFee: serializeBN(this.gasSwapFee),
            gasSwapFeeInToken: serializeBN(this.gasSwapFeeInToken),
            btcFeeRate: this.btcFeeRate,
            btcAddress: this.btcAddress,
            recipient: this.recipient,
            amountBtc: serializeBN(this.amountBtc),
            amountToken: serializeBN(this.amountToken),
            amountGasToken: serializeBN(this.amountGasToken),
            rawAmountToken: serializeBN(this.rawAmountToken),
            rawAmountGasToken: serializeBN(this.rawAmountGasToken),
            callerFeeShare: serializeBN(this.callerFeeShare),
            frontingFeeShare: serializeBN(this.frontingFeeShare),
            executionFeeShare: serializeBN(this.executionFeeShare),
            token: this.token,
            gasToken: this.gasToken,
            btcTxId: this.btcTxId
        };
    }

    getIdentifierHash(): string {
        return this.btcTxId ?? "OUTSTANDING";
    }

    getOutputGasAmount(): bigint {
        return this.amountGasToken;
    }

    getOutputAmount(): bigint {
        return this.amountToken;
    }

    getSequence(): bigint | null {
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

    getTotalInputAmount(): bigint {
        return this.amountBtc;
    }

    isFailed(): boolean {
        return this.state===SpvVaultSwapState.FAILED || this.state===SpvVaultSwapState.DOUBLE_SPENT;
    }

    isInitiated(): boolean {
        return this.state!==SpvVaultSwapState.CREATED;
    }

    isSuccess(): boolean {
        return this.state===SpvVaultSwapState.CLAIMED;
    }

}
