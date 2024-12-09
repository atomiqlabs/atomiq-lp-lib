/// <reference types="node" />
import * as BN from "bn.js";
import * as bitcoin from "bitcoinjs-lib";
import { SwapData } from "@atomiqlabs/base";
import { FromBtcBaseSwap } from "../FromBtcBaseSwap";
export declare enum FromBtcSwapState {
    REFUNDED = -2,
    CANCELED = -1,
    CREATED = 0,
    COMMITED = 1,
    CLAIMED = 2
}
export declare class FromBtcSwapAbs<T extends SwapData = SwapData> extends FromBtcBaseSwap<T, FromBtcSwapState> {
    readonly address: string;
    readonly amount: BN;
    authorizationExpiry: BN;
    txId: string;
    constructor(chainIdentifier: string, address: string, amount: BN, swapFee: BN, swapFeeInToken: BN);
    constructor(obj: any);
    serialize(): any;
    getTxoHash(bitcoinNetwork: bitcoin.networks.Network): Buffer;
    isInitiated(): boolean;
    isFailed(): boolean;
    isSuccess(): boolean;
    getTotalInputAmount(): BN;
}
