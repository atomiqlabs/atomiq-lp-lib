import * as BN from "bn.js";
import {Express, Request, Response} from "express";
import {ToBtcLnSwapAbs, ToBtcLnSwapState} from "./ToBtcLnSwapAbs";
import {MultichainData, SwapHandlerType} from "../SwapHandler";
import {ISwapPrice} from "../ISwapPrice";
import {
    ChainSwapType,
    ClaimEvent,
    InitializeEvent,
    RefundEvent,
    SwapCommitStatus,
    SwapData
} from "@atomiqlabs/base";
import {expressHandlerWrapper, HEX_REGEX, isDefinedRuntimeError} from "../../utils/Utils";
import {PluginManager} from "../../plugins/PluginManager";
import {IIntermediaryStorage} from "../../storage/IIntermediaryStorage";
import {randomBytes} from "crypto";
import {serverParamDecoder} from "../../utils/paramcoders/server/ServerParamDecoder";
import {IParamReader} from "../../utils/paramcoders/IParamReader";
import {FieldTypeEnum, verifySchema} from "../../utils/paramcoders/SchemaVerifier";
import {ServerParamEncoder} from "../../utils/paramcoders/server/ServerParamEncoder";
import {ToBtcBaseConfig, ToBtcBaseSwapHandler} from "../ToBtcBaseSwapHandler";
import {
    ILightningWallet,
    OutgoingLightningNetworkPayment,
    ParsedPaymentRequest, ProbeAndRouteInit,
    ProbeAndRouteResponse, routesMatch
} from "../../wallets/ILightningWallet";

export type ToBtcLnConfig = ToBtcBaseConfig & {
    routingFeeMultiplier: BN,

    minSendCltv: BN,

    allowProbeFailedSwaps: boolean,
    allowShortExpiry: boolean,

    minLnRoutingFeePPM?: BN,
    minLnBaseFee?: BN,

    exactInExpiry?: number
};

type ExactInAuthorization = {
    chainIdentifier: string,
    reqId: string,
    expiry: number,

    amount: BN,
    initialInvoice: ParsedPaymentRequest,

    quotedNetworkFeeInToken: BN,
    swapFeeInToken: BN,
    total: BN,
    confidence: number,
    quotedNetworkFee: BN,
    swapFee: BN,

    token: string,
    swapExpiry: BN,
    offerer: string,

    preFetchSignData: any,
    metadata: {
        request: any,
        probeRequest?: any,
        probeResponse?: any,
        routeResponse?: any,
        times: {[key: string]: number}
    }
}

export type ToBtcLnRequestType = {
    pr: string,
    maxFee: BN,
    expiryTimestamp: BN,
    token: string,
    offerer: string,
    exactIn?: boolean,
    amount?: BN
};

/**
 * Swap handler handling to BTCLN swaps using submarine swaps
 */
export class ToBtcLnAbs extends ToBtcBaseSwapHandler<ToBtcLnSwapAbs, ToBtcLnSwapState> {
    protected readonly LIGHTNING_LIQUIDITY_CACHE_TIMEOUT = 5*1000;

    activeSubscriptions: Set<string> = new Set<string>();
    lightningLiquidityCache: {
        liquidity: BN,
        timestamp: number
    };

    readonly type = SwapHandlerType.TO_BTCLN;

    readonly config: ToBtcLnConfig & {minTsSendCltv: BN};

    readonly exactInAuths: {
        [reqId: string]: ExactInAuthorization
    } = {};

    readonly lightning: ILightningWallet;

    constructor(
        storageDirectory: IIntermediaryStorage<ToBtcLnSwapAbs>,
        path: string,
        chainData: MultichainData,
        lightning: ILightningWallet,
        swapPricing: ISwapPrice,
        config: ToBtcLnConfig
    ) {
        super(storageDirectory, path, chainData, swapPricing);
        this.lightning = lightning;
        const anyConfig = config as any;
        anyConfig.minTsSendCltv = config.gracePeriod.add(config.bitcoinBlocktime.mul(config.minSendCltv).mul(config.safetyFactor));
        this.config = anyConfig;
        this.config.minLnRoutingFeePPM = this.config.minLnRoutingFeePPM || new BN(1000);
        this.config.minLnBaseFee = this.config.minLnBaseFee || new BN(5);
        this.config.exactInExpiry = this.config.exactInExpiry || 10*1000;
    }

    /**
     * Cleans up exactIn authorization that are already past their expiry
     *
     * @protected
     */
    private cleanExpiredExactInAuthorizations() {
        for(let key in this.exactInAuths) {
            const obj = this.exactInAuths[key];
            if(obj.expiry<Date.now()) {
                this.logger.info("cleanExpiredExactInAuthorizations(): remove expired authorization, reqId: "+key);
                delete this.exactInAuths[key];
            }
        }
    }

