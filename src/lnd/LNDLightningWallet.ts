import {
    HodlInvoiceInit,
    ILightningWallet, InvoiceInit,
    LightningBalanceResponse,
    LightningNetworkChannel,
    LightningNetworkInvoice,
    LightningPaymentInit, LNRoutes,
    OutgoingLightningNetworkPayment, ParsedPaymentRequest,
    ProbeAndRouteInit,
    ProbeAndRouteResponse
} from "../wallets/ILightningWallet";
import {
    cancelHodlInvoice,
    createHodlInvoice, createInvoice,
    getChannelBalance,
    getChannels,
    getHeight,
    getInvoice,
    getPayment,
    getRouteToDestination,
    getWalletInfo,
    pay,
    probeForRoute,
    settleHodlInvoice,
    subscribeToInvoice,
    SubscribeToInvoiceInvoiceUpdatedEvent,
    subscribeToPastPayment
} from "lightning";
import {parsePaymentRequest} from "ln-service";
import * as BN from "bn.js";
import {Array} from "bitcoinjs-lib/src/types";
import {handleLndError} from "../utils/Utils";
import * as bolt11 from "@atomiqlabs/bolt11";
import {TagsObject} from "@atomiqlabs/bolt11";
import {LNDClient, LNDConfig} from "./LNDClient";


//Check for lightning nodes which don't properly handle probe requests
const SNOWFLAKE_LIST: Set<string> = new Set([
    "038f8f113c580048d847d6949371726653e02b928196bad310e3eda39ff61723f6"
]);

function isSnowflake(routes: LNRoutes | null) {
    let is_snowflake: boolean = false;
    if(routes!=null) {
        for(let route of routes) {
            if(SNOWFLAKE_LIST.has(route[0].publicKey) || SNOWFLAKE_LIST.has(route[1].publicKey)) {
                is_snowflake = true;
            }
        }
    }
    return is_snowflake;
}

function fromLndRoutes(routes: {base_fee_mtokens: string, channel: string, cltv_delta: number, fee_rate: number, public_key: string}[][]): LNRoutes {
    return routes.map(arr => arr.map(route => {
        return {
            baseFeeMtokens: new BN(route.base_fee_mtokens),
            channel: route.channel,
            cltvDelta: route.cltv_delta,
            feeRate: route.fee_rate,
            publicKey: route.public_key,
        }
    }))
}

export class LNDLightningWallet implements ILightningWallet{

    private readonly lndClient: LNDClient;

    constructor(config: LNDConfig);
    constructor(client: LNDClient);
    constructor(configOrClient: LNDConfig | LNDClient) {
        if(configOrClient instanceof LNDClient) {
            this.lndClient = configOrClient;
        } else {
            this.lndClient = new LNDClient(configOrClient);
        }
    }

    init(): Promise<void> {
        return this.lndClient.init();
    }

    async getInvoice(paymentHash: string): Promise<LightningNetworkInvoice | null> {
        const result = await getInvoice({id: paymentHash, lnd: this.lndClient.lnd});
        if(result==null) return null;
        return {
            id: result.id,
            request: result.request,
            secret: result.secret,

            cltvDelta: result.cltv_delta,
            mtokens: new BN((result as any).mtokens),

            createdAt: new Date(result.created_at).getTime(),
            expiresAt: new Date(result.expires_at).getTime(),

            description: result.description,
            descriptionHash: result.description_hash,

            status: result.is_canceled ? "canceled" : result.is_confirmed ? "confirmed" : result.is_held ? "held" : "unpaid",

            payments: result.payments==null ? [] : result.payments.map(payment => {
                return {
                    createdAt: new Date(payment.created_at).getTime(),
                    confirmedAt: payment.confirmed_at==null ? null : new Date(payment.confirmed_at).getTime(),

                    createdHeight: payment.created_height,
                    timeout: payment.timeout,

                    status: payment.is_canceled ? "canceled" : payment.is_confirmed ? "confirmed" : payment.is_held ? "held" : null,

                    mtokens: new BN(payment.mtokens)
                }
            })
        }
    }

    cancelHodlInvoice(paymentHash: string): Promise<void> {
        return cancelHodlInvoice({
            id: paymentHash,
            lnd: this.lndClient.lnd
        });
    }

    settleHodlInvoice(secret: string): Promise<void> {
        return settleHodlInvoice({
            secret,
            lnd: this.lndClient.lnd
        });
    }

