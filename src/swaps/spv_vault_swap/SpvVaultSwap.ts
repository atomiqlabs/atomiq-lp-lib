import {SwapHandlerSwap} from "../SwapHandlerSwap";
import {SpvVault} from "./SpvVault";
import {deserializeBN, serializeBN} from "../../utils/Utils";
import {SwapHandlerType} from "../SwapHandler";

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

    readonly quoteId: string;

    readonly vaultOwner: string;
    readonly vaultId: bigint;
    readonly vaultUtxo: string;
    readonly vaultAddress: string;

    readonly expiry: number;

    readonly tokenMultiplier: bigint;
    readonly gasTokenMultiplier: bigint;

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
        chainIdentifier: string, quoteId: string, expiry: number,
        vault: SpvVault, vaultUtxo: string,
        btcAddress: string, btcFeeRate: number, recipient: string, amountBtc: bigint, amountToken: bigint, amountGasToken: bigint,
        swapFee: bigint, swapFeeInToken: bigint,
        gasSwapFee: bigint, gasSwapFeeInToken: bigint,
        callerFeeShare: bigint, frontingFeeShare: bigint, executionFeeShare: bigint,
        token: string, gasToken: string
    );
    constructor(data: any);
    constructor(
        chainIdentifierOrObj: string | any, quoteId?: string, expiry?: number,
        vault?: SpvVault, vaultUtxo?: string,
        btcAddress?: string, btcFeeRate?: number, recipient?: string, amountBtc?: bigint, amountToken?: bigint, amountGasToken?: bigint,
        swapFee?: bigint, swapFeeInToken?: bigint,
        gasSwapFee?: bigint, gasSwapFeeInToken?: bigint,
        callerFeeShare?: bigint, frontingFeeShare?: bigint, executionFeeShare?: bigint,
        token?: string, gasToken?: string
    ) {
        if(typeof(chainIdentifierOrObj)==="string") {
            super(chainIdentifierOrObj, swapFee + gasSwapFee, swapFeeInToken);
            this.state = SpvVaultSwapState.CREATED;
            this.quoteId = quoteId;
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
            this.tokenMultiplier = vault.data.getTokenData()[0].multiplier;
            this.gasToken = gasToken;
            this.gasTokenMultiplier = vault.data.getTokenData()[1].multiplier;
        } else {
            super(chainIdentifierOrObj);
            this.quoteId = chainIdentifierOrObj.quoteId;
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
            this.tokenMultiplier = deserializeBN(chainIdentifierOrObj.tokenMultiplier);
            this.gasTokenMultiplier = deserializeBN(chainIdentifierOrObj.gasTokenMultiplier);
            this.btcTxId = chainIdentifierOrObj.btcTxId;
        }
        this.type = SwapHandlerType.FROM_BTC_SPV;
    }

    serialize(): any {
        return {
            ...super.serialize(),
            quoteId: this.quoteId,
            expiry: this.expiry,
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
            tokenMultiplier: serializeBN(this.tokenMultiplier),
            gasTokenMultiplier: serializeBN(this.gasTokenMultiplier),
            btcTxId: this.btcTxId
        };
    }

    getIdentifierHash(): string {
        return this.quoteId;
    }

    getOutputGasAmount(): bigint {
        return this.amountGasToken;
    }

    getOutputAmount(): bigint {
        return this.amountToken;
    }

    getTotalOutputAmount(): bigint {
        return this.rawAmountToken * (100_000n + this.callerFeeShare + this.frontingFeeShare + this.executionFeeShare) / 100_000n * this.tokenMultiplier;
    }

    getTotalOutputGasAmount(): bigint {
        return this.rawAmountGasToken * (100_000n + this.callerFeeShare + this.frontingFeeShare) / 100_000n * this.gasTokenMultiplier;
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