    protected async processPastSwap(swap: ToBtcLnSwapAbs): Promise<void> {
        const {swapContract, signer} = this.getChain(swap.chainIdentifier);

        if (swap.state === ToBtcLnSwapState.SAVED) {
            //Cancel the swaps where signature is expired
            const isSignatureExpired = await swapContract.isInitAuthorizationExpired(swap.data, swap);
            if(isSignatureExpired) {
                const isCommitted = await swapContract.isCommited(swap.data);
                if(!isCommitted) {
                    this.swapLogger.info(swap, "processPastSwap(state=SAVED): authorization expired & swap not committed, cancelling swap, invoice: "+swap.pr);
                    await this.removeSwapData(swap, ToBtcLnSwapState.CANCELED);
                    return;
                } else {
                    this.swapLogger.info(swap, "processPastSwap(state=SAVED): swap committed (detected from processPastSwap), invoice: "+swap.pr);
                    await swap.setState(ToBtcLnSwapState.COMMITED);
                    await this.storageManager.saveData(swap.data.getHash(), swap.getSequence(), swap);
                }
            }
            //Cancel the swaps where lightning invoice is expired
            const decodedPR = await this.lightning.parsePaymentRequest(swap.pr);
            const isInvoiceExpired = decodedPR.expiryEpochMillis < Date.now();
            if (isInvoiceExpired) {
                this.swapLogger.info(swap, "processPastSwap(state=SAVED): invoice expired, cancel uncommited swap, invoice: "+swap.pr);
                await this.removeSwapData(swap, ToBtcLnSwapState.CANCELED);
                return;
            }
        }

        if (swap.state === ToBtcLnSwapState.COMMITED || swap.state === ToBtcLnSwapState.PAID) {
            //Process swaps in commited & paid state
            await this.processInitialized(swap);
        }

        if (swap.state === ToBtcLnSwapState.NON_PAYABLE) {
            //Remove expired swaps (as these can already be unilaterally refunded by the client), so we don't need
            // to be able to cooperatively refund them
            if(swapContract.isExpired(signer.getAddress(), swap.data)) {
                this.swapLogger.info(swap, "processPastSwap(state=NON_PAYABLE): swap expired, removing swap data, invoice: "+swap.pr);
                await this.removeSwapData(swap);
            }
        }
    }

    /**
     * Checks past swaps, deletes ones that are already expired, and tries to process ones that are committed.
     */
    protected async processPastSwaps() {
        this.cleanExpiredExactInAuthorizations();

        const queriedData = await this.storageManager.query([
            {
                key: "state",
                value: [
                    ToBtcLnSwapState.SAVED,
                    ToBtcLnSwapState.COMMITED,
                    ToBtcLnSwapState.PAID,
                    ToBtcLnSwapState.NON_PAYABLE
                ]
            }
        ]);

        for(let swap of queriedData) {
            await this.processPastSwap(swap);
        }
    }

    /**
     * Tries to claim the swap funds on the SC side, returns false if the swap is already locked (claim tx is already being sent)
     *
     * @param swap
     * @private
     * @returns Whether the transaction was successfully sent
     */
    private async tryClaimSwap(swap: ToBtcLnSwapAbs): Promise<boolean> {
        if(swap.secret==null) throw new Error("Invalid swap state, needs payment pre-image!");

        const {swapContract, signer} = this.getChain(swap.chainIdentifier);

        //Set flag that we are sending the transaction already, so we don't end up with race condition
        const unlock: () => boolean = swap.lock(swapContract.claimWithSecretTimeout);
        if(unlock==null) return false;

        try {
            this.swapLogger.debug(swap, "tryClaimSwap(): initiate claim of swap, secret: "+swap.secret);
            const success = await swapContract.claimWithSecret(signer, swap.data, swap.secret, false, false, {
                waitForConfirmation: true
            });
            this.swapLogger.info(swap, "tryClaimSwap(): swap claimed successfully, secret: "+swap.secret+" invoice: "+swap.pr);
            if(swap.metadata!=null) swap.metadata.times.txClaimed = Date.now();
            unlock();
            return true;
        } catch (e) {
            this.swapLogger.error(swap, "tryClaimSwap(): error occurred claiming swap, secret: "+swap.secret+" invoice: "+swap.pr, e);
            return false;
        }
    }

    /**
     * Process the result of attempted lightning network payment
     *
     * @param swap
     * @param lnPaymentStatus
     */
    private async processPaymentResult(swap: ToBtcLnSwapAbs, lnPaymentStatus: OutgoingLightningNetworkPayment) {
        switch(lnPaymentStatus.status) {
            case "pending":
                return;

            case "failed":
                this.swapLogger.info(swap, "processPaymentResult(): invoice payment failed, cancelling swap, invoice: "+swap.pr);
                await swap.setState(ToBtcLnSwapState.NON_PAYABLE);
                await this.storageManager.saveData(swap.data.getHash(), swap.data.getSequence(), swap);
                return;

            case "confirmed":
                const {swapContract, signer} = this.getChain(swap.chainIdentifier);

                swap.secret = lnPaymentStatus.secret;
                swap.setRealNetworkFee(lnPaymentStatus.feeMtokens.div(new BN(1000)));
                this.swapLogger.info(swap, "processPaymentResult(): invoice paid, secret: "+swap.secret+" realRoutingFee: "+swap.realNetworkFee.toString(10)+" invoice: "+swap.pr);
                await swap.setState(ToBtcLnSwapState.PAID);
                await this.storageManager.saveData(swap.data.getHash(), swap.data.getSequence(), swap);

                //Check if escrow state exists
                const isCommited = await swapContract.isCommited(swap.data);
                if(!isCommited) {
                    const status = await swapContract.getCommitStatus(signer.getAddress(), swap.data);
                    if(status===SwapCommitStatus.PAID) {
                        //This is alright, we got the money
                        await this.removeSwapData(swap, ToBtcLnSwapState.CLAIMED);
                        return;
                    } else if(status===SwapCommitStatus.EXPIRED) {
                        //This means the user was able to refund before we were able to claim, no good
                        await this.removeSwapData(swap, ToBtcLnSwapState.REFUNDED);
                    }
                    this.swapLogger.warn(swap, "processPaymentResult(): tried to claim but escrow doesn't exist anymore,"+
                        " status: "+status+
                        " invoice: "+swap.pr);
                    return;
                }

                const success = await this.tryClaimSwap(swap);
                if(success) this.swapLogger.info(swap, "processPaymentResult(): swap claimed successfully, invoice: "+swap.pr);
                return;

            default:
                throw new Error("Invalid lnPaymentStatus");
        }
    }