    async getChannels(activeOnly?: boolean): Promise<LightningNetworkChannel[]> {
        const {channels} = await getChannels({
            is_active: activeOnly,
            lnd: this.lndClient.lnd
        });

        return channels.map(channel => {
            return {
                id: channel.id,
                capacity: new BN(channel.capacity),
                isActive: channel.is_active,

                localBalance: new BN(channel.local_balance),
                localReserve: new BN(channel.local_reserve),
                remoteBalance: new BN(channel.remote_balance),
                remoteReserve: new BN(channel.remote_reserve),
                unsettledBalance: new BN(channel.unsettled_balance),
                transactionId: channel.transaction_id,
                transactionVout: channel.transaction_vout
            }
        });
    }

    async getIdentityPublicKey(): Promise<string> {
        const info = await getWalletInfo({lnd: this.lndClient.lnd});
        return info.public_key;
    }

    async createInvoice(init: InvoiceInit): Promise<LightningNetworkInvoice> {
        const invoice = await createInvoice({
            description: init.description,
            description_hash: init.descriptionHash,
            cltv_delta: init.cltvDelta,
            expires_at: init.expiresAt==null ? null : new Date(init.expiresAt).toISOString(),
            mtokens: init.mtokens.toString(10),
            lnd: this.lndClient.lnd
        });

        return {
            id: invoice.id,
            request: invoice.request,
            secret: null,

            cltvDelta: init.cltvDelta,
            mtokens: init.mtokens,

            createdAt: new Date(invoice.created_at).getTime(),
            expiresAt: init.expiresAt,

            description: invoice.description,
            descriptionHash: init.descriptionHash,

            status: "unpaid",

            payments: []
        };
    }

    async createHodlInvoice(init: HodlInvoiceInit): Promise<LightningNetworkInvoice> {
        const invoice = await createHodlInvoice({
            description: init.description,
            cltv_delta: init.cltvDelta,
            expires_at: new Date(init.expiresAt).toISOString(),
            id: init.id,
            mtokens: init.mtokens.toString(10),
            description_hash: init.descriptionHash,
            lnd: this.lndClient.lnd
        });

        return {
            id: invoice.id,
            request: invoice.request,
            secret: null,

            cltvDelta: init.cltvDelta,
            mtokens: init.mtokens,

            createdAt: new Date(invoice.created_at).getTime(),
            expiresAt: init.expiresAt,

            description: invoice.description,
            descriptionHash: init.descriptionHash,

            status: "unpaid",

            payments: []
        };
    }

    async getPayment(paymentHash: string): Promise<OutgoingLightningNetworkPayment | null> {
        try {
            const payment =  await getPayment({
                id: paymentHash,
                lnd: this.lndClient.lnd
            });
            return {
                status: payment.is_confirmed ? "confirmed" : payment.is_pending ? "pending" : payment.is_failed ? "failed" : null,
                failedReason: payment.failed==null ? undefined :
                    payment.failed.is_invalid_payment ? "invalid_payment" :
                        payment.failed.is_pathfinding_timeout ? "pathfinding_timeout" :
                            payment.failed.is_route_not_found ? "route_not_found" :
                                payment.failed.is_insufficient_balance ? "insufficient_balance" : null,
                secret: payment.payment?.secret,
                feeMtokens: payment.payment!=null ? new BN(payment.payment.fee_mtokens) : undefined,
            }
        } catch (e) {
            if (Array.isArray(e) && e[0] === 404 && e[1] === "SentPaymentNotFound") return null;
            throw e;
        }
    }

    waitForPayment(paymentHash: string, abortSignal?: AbortSignal): Promise<OutgoingLightningNetworkPayment> {
        const subscription = subscribeToPastPayment({id: paymentHash, lnd: this.lndClient.lnd});

        return new Promise<OutgoingLightningNetworkPayment>((resolve, reject) => {
            if(abortSignal!=null) {
                abortSignal.throwIfAborted();
                abortSignal.addEventListener("abort", () => {
                    subscription.removeAllListeners();
                    reject(abortSignal.reason);
                })
            }
            subscription.on('confirmed', (payment) => {
                resolve({
                    status: "confirmed",
                    feeMtokens: new BN(payment.fee_mtokens),
                    secret: payment.secret
                });
                subscription.removeAllListeners();
            });
            subscription.on('failed', (data) => {
                resolve({
                    status: "failed",
                    failedReason: data.is_invalid_payment ? "invalid_payment" :
                        data.is_pathfinding_timeout ? "pathfinding_timeout" :
                            data.is_route_not_found ? "route_not_found" :
                                data.is_insufficient_balance ? "insufficient_balance" : null,
                });
                subscription.removeAllListeners();
            });
        });
    }

