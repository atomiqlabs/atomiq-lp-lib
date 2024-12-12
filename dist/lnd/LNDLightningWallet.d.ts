import { HodlInvoiceInit, ILightningWallet, InvoiceInit, LightningBalanceResponse, LightningNetworkChannel, LightningNetworkInvoice, LightningPaymentInit, OutgoingLightningNetworkPayment, ParsedPaymentRequest, ProbeAndRouteInit, ProbeAndRouteResponse } from "../wallets/ILightningWallet";
import { LNDClient, LNDConfig } from "./LNDClient";
import { Command } from "@atomiqlabs/server-base";
export declare class LNDLightningWallet implements ILightningWallet {
    private readonly lndClient;
    constructor(config: LNDConfig);
    constructor(client: LNDClient);
    init(): Promise<void>;
    isReady(): boolean;
    getStatus(): string;
    getStatusInfo(): Promise<Record<string, string>>;
    getCommands(): Command<any>[];
    getInvoice(paymentHash: string): Promise<LightningNetworkInvoice | null>;
    cancelHodlInvoice(paymentHash: string): Promise<void>;
    settleHodlInvoice(secret: string): Promise<void>;
    getChannels(activeOnly?: boolean): Promise<LightningNetworkChannel[]>;
    getIdentityPublicKey(): Promise<string>;
    createInvoice(init: InvoiceInit): Promise<LightningNetworkInvoice>;
    createHodlInvoice(init: HodlInvoiceInit): Promise<LightningNetworkInvoice>;
    getPayment(paymentHash: string): Promise<OutgoingLightningNetworkPayment | null>;
    waitForPayment(paymentHash: string, abortSignal?: AbortSignal): Promise<OutgoingLightningNetworkPayment>;
    pay(init: LightningPaymentInit): Promise<void>;
    getLightningBalance(): Promise<LightningBalanceResponse>;
    probe(init: ProbeAndRouteInit): Promise<ProbeAndRouteResponse | null>;
    private getRoutes;
    private getRoutesBLIP39;
    route(init: ProbeAndRouteInit): Promise<ProbeAndRouteResponse | null>;
    getBlockheight(): Promise<number>;
    parsePaymentRequest(request: string): Promise<ParsedPaymentRequest>;
    waitForInvoice(paymentHash: string, abortSignal?: AbortSignal): Promise<LightningNetworkInvoice>;
}