    /**
     * Subscribe to a pending lightning network payment attempt
     *
     * @param invoiceData
     */
    private subscribeToPayment(invoiceData: ToBtcLnSwapAbs): boolean {
        const paymentHash = invoiceData.data.getHash();
        if(this.activeSubscriptions.has(paymentHash)) return false;

        this.lightning.waitForPayment(paymentHash).then(result => {
            this.swapLogger.info(invoiceData, "subscribeToPayment(): result callback, outcome: "+result.status+" invoice: "+invoiceData.pr);
            this.processPaymentResult(invoiceData, result).catch(e => this.swapLogger.error(invoiceData, "subscribeToPayment(): process payment result", e));
            this.activeSubscriptions.delete(paymentHash);
        });
        this.swapLogger.info(invoiceData, "subscribeToPayment(): subscribe to payment outcome, invoice: "+invoiceData.pr);

        this.activeSubscriptions.add(paymentHash);
        return true;
    }

    private async sendLightningPayment(swap: ToBtcLnSwapAbs): Promise<void> {
        const decodedPR = await this.lightning.parsePaymentRequest(swap.pr);
        const expiryTimestamp: BN = swap.data.getExpiry();
        const currentTimestamp: BN = new BN(Math.floor(Date.now()/1000));

        //Run checks
        const hasEnoughTimeToPay = expiryTimestamp.sub(currentTimestamp).gte(this.config.minTsSendCltv);
        if(!hasEnoughTimeToPay) throw {
            code: 90005,
            msg: "Not enough time to reliably pay the invoice"
        }

        const isInvoiceExpired = decodedPR.expiryEpochMillis < Date.now();
        if (isInvoiceExpired) throw {
            code: 90006,
            msg: "Invoice already expired"
        };

        //Compute max cltv delta
        const maxFee = swap.quotedNetworkFee;
        const maxUsableCLTVdelta = expiryTimestamp.sub(currentTimestamp).sub(this.config.gracePeriod).div(this.config.bitcoinBlocktime.mul(this.config.safetyFactor));

        await swap.setState(ToBtcLnSwapState.COMMITED);
        await this.storageManager.saveData(decodedPR.id, swap.data.getSequence(), swap);

        //Initiate payment
        this.swapLogger.info(swap, "sendLightningPayment(): paying lightning network invoice,"+
            " cltvDelta: "+maxUsableCLTVdelta.toString(10)+
            " maxFee: "+maxFee.toString(10)+
            " invoice: "+swap.pr);

        const blockHeight = await this.lightning.getBlockheight();

        try {
            await this.lightning.pay({
                request: swap.pr,
                maxFeeMtokens: maxFee.mul(new BN(1000)),
                maxTimeoutHeight: blockHeight+maxUsableCLTVdelta.toNumber()
            })
        } catch (e) {
            throw {
                code: 90007,
                msg: "Failed to initiate invoice payment",
                data: {
                    error: JSON.stringify(e)
                }
            }
        }
        if(swap.metadata!=null) swap.metadata.times.payComplete = Date.now();
    }

    /**
     * Begins a lightning network payment attempt, if not attempted already
     *
     * @param swap
     */
    private async processInitialized(swap: ToBtcLnSwapAbs) {
        //Check if payment was already made
        let lnPaymentStatus = await this.lightning.getPayment(swap.getHash());
        if(swap.metadata!=null) swap.metadata.times.payPaymentChecked = Date.now();

        const paymentExists = lnPaymentStatus!=null;
        if(!paymentExists) {
            try {
                await this.sendLightningPayment(swap);
            } catch (e) {
                this.swapLogger.error(swap, "processInitialized(): lightning payment error", e);
                if(isDefinedRuntimeError(e)) {
                    if(swap.metadata!=null) swap.metadata.payError = e;
                    await swap.setState(ToBtcLnSwapState.NON_PAYABLE);
                    await this.storageManager.saveData(swap.data.getHash(), swap.data.getSequence(), swap);
                    return;
                } else throw e;
            }
            this.subscribeToPayment(swap);
            return;
        }

        if(lnPaymentStatus.status==="pending") {
            this.subscribeToPayment(swap);
            return;
        }

        //Payment has already concluded, process the result
        await this.processPaymentResult(swap, lnPaymentStatus);
    }