    async pay(init: LightningPaymentInit): Promise<void> {
        await pay({
            request: init.request,
            max_fee_mtokens: init.maxFeeMtokens.toString(10),
            max_timeout_height: init.maxTimeoutHeight,
            lnd: this.lndClient.lnd
        });
    }

    async getLightningBalance(): Promise<LightningBalanceResponse> {
        const resp = await getChannelBalance({lnd: this.lndClient.lnd});
        return {
            localBalance: new BN(resp.channel_balance),
            remoteBalance: new BN(resp.inbound),
            unsettledBalance: new BN(resp.unsettled_balance)
        };
    }

    async probe(init: ProbeAndRouteInit): Promise<ProbeAndRouteResponse | null> {
        const bolt11Parsed = bolt11.decode(init.request);
        if(bolt11Parsed.tagsObject.blinded_payinfo!=null && bolt11Parsed.tagsObject.blinded_payinfo.length>0) {
            //Cannot probe bLIP-39 blinded path invoices
            return null;
        }
        const parsedRequest = parsePaymentRequest({
            request: init.request
        });

        if(isSnowflake(parsedRequest.routes)) return null;

        try {
            const result = await probeForRoute({
                mtokens: init.amountMtokens.toString(10),
                total_mtokens: init.amountMtokens.toString(10),
                max_fee_mtokens: init.maxFeeMtokens.toString(10),
                max_timeout_height: init.maxTimeoutHeight,
                payment: parsedRequest.payment,
                destination: parsedRequest.destination,
                cltv_delta: parsedRequest.cltv_delta,
                routes: parsedRequest.routes,
                lnd: this.lndClient.lnd
            });
            if(result.route==null) return null;
            return {
                confidence: result.route.confidence,
                feeMtokens: new BN(result.route.fee_mtokens),
                destination: parsedRequest.destination,
                privateRoutes: fromLndRoutes(parsedRequest.routes)
            }
        } catch (e) {
            handleLndError(e);
            return null;
        }
    }

    private async getRoutes(init: ProbeAndRouteInit): Promise<ProbeAndRouteResponse | null> {
        const parsedRequest = parsePaymentRequest({
            request: init.request
        });
        try {
            const result = await getRouteToDestination({
                mtokens: init.amountMtokens.toString(10),
                total_mtokens: init.amountMtokens.toString(10),
                max_fee_mtokens: init.maxFeeMtokens.toString(10),
                max_timeout_height: init.maxTimeoutHeight,
                payment: parsedRequest.payment,
                destination: parsedRequest.destination,
                cltv_delta: parsedRequest.cltv_delta,
                routes: parsedRequest.routes,
                lnd: this.lndClient.lnd
            });
            if(result.route==null) return null;
            return {
                confidence: result.route.confidence,
                feeMtokens: new BN(result.route.fee_mtokens),
                destination: parsedRequest.destination,
                privateRoutes: fromLndRoutes(parsedRequest.routes)
            }
        } catch (e) {
            handleLndError(e);
            return null;
        }
    }

