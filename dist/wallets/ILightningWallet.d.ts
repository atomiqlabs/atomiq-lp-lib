import { Command } from "@atomiqlabs/server-base";
export type IncomingLightningNetworkPayment = {
    createdAt: number;
    confirmedAt: number;
    createdHeight: number;
    timeout: number;
    status: "held" | "canceled" | "confirmed";
    mtokens: bigint;
};
export type LightningNetworkInvoice = {
    id: string;
    request: string;
    secret?: string;
    cltvDelta: number;
    mtokens: bigint;
    createdAt: number;
    expiresAt: number;
    description: string;
    descriptionHash?: string;
    payments: IncomingLightningNetworkPayment[];
    status: "unpaid" | "held" | "canceled" | "confirmed";
};
export type OutgoingLightningNetworkPayment = {
    failedReason?: "insufficient_balance" | "invalid_payment" | "pathfinding_timeout" | "route_not_found";
    status: "confirmed" | "failed" | "pending";
    secret?: string;
    feeMtokens?: bigint;
};
export type LightningNetworkChannel = {
    id: string;
    capacity: bigint;
    isActive: boolean;
    peerPublicKey: string;
    localBalance: bigint;
    localReserve: bigint;
    remoteBalance: bigint;
    remoteReserve: bigint;
    unsettledBalance: bigint;
    transactionId: string;
    transactionVout: number;
};
export type OpenChannelRequest = {
    amountSats: bigint;
    peerPublicKey: string;
    peerAddress?: string;
    feeRate?: number;
    channelFees?: {
        feeRatePPM?: bigint;
        baseFeeMsat?: bigint;
    };
};
export type CloseChannelRequest = {
    channelId: string;
    feeRate?: number;
    forceClose?: boolean;
};
export type InvoiceInit = {
    mtokens: bigint;
    descriptionHash?: string;
    description?: string;
    cltvDelta?: number;
    expiresAt?: number;
};
export type HodlInvoiceInit = {
    description: string;
    cltvDelta: number;
    expiresAt: number;
    id: string;
    mtokens: bigint;
    descriptionHash?: string;
};
export type LNRoutes = {
    publicKey: string;
    feeRate?: number;
    cltvDelta?: number;
    channel?: string;
    baseFeeMtokens?: bigint;
}[][];
export type ParsedPaymentRequest = {
    id: string;
    mtokens: bigint;
    expiryEpochMillis: number;
    destination: string;
    cltvDelta: number;
    description: string;
    routes: LNRoutes;
};
export type LightningPaymentInit = {
    request: string;
    maxFeeMtokens?: bigint;
    maxTimeoutHeight?: number;
};
export type LightningBalanceResponse = {
    localBalance: bigint;
    remoteBalance: bigint;
    unsettledBalance: bigint;
};
export type ProbeAndRouteInit = {
    request: string;
    amountMtokens: bigint;
    maxFeeMtokens: bigint;
    maxTimeoutHeight: number;
};
export type ProbeAndRouteResponse = {
    confidence: number;
    feeMtokens: bigint;
    destination: string;
    privateRoutes: LNRoutes;
};
export declare function routesMatch(routesA: LNRoutes, routesB: LNRoutes): boolean;
export interface ILightningWallet {
    init(): Promise<void>;
    isReady(): boolean;
    getStatus(): string;
    getStatusInfo(): Promise<Record<string, string>>;
    getCommands(): Command<any>[];
    createInvoice(init: InvoiceInit): Promise<LightningNetworkInvoice>;
    createHodlInvoice(init: HodlInvoiceInit): Promise<LightningNetworkInvoice>;
    getInvoice(paymentHash: string): Promise<LightningNetworkInvoice | null>;
    cancelHodlInvoice(paymentHash: string): Promise<void>;
    settleHodlInvoice(secret: string): Promise<void>;
    waitForInvoice(paymentHash: string, abortSignal?: AbortSignal): Promise<LightningNetworkInvoice>;
    pay(init: LightningPaymentInit): Promise<void>;
    getPayment(paymentHash: string): Promise<OutgoingLightningNetworkPayment | null>;
    waitForPayment(paymentHash: string, abortSignal?: AbortSignal): Promise<OutgoingLightningNetworkPayment>;
    probe(init: ProbeAndRouteInit): Promise<ProbeAndRouteResponse | null>;
    route(init: ProbeAndRouteInit): Promise<ProbeAndRouteResponse | null>;
    parsePaymentRequest(request: string): Promise<ParsedPaymentRequest>;
    getBlockheight(): Promise<number>;
    getChannels(activeOnly?: boolean): Promise<LightningNetworkChannel[]>;
    getPendingChannels(): Promise<LightningNetworkChannel[]>;
    openChannel(req: OpenChannelRequest): Promise<LightningNetworkChannel>;
    closeChannel(req: CloseChannelRequest): Promise<string>;
    getLightningBalance(): Promise<LightningBalanceResponse>;
    getIdentityPublicKey(): Promise<string>;
}
