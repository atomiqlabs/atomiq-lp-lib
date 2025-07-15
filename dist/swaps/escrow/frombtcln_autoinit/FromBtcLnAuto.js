"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromBtcLnAuto = void 0;
const crypto_1 = require("crypto");
const FromBtcLnAutoSwap_1 = require("./FromBtcLnAutoSwap");
const SwapHandler_1 = require("../../SwapHandler");
const base_1 = require("@atomiqlabs/base");
const Utils_1 = require("../../../utils/Utils");
const PluginManager_1 = require("../../../plugins/PluginManager");
const SchemaVerifier_1 = require("../../../utils/paramcoders/SchemaVerifier");
const ServerParamDecoder_1 = require("../../../utils/paramcoders/server/ServerParamDecoder");
const FromBtcBaseSwapHandler_1 = require("../FromBtcBaseSwapHandler");
const LightningAssertions_1 = require("../../assertions/LightningAssertions");
/**
 * Swap handler handling from BTCLN swaps using submarine swaps
 */
class FromBtcLnAuto extends FromBtcBaseSwapHandler_1.FromBtcBaseSwapHandler {
    constructor(storageDirectory, path, chains, lightning, swapPricing, config) {
        super(storageDirectory, path, chains, swapPricing, config);
        this.type = SwapHandler_1.SwapHandlerType.FROM_BTCLN_AUTO;
        this.swapType = base_1.ChainSwapType.HTLC;
        this.config = config;
        this.config.invoiceTimeoutSeconds = this.config.invoiceTimeoutSeconds || 90;
        this.lightning = lightning;
        this.LightningAssertions = new LightningAssertions_1.LightningAssertions(this.logger, lightning);
    }
    async processPastSwap(swap) {
        const { swapContract, signer } = this.getChain(swap.chainIdentifier);
        if (swap.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.CREATED) {
            //Check if already paid
            const parsedPR = await this.lightning.parsePaymentRequest(swap.pr);
            const invoice = await this.lightning.getInvoice(parsedPR.id);
            const isBeingPaid = invoice.status === "held";
            if (!isBeingPaid) {
                //Not paid
                const isInvoiceExpired = parsedPR.expiryEpochMillis < Date.now();
                if (!isInvoiceExpired)
                    return null;
                this.swapLogger.info(swap, "processPastSwap(state=CREATED): swap LN invoice expired, cancelling, invoice: " + swap.pr);
                await this.cancelSwapAndInvoice(swap);
                return null;
            }
            //Adjust the state of the swap and expiry
            try {
                await this.htlcReceived(swap, invoice);
                //Result is either FromBtcLnSwapState.RECEIVED or FromBtcLnSwapState.CANCELED
            }
            catch (e) {
                this.swapLogger.error(swap, "processPastSwap(state=CREATED): htlcReceived error", e);
            }
            return null;
        }
        if (swap.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.RECEIVED) {
            //Adjust the state of the swap and expiry
            try {
                await this.offerHtlc(swap);
            }
            catch (e) {
                this.swapLogger.error(swap, "processPastSwap(state=RECEIVED): offerHtlc error", e);
            }
            return null;
        }
        if (swap.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.TXS_SENT) {
            const isAuthorizationExpired = await swapContract.isInitAuthorizationExpired(swap.data, swap);
            if (isAuthorizationExpired) {
                const isCommited = await swapContract.isCommited(swap.data);
                if (!isCommited) {
                    this.swapLogger.info(swap, "processPastSwap(state=TXS_SENT): swap not committed before authorization expiry, cancelling the LN invoice, invoice: " + swap.pr);
                    await this.cancelSwapAndInvoice(swap);
                    return null;
                }
                this.swapLogger.info(swap, "processPastSwap(state=TXS_SENT): swap committed (detected from processPastSwap), invoice: " + swap.pr);
                await swap.setState(FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.COMMITED);
                await this.saveSwapData(swap);
            }
        }
        if (swap.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.TXS_SENT || swap.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.COMMITED) {
            if (!await swapContract.isExpired(signer.getAddress(), swap.data))
                return null;
            const isCommited = await swapContract.isCommited(swap.data);
            if (isCommited) {
                this.swapLogger.info(swap, "processPastSwap(state=COMMITED): swap timed out, refunding to self, invoice: " + swap.pr);
                return "REFUND";
            }
            this.swapLogger.info(swap, "processPastSwap(state=COMMITED): swap timed out, cancelling the LN invoice, invoice: " + swap.pr);
            await this.cancelSwapAndInvoice(swap);
            return null;
        }
        if (swap.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.CLAIMED)
            return "SETTLE";
        if (swap.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.CANCELED)
            await this.cancelSwapAndInvoice(swap);
    }
    async refundSwaps(refundSwaps) {
        for (let refundSwap of refundSwaps) {
            const { swapContract, signer } = this.getChain(refundSwap.chainIdentifier);
            const unlock = refundSwap.lock(swapContract.refundTimeout);
            if (unlock == null)
                continue;
            this.swapLogger.debug(refundSwap, "refundSwaps(): initiate refund of swap");
            await swapContract.refund(signer, refundSwap.data, true, false, { waitForConfirmation: true });
            this.swapLogger.info(refundSwap, "refundsSwaps(): swap refunded, invoice: " + refundSwap.pr);
            await refundSwap.setState(FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.REFUNDED);
            unlock();
        }
    }
    async settleInvoices(swaps) {
        for (let swap of swaps) {
            try {
                await this.lightning.settleHodlInvoice(swap.secret);
                if (swap.metadata != null)
                    swap.metadata.times.htlcSettled = Date.now();
                await this.removeSwapData(swap, FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.SETTLED);
                this.swapLogger.info(swap, "settleInvoices(): invoice settled, secret: " + swap.secret);
            }
            catch (e) {
                this.swapLogger.error(swap, "settleInvoices(): cannot settle invoice", e);
            }
        }
    }
    /**
     * Checks past swaps, refunds and deletes ones that are already expired.
     */
    async processPastSwaps() {
        const settleInvoices = [];
        const refundSwaps = [];
        const queriedData = await this.storageManager.query([
            {
                key: "state",
                value: [
                    FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.CREATED,
                    FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.RECEIVED,
                    FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.TXS_SENT,
                    FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.COMMITED,
                    FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.CLAIMED,
                    FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.CANCELED,
                ]
            }
        ]);
        for (let { obj: swap } of queriedData) {
            switch (await this.processPastSwap(swap)) {
                case "SETTLE":
                    settleInvoices.push(swap);
                    break;
                case "REFUND":
                    refundSwaps.push(swap);
                    break;
            }
        }
        await this.refundSwaps(refundSwaps);
        await this.settleInvoices(settleInvoices);
    }
    async processInitializeEvent(chainIdentifier, savedSwap, event) {
        this.swapLogger.info(savedSwap, "SC: InitializeEvent: HTLC initialized by the client, invoice: " + savedSwap.pr);
        if (savedSwap.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.TXS_SENT) {
            await savedSwap.setState(FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.COMMITED);
            await this.saveSwapData(savedSwap);
        }
    }
    async processClaimEvent(chainIdentifier, savedSwap, event) {
        //Claim
        //This is the important part, we need to catch the claim TX, else we may lose money
        const secret = Buffer.from(event.result, "hex");
        const paymentHash = (0, crypto_1.createHash)("sha256").update(secret).digest();
        const secretHex = secret.toString("hex");
        const paymentHashHex = paymentHash.toString("hex");
        if (savedSwap.lnPaymentHash !== paymentHashHex)
            return;
        this.swapLogger.info(savedSwap, "SC: ClaimEvent: swap HTLC successfully claimed by the client, invoice: " + savedSwap.pr);
        try {
            await this.lightning.settleHodlInvoice(secretHex);
            this.swapLogger.info(savedSwap, "SC: ClaimEvent: invoice settled, secret: " + secretHex);
            savedSwap.secret = secretHex;
            if (savedSwap.metadata != null)
                savedSwap.metadata.times.htlcSettled = Date.now();
            await this.removeSwapData(savedSwap, FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.SETTLED);
        }
        catch (e) {
            this.swapLogger.error(savedSwap, "SC: ClaimEvent: cannot settle invoice", e);
            savedSwap.secret = secretHex;
            await savedSwap.setState(FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.CLAIMED);
            await this.saveSwapData(savedSwap);
        }
    }
    async processRefundEvent(chainIdentifier, savedSwap, event) {
        this.swapLogger.info(savedSwap, "SC: RefundEvent: swap refunded to us, invoice: " + savedSwap.pr);
        //We don't cancel the incoming invoice, to make the offender pay for this with locked liquidity
        // await this.lightning.cancelHodlInvoice(savedSwap.lnPaymentHash);
        await this.removeSwapData(savedSwap, FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.REFUNDED);
    }
    /**
     * Called when lightning HTLC is received, also signs an init transaction on the smart chain side, expiry of the
     *  smart chain authorization starts ticking as soon as this HTLC is received
     *
     * @param invoiceData
     * @param invoice
     */
    async htlcReceived(invoiceData, invoice) {
        this.swapLogger.debug(invoiceData, "htlcReceived(): invoice: ", invoice);
        if (invoiceData.metadata != null)
            invoiceData.metadata.times.htlcReceived = Date.now();
        const useToken = invoiceData.token;
        const gasToken = invoiceData.gasToken;
        let expiryTimeout;
        try {
            //Check if HTLC expiry is long enough
            expiryTimeout = await this.checkHtlcExpiry(invoice);
            if (invoiceData.metadata != null)
                invoiceData.metadata.times.htlcTimeoutCalculated = Date.now();
        }
        catch (e) {
            if (invoiceData.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.CREATED)
                await this.cancelSwapAndInvoice(invoiceData);
            throw e;
        }
        const { swapContract, signer } = this.getChain(invoiceData.chainIdentifier);
        //Create real swap data
        const swapData = await swapContract.createSwapData(base_1.ChainSwapType.HTLC, signer.getAddress(), invoiceData.claimer, useToken, invoiceData.amountToken, invoiceData.claimHash, 0n, BigInt(Math.floor(Date.now() / 1000)) + expiryTimeout, false, true, invoiceData.amountGasToken + invoiceData.claimerBounty, invoiceData.claimerBounty, invoiceData.gasToken);
        if (invoiceData.metadata != null)
            invoiceData.metadata.times.htlcSwapCreated = Date.now();
        //Important to prevent race condition and issuing 2 signed init messages at the same time
        if (invoiceData.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.CREATED) {
            invoiceData.data = swapData;
            invoiceData.signature = null;
            invoiceData.timeout = (BigInt(Math.floor(Date.now() / 1000)) + 120n).toString(10);
            //Setting the state variable is done outside the promise, so is done synchronously
            await invoiceData.setState(FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.RECEIVED);
            await this.saveSwapData(invoiceData);
        }
        await this.offerHtlc(invoiceData);
    }
    async offerHtlc(invoiceData) {
        if (invoiceData.state !== FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.RECEIVED)
            return;
        this.swapLogger.debug(invoiceData, "offerHtlc(): invoice: ", invoiceData.pr);
        if (invoiceData.metadata != null)
            invoiceData.metadata.times.offerHtlc = Date.now();
        const useToken = invoiceData.token;
        const gasToken = invoiceData.gasToken;
        const { swapContract, signer, chainInterface } = this.getChain(invoiceData.chainIdentifier);
        //Create abort controller for parallel fetches
        const abortController = new AbortController();
        //Pre-fetch data
        const balancePrefetch = this.getBalancePrefetch(invoiceData.chainIdentifier, useToken, abortController);
        const gasTokenBalancePrefetch = invoiceData.getTotalOutputGasAmount() === 0n || useToken === gasToken ?
            null : this.getBalancePrefetch(invoiceData.chainIdentifier, gasToken, abortController);
        if (await swapContract.isInitAuthorizationExpired(invoiceData.data, invoiceData)) {
            if (invoiceData.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.RECEIVED && !await swapContract.isCommited(invoiceData.data)) {
                await this.cancelSwapAndInvoice(invoiceData);
            }
            return;
        }
        try {
            //Check if we have enough liquidity to proceed
            if (useToken === gasToken) {
                await this.checkBalance(invoiceData.getTotalOutputAmount() + invoiceData.getTotalOutputGasAmount(), balancePrefetch, abortController.signal);
            }
            else {
                await this.checkBalance(invoiceData.getTotalOutputAmount(), balancePrefetch, abortController.signal);
                await this.checkBalance(invoiceData.getTotalOutputGasAmount(), gasTokenBalancePrefetch, abortController.signal);
            }
            if (invoiceData.metadata != null)
                invoiceData.metadata.times.offerHtlcChecked = Date.now();
        }
        catch (e) {
            if (!abortController.signal.aborted) {
                if (invoiceData.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.RECEIVED)
                    await this.cancelSwapAndInvoice(invoiceData);
            }
            throw e;
        }
        const txWithdraw = await swapContract.txsWithdraw(signer.getAddress(), gasToken, invoiceData.data.getTotalDeposit());
        const txInit = await swapContract.txsInit(signer.getAddress(), invoiceData.data, {
            prefix: invoiceData.prefix,
            timeout: invoiceData.timeout,
            signature: invoiceData.signature
        }, true);
        if (invoiceData.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.RECEIVED) {
            //Setting the state variable is done outside the promise, so is done synchronously
            await invoiceData.setState(FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.TXS_SENT);
            await this.saveSwapData(invoiceData);
            await chainInterface.sendAndConfirm(signer, [...txWithdraw, ...txInit], true);
        }
    }
    /**
     * Checks invoice description hash
     *
     * @param descriptionHash
     * @throws {DefinedRuntimeError} will throw an error if the description hash is invalid
     */
    checkDescriptionHash(descriptionHash) {
        if (descriptionHash != null) {
            if (typeof (descriptionHash) !== "string" || !Utils_1.HEX_REGEX.test(descriptionHash) || descriptionHash.length !== 64) {
                throw {
                    code: 20100,
                    msg: "Invalid request body (descriptionHash)"
                };
            }
        }
    }
    /**
     * Asynchronously sends the LN node's public key to the client, so he can pre-fetch the node's channels from 1ml api
     *
     * @param responseStream
     */
    sendPublicKeyAsync(responseStream) {
        this.lightning.getIdentityPublicKey().then(publicKey => responseStream.writeParams({
            lnPublicKey: publicKey
        })).catch(e => {
            this.logger.error("sendPublicKeyAsync(): error", e);
        });
    }
    /**
     * Returns the CLTV timeout (blockheight) of the received HTLC corresponding to the invoice. If multiple HTLCs are
     *  received (MPP) it returns the lowest of the timeouts
     *
     * @param invoice
     */
    getInvoicePaymentsTimeout(invoice) {
        let timeout = null;
        invoice.payments.forEach((curr) => {
            if (timeout == null || timeout > curr.timeout)
                timeout = curr.timeout;
        });
        return timeout;
    }
    /**
     * Checks if the received HTLC's CLTV timeout is large enough to still process the swap
     *
     * @param invoice
     * @throws {DefinedRuntimeError} Will throw if HTLC expires too soon and therefore cannot be processed
     * @returns expiry timeout in seconds
     */
    async checkHtlcExpiry(invoice) {
        const timeout = this.getInvoicePaymentsTimeout(invoice);
        const current_block_height = await this.lightning.getBlockheight();
        const blockDelta = BigInt(timeout - current_block_height);
        const htlcExpiresTooSoon = blockDelta < this.config.minCltv;
        if (htlcExpiresTooSoon) {
            throw {
                code: 20002,
                msg: "Not enough time to reliably process the swap",
                data: {
                    requiredDelta: this.config.minCltv.toString(10),
                    actualDelta: blockDelta.toString(10)
                }
            };
        }
        return (this.config.minCltv * this.config.bitcoinBlocktime / this.config.safetyFactor) - this.config.gracePeriod;
    }
    /**
     * Cancels the swap (CANCELED state) & also cancels the LN invoice (including all pending HTLCs)
     *
     * @param invoiceData
     */
    async cancelSwapAndInvoice(invoiceData) {
        if (invoiceData.state !== FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.CREATED)
            return;
        await invoiceData.setState(FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.CANCELED);
        await this.lightning.cancelHodlInvoice(invoiceData.lnPaymentHash);
        await this.removeSwapData(invoiceData);
        this.swapLogger.info(invoiceData, "cancelSwapAndInvoice(): swap removed & invoice cancelled, invoice: ", invoiceData.pr);
    }
    ;
    /**
     *
     * Checks if the lightning invoice is in HELD state (htlcs received but yet unclaimed)
     *
     * @param paymentHash
     * @throws {DefinedRuntimeError} Will throw if the lightning invoice is not found, or if it isn't in the HELD state
     * @returns the fetched lightning invoice
     */
    async checkInvoiceStatus(paymentHash) {
        const invoice = await this.lightning.getInvoice(paymentHash);
        if (invoice == null)
            throw {
                _httpStatus: 200,
                code: 10001,
                msg: "Invoice expired/canceled"
            };
        const arr = invoice.description.split("-");
        let chainIdentifier;
        let address;
        if (arr.length > 1) {
            chainIdentifier = arr[0];
            address = arr[1];
        }
        else {
            chainIdentifier = this.chains.default;
            address = invoice.description;
        }
        const { chainInterface } = this.getChain(chainIdentifier);
        if (!chainInterface.isValidAddress(address))
            throw {
                _httpStatus: 200,
                code: 10001,
                msg: "Invoice expired/canceled"
            };
        switch (invoice.status) {
            case "canceled":
                throw {
                    _httpStatus: 200,
                    code: 10001,
                    msg: "Invoice expired/canceled"
                };
            case "confirmed":
                throw {
                    _httpStatus: 200,
                    code: 10002,
                    msg: "Invoice already paid"
                };
            case "unpaid":
                throw {
                    _httpStatus: 200,
                    code: 10003,
                    msg: "Invoice yet unpaid"
                };
            default:
                return invoice;
        }
    }
    startRestServer(restServer) {
        restServer.use(this.path + "/createInvoice", (0, ServerParamDecoder_1.serverParamDecoder)(10 * 1000));
        restServer.post(this.path + "/createInvoice", (0, Utils_1.expressHandlerWrapper)(async (req, res) => {
            const metadata = { request: {}, times: {} };
            const chainIdentifier = req.query.chain ?? this.chains.default;
            const { swapContract, signer, chainInterface } = this.getChain(chainIdentifier);
            if (!swapContract.supportsInitWithoutClaimer)
                throw {
                    code: 20299,
                    msg: "Not supported for " + chainIdentifier
                };
            metadata.times.requestReceived = Date.now();
            /**
             * address: string              smart chain address of the recipient
             * paymentHash: string          payment hash of the to-be-created invoice
             * amount: string               amount (in sats) of the invoice
             * token: string                Desired token to swap
             * exactOut: boolean            Whether the swap should be an exact out instead of exact in swap
             * descriptionHash: string      Description hash of the invoice
             * gasAmount: string            Desired amount in gas token to also get
             * gasToken: string
             * claimerBounty: string        Desired amount to be left out as a claimer bounty
             */
            const parsedBody = await req.paramReader.getParams({
                address: (val) => val != null &&
                    typeof (val) === "string" &&
                    chainInterface.isValidAddress(val) ? val : null,
                paymentHash: (val) => val != null &&
                    typeof (val) === "string" &&
                    val.length === 64 &&
                    Utils_1.HEX_REGEX.test(val) ? val : null,
                amount: SchemaVerifier_1.FieldTypeEnum.BigInt,
                token: (val) => val != null &&
                    typeof (val) === "string" &&
                    this.isTokenSupported(chainIdentifier, val) ? val : null,
                descriptionHash: SchemaVerifier_1.FieldTypeEnum.StringOptional,
                exactOut: SchemaVerifier_1.FieldTypeEnum.BooleanOptional,
                gasToken: (val) => val != null &&
                    typeof (val) === "string" &&
                    chainInterface.isValidToken(val) ? val : null,
                gasAmount: SchemaVerifier_1.FieldTypeEnum.BigInt,
                claimerBounty: SchemaVerifier_1.FieldTypeEnum.BigInt
            });
            if (parsedBody == null)
                throw {
                    code: 20100,
                    msg: "Invalid request body"
                };
            if (parsedBody.gasToken !== chainInterface.getNativeCurrencyAddress())
                throw {
                    code: 20290,
                    msg: "Unsupported gas token"
                };
            if (parsedBody.gasAmount < 0)
                throw {
                    code: 20291,
                    msg: "Invalid gas amount, negative"
                };
            if (parsedBody.claimerBounty < 0)
                throw {
                    code: 20292,
                    msg: "Invalid claimer bounty, negative"
                };
            metadata.request = parsedBody;
            const requestedAmount = { input: !parsedBody.exactOut, amount: parsedBody.amount, token: parsedBody.token };
            const gasTokenAmount = {
                input: false,
                amount: parsedBody.gasAmount + parsedBody.claimerBounty,
                token: parsedBody.gasToken
            };
            const request = {
                chainIdentifier,
                raw: req,
                parsed: parsedBody,
                metadata
            };
            const useToken = parsedBody.token;
            const gasToken = parsedBody.gasToken;
            //Check request params
            this.checkDescriptionHash(parsedBody.descriptionHash);
            const fees = await this.AmountAssertions.preCheckFromBtcAmounts(this.type, request, requestedAmount, gasTokenAmount);
            metadata.times.requestChecked = Date.now();
            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;
            const abortController = (0, Utils_1.getAbortController)(responseStream);
            //Pre-fetch data
            const { pricePrefetchPromise, gasTokenPricePrefetchPromise } = this.getFromBtcPricePrefetches(chainIdentifier, useToken, gasToken, abortController);
            const balancePrefetch = this.getBalancePrefetch(chainIdentifier, useToken, abortController);
            const gasTokenBalancePrefetch = gasTokenAmount.amount === 0n || useToken === gasToken ?
                null : this.getBalancePrefetch(chainIdentifier, gasToken, abortController);
            const channelsPrefetch = this.LightningAssertions.getChannelsPrefetch(abortController);
            //Asynchronously send the node's public key to the client
            this.sendPublicKeyAsync(responseStream);
            //Check valid amount specified (min/max)
            let { amountBD, swapFee, swapFeeInToken, totalInToken, amountBDgas, gasSwapFee, gasSwapFeeInToken, totalInGasToken } = await this.AmountAssertions.checkFromBtcAmount(this.type, request, { ...requestedAmount, pricePrefetch: pricePrefetchPromise }, fees, abortController.signal, { ...gasTokenAmount, pricePrefetch: gasTokenPricePrefetchPromise });
            metadata.times.priceCalculated = Date.now();
            const totalBtcInput = amountBD + amountBDgas;
            //Check if we have enough funds to honor the request
            if (useToken === gasToken) {
                await this.checkBalance(totalInToken + totalInGasToken, balancePrefetch, abortController.signal);
            }
            else {
                await this.checkBalance(totalInToken, balancePrefetch, abortController.signal);
                await this.checkBalance(totalInGasToken, gasTokenBalancePrefetch, abortController.signal);
            }
            await this.LightningAssertions.checkInboundLiquidity(totalBtcInput, channelsPrefetch, abortController.signal);
            metadata.times.balanceChecked = Date.now();
            //Create swap
            const hodlInvoiceObj = {
                description: chainIdentifier + "-" + parsedBody.address,
                cltvDelta: Number(this.config.minCltv) + 5,
                expiresAt: Date.now() + (this.config.invoiceTimeoutSeconds * 1000),
                id: parsedBody.paymentHash,
                mtokens: totalBtcInput * 1000n,
                descriptionHash: parsedBody.descriptionHash
            };
            metadata.invoiceRequest = hodlInvoiceObj;
            const hodlInvoice = await this.lightning.createHodlInvoice(hodlInvoiceObj);
            abortController.signal.throwIfAborted();
            metadata.times.invoiceCreated = Date.now();
            metadata.invoiceResponse = { ...hodlInvoice };
            totalInGasToken -= parsedBody.claimerBounty;
            const createdSwap = new FromBtcLnAutoSwap_1.FromBtcLnAutoSwap(chainIdentifier, hodlInvoice.request, parsedBody.paymentHash, swapContract.getHashForHtlc(Buffer.from(parsedBody.paymentHash, "hex")).toString("hex"), hodlInvoice.mtokens, parsedBody.address, useToken, gasToken, totalInToken, totalInGasToken, swapFee, swapFeeInToken, gasSwapFee, gasSwapFeeInToken, parsedBody.claimerBounty);
            metadata.times.swapCreated = Date.now();
            createdSwap.metadata = metadata;
            await PluginManager_1.PluginManager.swapCreate(createdSwap);
            await this.saveSwapData(createdSwap);
            this.swapLogger.info(createdSwap, "REST: /createInvoice: Created swap invoice: " + hodlInvoice.request + " amount: " + totalBtcInput.toString(10));
            await responseStream.writeParamsAndEnd({
                code: 20000,
                msg: "Success",
                data: {
                    intermediaryKey: signer.getAddress(),
                    pr: hodlInvoice.request,
                    btcAmountSwap: amountBD.toString(10),
                    btcAmountGas: amountBDgas.toString(10),
                    total: totalInToken.toString(10),
                    totalGas: totalInGasToken.toString(10),
                    totalFeeBtc: (swapFee + gasSwapFee).toString(10),
                    swapFeeBtc: swapFee.toString(10),
                    swapFee: swapFeeInToken.toString(10),
                    gasSwapFeeBtc: gasSwapFee.toString(10),
                    gasSwapFee: gasSwapFeeInToken.toString(10),
                    claimerBounty: parsedBody.claimerBounty.toString(10)
                }
            });
        }));
        const getInvoiceStatus = (0, Utils_1.expressHandlerWrapper)(async (req, res) => {
            /**
             * paymentHash: string          payment hash of the invoice
             */
            const parsedBody = (0, SchemaVerifier_1.verifySchema)({ ...req.body, ...req.query }, {
                paymentHash: (val) => val != null &&
                    typeof (val) === "string" &&
                    val.length === 64 &&
                    Utils_1.HEX_REGEX.test(val) ? val : null,
            });
            await this.checkInvoiceStatus(parsedBody.paymentHash);
            const swap = await this.storageManager.getData(parsedBody.paymentHash, null);
            if (swap == null)
                throw {
                    _httpStatus: 200,
                    code: 10001,
                    msg: "Invoice expired/canceled"
                };
            if (swap.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.RECEIVED ||
                swap.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.TXS_SENT ||
                swap.state === FromBtcLnAutoSwap_1.FromBtcLnAutoSwapState.COMMITED) {
                res.status(200).json({
                    code: 10000,
                    msg: "Success",
                    data: {
                        data: swap.data.serialize()
                    }
                });
            }
            else {
                res.status(200).json({
                    code: 10003,
                    msg: "Invoice yet unpaid"
                });
            }
        });
        restServer.post(this.path + "/getInvoiceStatus", getInvoiceStatus);
        restServer.get(this.path + "/getInvoiceStatus", getInvoiceStatus);
        this.logger.info("started at path: ", this.path);
    }
    async init() {
        await this.loadData(FromBtcLnAutoSwap_1.FromBtcLnAutoSwap);
        this.subscribeToEvents();
        await PluginManager_1.PluginManager.serviceInitialize(this);
    }
    getInfoData() {
        const mappedDict = {};
        for (let chainId in this.config.gasTokenMax) {
            mappedDict[chainId] = {
                gasToken: this.getChain(chainId).chainInterface.getNativeCurrencyAddress(),
                max: this.config.gasTokenMax[chainId].toString(10)
            };
        }
        return {
            minCltv: Number(this.config.minCltv),
            invoiceTimeoutSeconds: this.config.invoiceTimeoutSeconds,
            gasTokens: mappedDict
        };
    }
}
exports.FromBtcLnAuto = FromBtcLnAuto;
