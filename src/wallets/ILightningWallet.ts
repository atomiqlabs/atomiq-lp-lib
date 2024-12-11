import * as BN from "bn.js";

export type IncomingLightningNetworkPayment = {
    createdAt: number,
    confirmedAt: number,

    createdHeight: number,
    timeout: number,

    status: "held" | "canceled" | "confirmed"

    mtokens: BN
}

export type LightningNetworkInvoice = {
    id: string,
    request: string,
    secret?: string,

    cltvDelta: number,
    mtokens: BN,

    createdAt: number,
    expiresAt: number,

    description: string,
    descriptionHash?: string,

    payments: IncomingLightningNetworkPayment[],

    status: "unpaid" | "held" | "canceled" | "confirmed"
};

export type OutgoingLightningNetworkPayment = {
    failedReason?: "insufficient_balance" | "invalid_payment" | "pathfinding_timeout" | "route_not_found",
    status: "confirmed" | "failed" | "pending",
    secret?: string,
    feeMtokens?: BN
};

export type LightningNetworkChannel = {
    id: string,
    capacity: BN,
    isActive: boolean,

    localBalance: BN,
    localReserve: BN,
    remoteBalance: BN,
    remoteReserve: BN,
    unsettledBalance: BN,
    transactionId: string,
    transactionVout: number
};

export type InvoiceInit = {
    mtokens: BN,
    descriptionHash?: string
    description?: string,
    cltvDelta?: number,
    expiresAt?: number,
};

export type HodlInvoiceInit = {
    description: string,
    cltvDelta: number,
    expiresAt: number,
    id: string,
    mtokens: BN,
    descriptionHash?: string
};

export type LNRoutes = {
    publicKey: string,
    feeRate?: number,
    cltvDelta?: number,
    channel?: string,
    baseFeeMtokens?: BN
}[][];

export type ParsedPaymentRequest = {
    id: string,
    mtokens: BN,
    expiryEpochMillis: number,
    destination: string,
    cltvDelta: number,
    description: string,
    routes: LNRoutes
};

export type LightningPaymentInit = {
    request: string,
    maxFeeMtokens: BN,
    maxTimeoutHeight: number
};

export type LightningBalanceResponse = {
    localBalance: BN,
    remoteBalance: BN,
    unsettledBalance: BN
};

export type ProbeAndRouteInit = {
    request: string,
    amountMtokens: BN,
    maxFeeMtokens: BN,
    maxTimeoutHeight: number
}

export type ProbeAndRouteResponse = {
    confidence: number,
    feeMtokens: BN,
    destination: string,
    privateRoutes: LNRoutes
}

export function routesMatch(routesA: LNRoutes, routesB: LNRoutes) {
    if(routesA===routesB) return true;
    if(routesA==null || routesB==null) {
        return false;
    }
    if(routesA.length!==routesB.length) return false;
    for(let i=0;i<routesA.length;i++) {
        if(routesA[i]===routesB[i]) continue;
        if(routesA[i]==null || routesB[i]==null) {
            return false;
        }
        if(routesA[i].length!==routesB[i].length) return false;
        for(let e=0;e<routesA[i].length;e++) {
            if(routesA[i][e]===routesB[i][e]) continue;
            if(routesA[i][e]==null || routesB[i][e]==null) {
                return false;
            }
            if(
                routesA[i][e].publicKey!==routesB[i][e].publicKey ||
                !routesA[i][e].baseFeeMtokens.eq(routesB[i][e].baseFeeMtokens) ||
                routesA[i][e].channel!==routesB[i][e].channel ||
                routesA[i][e].cltvDelta!==routesB[i][e].cltvDelta ||
                routesA[i][e].feeRate!==routesB[i][e].feeRate
            ) {
                return false;
            }
        }
    }

    return true;
}

export interface ILightningWallet {

    init(): Promise<void>;

    createInvoice(init: InvoiceInit): Promise<LightningNetworkInvoice>;
    createHodlInvoice(init: HodlInvoiceInit): Promise<LightningNetworkInvoice>;
    getInvoice(paymentHash: string): Promise<LightningNetworkInvoice | null>;
    cancelHodlInvoice(paymentHash: string): Promise<void>;
    settleHodlInvoice(secret: string): Promise<void>;
    waitForInvoice(paymentHash: string, abortSignal?: AbortSignal): Promise<LightningNetworkInvoice>;

    pay(init: LightningPaymentInit): Promise<void>;
    getPayment(paymentHash: string): Promise<OutgoingLightningNetworkPayment | null>
    waitForPayment(paymentHash: string, abortSignal?: AbortSignal): Promise<OutgoingLightningNetworkPayment>;
    probe(init: ProbeAndRouteInit): Promise<ProbeAndRouteResponse | null>;
    route(init: ProbeAndRouteInit): Promise<ProbeAndRouteResponse | null>;

    parsePaymentRequest(request: string): Promise<ParsedPaymentRequest>;

    getBlockheight(): Promise<number>;
    getChannels(activeOnly?: boolean): Promise<LightningNetworkChannel[]>;
    getLightningBalance(): Promise<LightningBalanceResponse>;

    getIdentityPublicKey(): Promise<string>;

}