    protected async processInitializeEvent(chainIdentifier: string, event: InitializeEvent<SwapData>): Promise<void> {
        if(event.swapType!==ChainSwapType.HTLC) return;

        const paymentHash = event.paymentHash;

        const swap = await this.storageManager.getData(paymentHash, event.sequence);
        if(swap==null || swap.chainIdentifier!==chainIdentifier) return;

        swap.txIds.init = (event as any).meta?.txId;
        if(swap.metadata!=null) swap.metadata.times.txReceived = Date.now();

        this.swapLogger.info(swap, "SC: InitializeEvent: swap initialized by the client, invoice: "+swap.pr);

        //Only process swaps in SAVED state
        if(swap.state!==ToBtcLnSwapState.SAVED) return;
        await this.processInitialized(swap);
    }

    protected async processClaimEvent(chainIdentifier: string, event: ClaimEvent<SwapData>): Promise<void> {
        const paymentHash = event.paymentHash;

        const swap = await this.storageManager.getData(paymentHash, event.sequence);
        if(swap==null || swap.chainIdentifier!==chainIdentifier) return;

        swap.txIds.claim = (event as any).meta?.txId;

        this.swapLogger.info(swap, "SC: ClaimEvent: swap claimed to us, secret: "+event.secret+" invoice: "+swap.pr);

        await this.removeSwapData(swap, ToBtcLnSwapState.CLAIMED);
    }

    protected async processRefundEvent(chainIdentifier: string, event: RefundEvent<SwapData>): Promise<void> {
        const paymentHash = event.paymentHash;

        const swap = await this.storageManager.getData(paymentHash, event.sequence);
        if(swap==null || swap.chainIdentifier!==chainIdentifier) return;

        swap.txIds.refund = (event as any).meta?.txId;

        this.swapLogger.info(swap, "SC: RefundEvent: swap refunded back to the client, invoice: "+swap.pr);

        await this.removeSwapData(swap, ToBtcLnSwapState.REFUNDED);
    }

    /**
     * Checks if the amount was supplied in the exactIn request
     *
     * @param amount
     * @param exactIn
     * @throws {DefinedRuntimeError} will throw an error if the swap was exactIn, but amount not specified
     */
    private checkAmount(amount: BN, exactIn: boolean): void {
        if(exactIn) {
            if(amount==null) {
                throw {
                    code: 20040,
                    msg: "Invalid request body (amount not specified)!"
                };
            }
        }
    }

    /**
     * Checks if the maxFee parameter is in valid range (>0)
     *
     * @param maxFee
     * @throws {DefinedRuntimeError} will throw an error if the maxFee is zero or negative
     */
    private checkMaxFee(maxFee: BN): void {
        if(maxFee.isNeg() || maxFee.isZero()) {
            throw {
                code: 20030,
                msg: "Invalid request body (maxFee too low)!"
            };
        }
    }

    /**
     * Checks and parses a payment request (bolt11 invoice), additionally also checks expiration time of the invoice
     *
     * @param pr
     * @throws {DefinedRuntimeError} will throw an error if the pr is invalid, without amount or expired
     */
    private async checkPaymentRequest(pr: string): Promise<{
        parsedPR: ParsedPaymentRequest,
        halfConfidence: boolean
    }> {
        let parsedPR: ParsedPaymentRequest;

        try {
            parsedPR = await this.lightning.parsePaymentRequest(pr);
        } catch (e) {
            throw {
                code: 20021,
                msg: "Invalid request body (pr - cannot be parsed)"
            };
        }

        if(parsedPR.mtokens==null) throw {
            code: 20022,
            msg: "Invalid request body (pr - needs to have amount)"
        };

        let halfConfidence = false;
        if(parsedPR.expiryEpochMillis < Date.now()+((this.config.authorizationTimeout+(2*60))*1000) ) {
            if(!this.config.allowShortExpiry) {
                throw {
                    code: 20020,
                    msg: "Invalid request body (pr - expired)"
                };
            } else if(parsedPR.expiryEpochMillis < Date.now()) {
                throw {
                    code: 20020,
                    msg: "Invalid request body (pr - expired)"
                };
            }
            halfConfidence = true;
        }

        return {parsedPR, halfConfidence};
    }

    /**
     * Checks if the request specified too short of an expiry
     *
     * @param expiryTimestamp
     * @param currentTimestamp
     * @throws {DefinedRuntimeError} will throw an error if the expiry time is too short
     */
    private checkExpiry(expiryTimestamp: BN, currentTimestamp: BN): void {
        const expiresTooSoon = expiryTimestamp.sub(currentTimestamp).lt(this.config.minTsSendCltv);
        if(expiresTooSoon) {
            throw {
                code: 20001,
                msg: "Expiry time too low!"
            };
        }
    }

    /**
     * Checks if the prior payment with the same paymentHash exists
     *
     * @param paymentHash
     * @param abortSignal
     * @throws {DefinedRuntimeError} will throw an error if payment already exists
     */
    private async checkPriorPayment(paymentHash: string, abortSignal: AbortSignal): Promise<void> {
        const payment = await this.lightning.getPayment(paymentHash);
        if(payment!=null) throw {
            code: 20010,
            msg: "Already processed"
        };
        abortSignal.throwIfAborted();
    }