    private async getRoutesBLIP39(init: ProbeAndRouteInit, bolt11Parsed: { tagsObject: TagsObject; }): Promise<ProbeAndRouteResponse | null> {
        const parsedRequest = parsePaymentRequest({
            request: init.request
        });
        const routeReqs = bolt11Parsed.tagsObject.blinded_payinfo.map(async (blindedPath) => {
            if(blindedPath.cltv_expiry_delta+10>init.maxTimeoutHeight) return null;

            const originalMsatAmount = new BN(parsedRequest.mtokens);
            const blindedFeeTotalMsat = new BN(blindedPath.fee_base_msat)
                .add(originalMsatAmount.mul(new BN(blindedPath.fee_proportional_millionths)).div(new BN(1000000)));

            const routeReq = {
                destination: blindedPath.introduction_node,
                cltv_delta: Math.max(blindedPath.cltv_expiry_delta, parsedRequest.cltv_delta),
                mtokens: originalMsatAmount.add(blindedFeeTotalMsat).toString(10),
                max_fee_mtokens: init.maxFeeMtokens.sub(blindedFeeTotalMsat).toString(10),
                max_timeout_height: init.maxTimeoutHeight,
                routes: parsedRequest.routes,
                is_ignoring_past_failures: true,
                lnd: this.lndClient.lnd
            };

            try {
                const resp = await getRouteToDestination(routeReq);

                if(resp==null || resp.route==null) return null;

                const adjustedFeeMsats = new BN(resp.route.fee_mtokens).add(blindedFeeTotalMsat);
                resp.route.fee_mtokens = adjustedFeeMsats.toString(10);
                resp.route.fee = adjustedFeeMsats.div(new BN(1000)).toNumber();
                resp.route.safe_fee = adjustedFeeMsats.add(new BN(999)).div(new BN(1000)).toNumber();
                const totalAdjustedMsats = new BN(routeReq.mtokens).add(blindedFeeTotalMsat);
                resp.route.mtokens = totalAdjustedMsats.toString(10);
                resp.route.tokens = totalAdjustedMsats.div(new BN(1000)).toNumber();
                resp.route.safe_tokens = totalAdjustedMsats.add(new BN(999)).div(new BN(1000)).toNumber();

                return resp.route;
            } catch (e) {
                handleLndError(e);
                return null;
            }
        });

        const responses = await Promise.all(routeReqs);

        const result = responses.reduce((prev, current) => {
            if(prev==null) return current;
            if(current==null) return prev;
            current.fee_mtokens = BN.max(new BN(prev.fee_mtokens), new BN(current.fee_mtokens)).toString(10);
            current.fee = Math.max(prev.fee, current.fee);
            current.safe_fee = Math.max(prev.safe_fee, current.safe_fee);
            current.mtokens = BN.max(new BN(prev.mtokens), new BN(current.mtokens)).toString(10);
            current.tokens = Math.max(prev.tokens, current.tokens);
            current.safe_tokens = Math.max(prev.safe_tokens, current.safe_tokens);
            current.timeout = Math.max(prev.timeout, current.timeout);
            return current;
        });

        return {
            confidence: result.confidence,
            feeMtokens: new BN(result.fee_mtokens),
            destination: parsedRequest.destination,
            privateRoutes: fromLndRoutes(parsedRequest.routes)
        }
    }

    async route(init: ProbeAndRouteInit): Promise<ProbeAndRouteResponse | null> {
        const bolt11Parsed = bolt11.decode(init.request);
        if(bolt11Parsed.tagsObject.blinded_payinfo!=null && bolt11Parsed.tagsObject.blinded_payinfo.length>0) {
            return this.getRoutesBLIP39(init, bolt11Parsed);
        } else {
            return this.getRoutes(init);
        }
    }

    async getBlockheight(): Promise<number> {
        const res = await getHeight({lnd: this.lndClient.lnd});
        return res.current_block_height;
    }

    parsePaymentRequest(request: string): Promise<ParsedPaymentRequest> {
        const res = parsePaymentRequest({request});
        return Promise.resolve({
            id: res.id,
            mtokens: res.mtokens==null ? null : new BN(res.mtokens),
            expiryEpochMillis: new Date(res.expires_at).getTime(),
            destination: res.destination,
            cltvDelta: res.cltv_delta,
            description: res.description,
            routes: fromLndRoutes(res.routes)
        });
    }

    waitForInvoice(paymentHash: string, abortSignal?: AbortSignal): Promise<LightningNetworkInvoice> {
        const subscription = subscribeToInvoice({id: paymentHash, lnd: this.lndClient.lnd});

        return new Promise<LightningNetworkInvoice>((resolve, reject) => {
            if(abortSignal!=null) {
                abortSignal.throwIfAborted();
                abortSignal.addEventListener("abort", () => {
                    subscription.removeAllListeners();
                    reject(abortSignal.reason);
                })
            }
            subscription.on('invoice_updated', (result: SubscribeToInvoiceInvoiceUpdatedEvent) => {
                if(!result.is_held && !result.is_canceled && !result.is_confirmed) return;
                resolve({
                    id: result.id,
                    request: result.request,
                    secret: result.secret,

                    cltvDelta: (result as any).cltv_delta,
                    mtokens: new BN(result.mtokens),

                    createdAt: new Date(result.created_at).getTime(),
                    expiresAt: new Date(result.expires_at).getTime(),

                    description: result.description,
                    descriptionHash: result.description_hash,

                    status: result.is_canceled ? "canceled" : result.is_confirmed ? "confirmed" : result.is_held ? "held" : "unpaid",

                    payments: result.payments==null ? [] : result.payments.map(payment => {
                        return {
                            createdAt: new Date(payment.created_at).getTime(),
                            confirmedAt: payment.confirmed_at==null ? null : new Date(payment.confirmed_at).getTime(),

                            createdHeight: payment.created_height,
                            timeout: (payment as any).timeout,

                            status: payment.is_canceled ? "canceled" : payment.is_confirmed ? "confirmed" : payment.is_held ? "held" : null,

                            mtokens: new BN(payment.mtokens)
                        }
                    })
                });
                subscription.removeAllListeners();
            });
        });

    }

}
