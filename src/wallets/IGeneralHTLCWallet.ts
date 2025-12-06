import {Command} from "@atomiqlabs/server-base";

export enum HTLCStatus {
    CONFIRMATION_PENDING = 0,
    CONFIRMED = 1,
    SETTLED = 2,
    REFUNDABLE = 3,
    EXPIRED = 4
}

export type HTLC = {
    id: string,
    paymentHash: string,
    offerer: string,
    claimer: string,
    expiryTimeEpochSeconds: number,
    status: HTLCStatus,
    preimage?: string,
    createTxId: string,
    refundTxId?: string,
    claimTxId?: string
}

export interface IGeneralHTLCWallet {

    init(): Promise<void>;

    isReady(): boolean;
    getStatus(): string;
    getStatusInfo(): Promise<Record<string, string>>;
    getCommands(): Command<any>[];

    getFeeRate(): Promise<number>;
    estimateCreateFee(recipient: string, amountSats: bigint, feeRate?: number): Promise<{feeRate: number, totalFee: bigint}>;
    estimateRefundFee(recipient: string, amountSats: bigint, feeRate?: number): Promise<{feeRate: number, totalFee: bigint}>;
    estimateClaimFee(recipient: string, amountSats: bigint, feeRate?: number): Promise<{feeRate: number, totalFee: bigint}>;

    transfer(recipient: string, amountSats: bigint, feeRate?: number): Promise<{txId: string, totalFee: bigint}>;
    getAddress(): Promise<string>;

    createHtlc(preimage: string, recipient: string, amountSats: bigint, expiryTimeEpochSeconds: number, feeRate?: number): Promise<{htlc: HTLC, totalFee: bigint}>;
    queryHtlc(id: string | string[]): Promise<HTLC[]>;
    refundHtlc(id: string, feeRate?: number): Promise<{htlc: HTLC, totalFee: bigint}>;
    claimHtlc(id: string, preimage: string, feeRate?: number): Promise<{htlc: HTLC, totalFee: bigint}>;

}