    /**
     * Checks if the underlying LND backend has enough liquidity in channels to honor the swap
     *
     * @param amount
     * @param abortSignal
     * @param useCached Whether to use cached liquidity values
     * @throws {DefinedRuntimeError} will throw an error if there isn't enough liquidity
     */
    private async checkLiquidity(amount: BN, abortSignal: AbortSignal, useCached: boolean = false): Promise<void> {
        if(!useCached || this.lightningLiquidityCache==null || this.lightningLiquidityCache.timestamp<Date.now()-this.LIGHTNING_LIQUIDITY_CACHE_TIMEOUT) {
            const channelBalances = await this.lightning.getLightningBalance();
            this.lightningLiquidityCache = {
                liquidity: channelBalances.localBalance,
                timestamp: Date.now()
            }
        }
        if(amount.gt(this.lightningLiquidityCache.liquidity)) {
            throw {
                code: 20002,
                msg: "Not enough liquidity"
            };
        }
        abortSignal.throwIfAborted();
    }

    /**
     * Estimates the routing fee & confidence by either probing or routing (if probing fails), the fee is also adjusted
     *  according to routing fee multiplier, and subject to minimums set in config
     *
     * @param amountBD
     * @param maxFee
     * @param expiryTimestamp
     * @param currentTimestamp
     * @param pr
     * @param metadata
     * @param abortSignal
     * @throws {DefinedRuntimeError} will throw an error if the destination is unreachable
     */
    private async checkAndGetNetworkFee(amountBD: BN, maxFee: BN, expiryTimestamp: BN, currentTimestamp: BN, pr: string, metadata: any, abortSignal: AbortSignal): Promise<{
        confidence: number,
        networkFee: BN
    }> {
        const maxUsableCLTV: BN = expiryTimestamp.sub(currentTimestamp).sub(this.config.gracePeriod).div(this.config.bitcoinBlocktime.mul(this.config.safetyFactor));

        const blockHeight = await this.lightning.getBlockheight();
        abortSignal.throwIfAborted();
        metadata.times.blockheightFetched = Date.now();

        const maxTimeoutBlockheight = new BN(blockHeight).add(maxUsableCLTV);

        const req: ProbeAndRouteInit = {
            request: pr,
            amountMtokens: amountBD.mul(new BN(1000)),
            maxFeeMtokens: maxFee.mul(new BN(1000)),
            maxTimeoutHeight: maxTimeoutBlockheight.toNumber()
        };

        let probeOrRouteResp: ProbeAndRouteResponse = await this.lightning.probe(req);
        metadata.times.probeResult = Date.now();
        metadata.probeResponse = {...probeOrRouteResp};
        abortSignal.throwIfAborted();

        if(probeOrRouteResp==null) {
            if(!this.config.allowProbeFailedSwaps) throw {
                code: 20002,
                msg: "Cannot route the payment!"
            };

            const routeResp = await this.lightning.route(req);
            metadata.times.routingResult = Date.now();
            metadata.routeResponse = {...routeResp};
            abortSignal.throwIfAborted();

            if(routeResp==null) throw {
                code: 20002,
                msg: "Cannot route the payment!"
            };

            this.logger.info("checkAndGetNetworkFee(): routing result,"+
                " destination: "+routeResp.destination+
                " confidence: "+routeResp.confidence+
                " fee mtokens: "+routeResp.feeMtokens.toString(10));

            probeOrRouteResp = routeResp;
        } else {
            this.logger.info("checkAndGetNetworkFee(): route probed,"+
                " destination: "+probeOrRouteResp.destination+
                " confidence: "+probeOrRouteResp.confidence+
                " fee mtokens: "+probeOrRouteResp.feeMtokens.toString(10));
        }

        const safeFeeTokens = probeOrRouteResp.feeMtokens.add(new BN(999)).div(new BN(1000));

        let actualRoutingFee: BN = safeFeeTokens.mul(this.config.routingFeeMultiplier);

        const minRoutingFee: BN = amountBD.mul(this.config.minLnRoutingFeePPM).div(new BN(1000000)).add(this.config.minLnBaseFee);
        if(actualRoutingFee.lt(minRoutingFee)) {
            actualRoutingFee = minRoutingFee;
            if(actualRoutingFee.gt(maxFee)) {
                probeOrRouteResp.confidence = 0;
            }
        }

        if(actualRoutingFee.gt(maxFee)) {
            actualRoutingFee = maxFee;
        }

        return {
            networkFee: actualRoutingFee,
            confidence: probeOrRouteResp.confidence
        };
    }

    /**
     * Checks and consumes (deletes & returns) exactIn authorizaton with a specific reqId
     *
     * @param reqId
     * @throws {DefinedRuntimeError} will throw an error if the authorization doesn't exist
     */
    private checkExactInAuthorization(reqId: string): ExactInAuthorization {
        const parsedAuth = this.exactInAuths[reqId];
        if (parsedAuth==null) {
            throw {
                code: 20070,
                msg: "Invalid reqId"
            };
        }
        delete this.exactInAuths[reqId];
        if(parsedAuth.expiry<Date.now()) {
            throw {
                code: 20200,
                msg: "Authorization already expired!"
            };
        }
        return parsedAuth;
    }

    /**
     * Checks if the newly submitted PR has the same parameters (destination, cltv_delta, routes) as the initial dummy
     *  invoice sent for exactIn swap quote
     *
     * @param pr
     * @param parsedAuth
     * @throws {DefinedRuntimeError} will throw an error if the details don't match
     */
    private async checkPaymentRequestMatchesInitial(pr: string, parsedAuth: ExactInAuthorization): Promise<void> {
        const parsedRequest = await this.lightning.parsePaymentRequest(pr);

        if(
            parsedRequest.destination!==parsedAuth.initialInvoice.destination ||
            parsedRequest.cltvDelta!==parsedAuth.initialInvoice.cltvDelta ||
            !parsedRequest.mtokens.eq(parsedAuth.amount.mul(new BN(1000)))
        ) {
            throw {
                code: 20102,
                msg: "Provided PR doesn't match initial!"
            };
        }

        if(!routesMatch(parsedRequest.routes, parsedAuth.initialInvoice.routes)) {
            throw {
                code: 20102,
                msg: "Provided PR doesn't match initial (routes)!"
            };
        }
    }

    startRestServer(restServer: Express) {

        restServer.use(this.path+"/payInvoiceExactIn", serverParamDecoder(10*1000));
        restServer.post(this.path+"/payInvoiceExactIn", expressHandlerWrapper(async (req: Request & {paramReader: IParamReader}, res: Response & {responseStream: ServerParamEncoder}) => {
            /**
             * pr: string                   bolt11 lightning invoice
             * reqId: string                Identifier of the swap
             * feeRate: string              Fee rate to use for the init tx
             */
            const parsedBody = await req.paramReader.getParams({
                pr: FieldTypeEnum.String,
                reqId: FieldTypeEnum.String,
                feeRate: FieldTypeEnum.String
            });
            if (parsedBody==null) {
                throw {
                    code: 20100,
                    msg: "Invalid request body"
                };
            }

            const responseStream = res.responseStream;
            const abortSignal = responseStream.getAbortSignal();

            //Check request params
            const parsedAuth = this.checkExactInAuthorization(parsedBody.reqId);
            const {parsedPR, halfConfidence} = await this.checkPaymentRequest(parsedBody.pr);
            await this.checkPaymentRequestMatchesInitial(parsedBody.pr, parsedAuth);

            const metadata = parsedAuth.metadata;

            const sequence = new BN(randomBytes(8));

            const {swapContract, signer} = this.getChain(parsedAuth.chainIdentifier);

            //Create swap data
            const payObject: SwapData = await swapContract.createSwapData(
                ChainSwapType.HTLC,
                parsedAuth.offerer,
                signer.getAddress(),
                parsedAuth.token,
                parsedAuth.total,
                parsedPR.id,
                sequence,
                parsedAuth.swapExpiry,
                new BN(0),
                0,
                true,
                false,
                new BN(0),
                new BN(0)
            );
            metadata.times.swapCreated = Date.now();

            //Sign swap data
            const prefetchedSignData = parsedAuth.preFetchSignData;
            const sigData = await this.getToBtcSignatureData(parsedAuth.chainIdentifier, payObject, req, abortSignal, prefetchedSignData);
            metadata.times.swapSigned = Date.now();

            //Create swap
            const createdSwap = new ToBtcLnSwapAbs(
                parsedAuth.chainIdentifier,
                parsedBody.pr,
                parsedPR.mtokens,
                parsedAuth.swapFee,
                parsedAuth.swapFeeInToken,
                parsedAuth.quotedNetworkFee,
                parsedAuth.quotedNetworkFeeInToken
            );
            createdSwap.data = payObject;
            createdSwap.metadata = metadata;

            await PluginManager.swapCreate(createdSwap);
            await this.storageManager.saveData(parsedPR.id, sequence, createdSwap);

            this.swapLogger.info(createdSwap, "REST: /payInvoiceExactIn: created exact in swap,"+
                " reqId: "+parsedBody.reqId+
                " mtokens: "+parsedPR.mtokens.toString(10)+
                " invoice: "+createdSwap.pr);

            await responseStream.writeParamsAndEnd({
                code: 20000,
                msg: "Success",
                data: {
                    maxFee: parsedAuth.quotedNetworkFeeInToken.toString(10),
                    swapFee: parsedAuth.swapFeeInToken.toString(10),
                    total: parsedAuth.total.toString(10),
                    confidence: halfConfidence ? parsedAuth.confidence/2000000 : parsedAuth.confidence/1000000,
                    address: signer.getAddress(),

                    routingFeeSats: parsedAuth.quotedNetworkFee.toString(10),

                    data: payObject.serialize(),

                    prefix: sigData.prefix,
                    timeout: sigData.timeout,
                    signature: sigData.signature
                }
            });

        }));

        restServer.use(this.path+"/payInvoice", serverParamDecoder(10*1000));
        restServer.post(this.path+"/payInvoice", expressHandlerWrapper(async (req: Request & {paramReader: IParamReader}, res: Response & {responseStream: ServerParamEncoder}) => {
            const metadata: {
                request: any,
                probeRequest?: any,
                probeResponse?: any,
                routeResponse?: any,
                times: {[key: string]: number}
            } = {request: {}, times: {}};

            const chainIdentifier = req.query.chain as string ?? this.chains.default;
            const {swapContract, signer} = this.getChain(chainIdentifier);

            metadata.times.requestReceived = Date.now();
            /**
             *Sent initially:
             * pr: string                   bolt11 lightning invoice
             * maxFee: string               maximum routing fee
             * expiryTimestamp: string      expiry timestamp of the to be created HTLC, determines how many LN paths can be considered
             * token: string                Desired token to use
             * offerer: string              Address of the caller
             * exactIn: boolean             Whether to do an exact in swap instead of exact out
             * amount: string               Input amount for exactIn swaps
             *
             *Sent later:
             * feeRate: string              Fee rate to use for the init signature
             */
            const parsedBody: ToBtcLnRequestType = await req.paramReader.getParams({
                pr: FieldTypeEnum.String,
                maxFee: FieldTypeEnum.BN,
                expiryTimestamp: FieldTypeEnum.BN,
                token: (val: string) => val!=null &&
                        typeof(val)==="string" &&
                        this.isTokenSupported(chainIdentifier, val) ? val : null,
                offerer: (val: string) => val!=null &&
                        typeof(val)==="string" &&
                        swapContract.isValidAddress(val) ? val : null,
                exactIn: FieldTypeEnum.BooleanOptional,
                amount: FieldTypeEnum.BNOptional
            });
            if (parsedBody==null) {
                throw {
                    code: 20100,
                    msg: "Invalid request body"
                };
            }
            metadata.request = parsedBody;

            const request = {
                chainIdentifier,
                raw: req,
                parsed: parsedBody,
                metadata
            };
            const useToken = parsedBody.token;

            const responseStream = res.responseStream;

            const currentTimestamp: BN = new BN(Math.floor(Date.now()/1000));

            //Check request params
            this.checkAmount(parsedBody.amount, parsedBody.exactIn);
            this.checkMaxFee(parsedBody.maxFee);
            this.checkExpiry(parsedBody.expiryTimestamp, currentTimestamp);
            await this.checkVaultInitialized(chainIdentifier, parsedBody.token);
            const {parsedPR, halfConfidence} = await this.checkPaymentRequest(parsedBody.pr);
            const requestedAmount = {
                input: !!parsedBody.exactIn,
                amount: !!parsedBody.exactIn ? parsedBody.amount : parsedPR.mtokens.add(new BN(999)).div(new BN(1000))
            };
            const fees = await this.preCheckAmounts(request, requestedAmount, useToken);
            metadata.times.requestChecked = Date.now();

            //Create abort controller for parallel pre-fetches
            const abortController = this.getAbortController(responseStream);

            //Pre-fetch
            const {pricePrefetchPromise, signDataPrefetchPromise} = this.getToBtcPrefetches(chainIdentifier, useToken, responseStream, abortController);

            //Check if prior payment has been made
            await this.checkPriorPayment(parsedPR.id, abortController.signal);
            metadata.times.priorPaymentChecked = Date.now();

            //Check amounts
            const {
                amountBD,
                networkFeeData,
                totalInToken,
                swapFee,
                swapFeeInToken,
                networkFeeInToken
            } = await this.checkToBtcAmount(request, requestedAmount, fees, useToken, async (amountBD: BN) => {
                //Check if we have enough liquidity to process the swap
                await this.checkLiquidity(amountBD, abortController.signal, true);
                metadata.times.liquidityChecked = Date.now();

                const maxFee = parsedBody.exactIn ?
                    await this.swapPricing.getToBtcSwapAmount(parsedBody.maxFee, useToken, chainIdentifier, null, pricePrefetchPromise) :
                    parsedBody.maxFee;

                return await this.checkAndGetNetworkFee(amountBD, maxFee, parsedBody.expiryTimestamp, currentTimestamp, parsedBody.pr, metadata, abortController.signal);
            }, abortController.signal, pricePrefetchPromise);
            metadata.times.priceCalculated = Date.now();

            //For exactIn swap, just save and wait for the actual invoice to be submitted
            if(parsedBody.exactIn) {
                const reqId = randomBytes(32).toString("hex");
                this.exactInAuths[reqId] = {
                    chainIdentifier,
                    reqId,
                    expiry: Date.now() + this.config.exactInExpiry,

                    amount: amountBD,
                    initialInvoice: parsedPR,

                    quotedNetworkFeeInToken: networkFeeInToken,
                    swapFeeInToken,
                    total: totalInToken,
                    confidence: networkFeeData.confidence,
                    quotedNetworkFee: networkFeeData.networkFee,
                    swapFee,

                    token: useToken,
                    swapExpiry: parsedBody.expiryTimestamp,
                    offerer: parsedBody.offerer,

                    preFetchSignData: signDataPrefetchPromise != null ? await signDataPrefetchPromise : null,
                    metadata
                };

                this.logger.info("REST: /payInvoice: created exact in swap,"+
                    " reqId: "+reqId+
                    " amount: "+amountBD.toString(10)+
                    " destination: "+parsedPR.destination);

                await responseStream.writeParamsAndEnd({
                    code: 20000,
                    msg: "Success",
                    data: {
                        amount: amountBD.toString(10),
                        reqId
                    }
                });
                return;
            }

            const sequence = new BN(randomBytes(8));

            //Create swap data
            const payObject: SwapData = await swapContract.createSwapData(
                ChainSwapType.HTLC,
                parsedBody.offerer,
                signer.getAddress(),
                useToken,
                totalInToken,
                parsedPR.id,
                sequence,
                parsedBody.expiryTimestamp,
                new BN(0),
                0,
                true,
                false,
                new BN(0),
                new BN(0)
            );
            abortController.signal.throwIfAborted();
            metadata.times.swapCreated = Date.now();

            //Sign swap data
            const sigData = await this.getToBtcSignatureData(chainIdentifier, payObject, req, abortController.signal, signDataPrefetchPromise);
            metadata.times.swapSigned = Date.now();

            //Create swap
            const createdSwap = new ToBtcLnSwapAbs(
                chainIdentifier,
                parsedBody.pr,
                parsedPR.mtokens,
                swapFee,
                swapFeeInToken,
                networkFeeData.networkFee,
                networkFeeInToken
            );
            createdSwap.data = payObject;
            createdSwap.metadata = metadata;
            createdSwap.prefix = sigData.prefix;
            createdSwap.timeout = sigData.timeout;
            createdSwap.signature = sigData.signature
            createdSwap.feeRate = sigData.feeRate;

            await PluginManager.swapCreate(createdSwap);
            await this.storageManager.saveData(parsedPR.id, sequence, createdSwap);

            this.swapLogger.info(createdSwap, "REST: /payInvoice: created swap,"+
                " amount: "+amountBD.toString(10)+
                " invoice: "+createdSwap.pr);

            await responseStream.writeParamsAndEnd({
                code: 20000,
                msg: "Success",
                data: {
                    maxFee: networkFeeInToken.toString(10),
                    swapFee: swapFeeInToken.toString(10),
                    total: totalInToken.toString(10),
                    confidence: halfConfidence ? networkFeeData.confidence/2000000 : networkFeeData.confidence/1000000,
                    address: signer.getAddress(),

                    routingFeeSats: networkFeeData.networkFee.toString(10),

                    data: payObject.serialize(),

                    prefix: sigData.prefix,
                    timeout: sigData.timeout,
                    signature: sigData.signature
                }
            });
        }));

        const getRefundAuthorization = expressHandlerWrapper(async (req, res) => {
            /**
             * paymentHash: string          Identifier of the swap
             * sequence: BN                 Sequence identifier of the swap
             */
            const parsedBody = verifySchema({...req.body, ...req.query}, {
                paymentHash: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    val.length===64 &&
                    HEX_REGEX.test(val) ? val: null,
                sequence: FieldTypeEnum.BN
            });
            if (parsedBody==null) throw {
                code: 20100,
                msg: "Invalid request body/query (paymentHash/sequence)"
            };

            this.checkSequence(parsedBody.sequence);

            const data = await this.storageManager.getData(parsedBody.paymentHash, parsedBody.sequence);

            const isSwapFound = data!=null;
            if(isSwapFound) {
                const {signer, swapContract} = this.getChain(data.chainIdentifier);

                if(swapContract.isExpired(signer.getAddress(), data.data)) throw {
                    _httpStatus: 200,
                    code: 20010,
                    msg: "Payment expired"
                };

                if(data.state===ToBtcLnSwapState.NON_PAYABLE) {
                    const refundSigData = await swapContract.getRefundSignature(signer, data.data, this.config.authorizationTimeout);

                    //Double check the state after promise result
                    if (data.state !== ToBtcLnSwapState.NON_PAYABLE) throw {
                        code: 20005,
                        msg: "Not committed"
                    };

                    this.swapLogger.info(data, "REST: /getRefundAuthorization: returning refund authorization, because invoice in NON_PAYABLE state, invoice: "+data.pr);

                    res.status(200).json({
                        code: 20000,
                        msg: "Success",
                        data: {
                            address: signer.getAddress(),
                            prefix: refundSigData.prefix,
                            timeout: refundSigData.timeout,
                            signature: refundSigData.signature
                        }
                    });
                    return;
                }
            }

            const payment = await this.lightning.getPayment(parsedBody.paymentHash);

            if(payment==null) throw {
                _httpStatus: 200,
                code: 20007,
                msg: "Payment not found"
            };

            if(payment.status==="pending") throw {
                _httpStatus: 200,
                code: 20008,
                msg: "Payment in-flight"
            };

            if(payment.status==="confirmed") throw {
                _httpStatus: 200,
                code: 20006,
                msg: "Already paid",
                data: {
                    secret: payment.secret
                }
            };

            if(payment.status==="failed") throw {
                _httpStatus: 200,
                code: 20010,
                msg: "Payment expired",
                data: {
                    reason: payment.failedReason
                }
            };
        });

        restServer.post(this.path+'/getRefundAuthorization', getRefundAuthorization);
        restServer.get(this.path+'/getRefundAuthorization', getRefundAuthorization);

        this.logger.info("started at path: ", this.path);
    }

    async init() {
        await this.storageManager.loadData(ToBtcLnSwapAbs);
        //Check if all swaps contain a valid amount
        for(let swap of await this.storageManager.query([])) {
            if(swap.amount==null) {
                const parsedPR = await this.lightning.parsePaymentRequest(swap.pr);
                swap.amount = parsedPR.mtokens.add(new BN(999)).div(new BN(1000));
            }
        }
        this.subscribeToEvents();
        await PluginManager.serviceInitialize(this);
    }

    getInfoData(): any {
        return {
            minCltv: this.config.minSendCltv.toNumber(),
            minTimestampCltv: this.config.minTsSendCltv.toNumber()
        };
    }

}
