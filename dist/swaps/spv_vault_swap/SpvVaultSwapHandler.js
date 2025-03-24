"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpvVaultSwapHandler = void 0;
const SwapHandler_1 = require("../SwapHandler");
const base_1 = require("@atomiqlabs/base");
const SpvVaultSwap_1 = require("./SpvVaultSwap");
const PluginManager_1 = require("../../plugins/PluginManager");
const ServerParamDecoder_1 = require("../../utils/paramcoders/server/ServerParamDecoder");
const Utils_1 = require("../../utils/Utils");
const SchemaVerifier_1 = require("../../utils/paramcoders/SchemaVerifier");
const FromBtcAmountAssertions_1 = require("../assertions/FromBtcAmountAssertions");
const crypto_1 = require("crypto");
const btc_signer_1 = require("@scure/btc-signer");
const SpvVaults_1 = require("./SpvVaults");
class SpvVaultSwapHandler extends SwapHandler_1.SwapHandler {
    constructor(storageDirectory, vaultStorage, path, chainsData, swapPricing, bitcoin, bitcoinRpc, spvVaultSigner, config) {
        super(storageDirectory, path, chainsData, swapPricing);
        this.type = SwapHandler_1.SwapHandlerType.FROM_BTC_SPV;
        this.outstandingQuotes = new Map();
        this.bitcoinRpc = bitcoinRpc;
        this.bitcoin = bitcoin;
        this.vaultSigner = spvVaultSigner;
        this.config = config;
        this.AmountAssertions = new FromBtcAmountAssertions_1.FromBtcAmountAssertions(config, swapPricing);
        this.Vaults = new SpvVaults_1.SpvVaults(vaultStorage, bitcoin, spvVaultSigner, bitcoinRpc, this.getChain.bind(this), config);
    }
    async processClaimEvent(swap, event) {
        if (swap == null)
            return;
        //Update swap
        swap.txIds.claim = event.meta?.txId;
        await this.removeSwapData(swap, SpvVaultSwap_1.SpvVaultSwapState.CLAIMED);
    }
    /**
     * Chain event processor
     *
     * @param chainIdentifier
     * @param eventData
     */
    async processEvent(chainIdentifier, eventData) {
        for (let event of eventData) {
            if (!(event instanceof base_1.SpvVaultEvent))
                continue;
            const vault = await this.Vaults.getVault(chainIdentifier, event.owner, event.vaultId);
            if (vault == null)
                continue;
            if (event instanceof base_1.SpvVaultOpenEvent) {
                await this.Vaults.processOpenEvent(vault, event);
            }
            else if (event instanceof base_1.SpvVaultCloseEvent) {
                await this.Vaults.processCloseEvent(vault, event);
            }
            else if (event instanceof base_1.SpvVaultClaimEvent) {
                const swap = await this.storageManager.getData(event.btcTxId, 0n);
                if (swap != null) {
                    swap.txIds.claim = event.meta?.txId;
                    if (swap.metadata != null)
                        swap.metadata.times.claimTxReceived = Date.now();
                }
                await this.Vaults.processClaimEvent(vault, swap, event);
                await this.processClaimEvent(swap, event);
            }
            else if (event instanceof base_1.SpvVaultDepositEvent) {
                await this.Vaults.processDepositEvent(vault, event);
            }
        }
        return true;
    }
    /**
     * Initializes chain events subscription
     */
    subscribeToEvents() {
        for (let key in this.chains.chains) {
            this.chains.chains[key].chainEvents.registerListener((events) => this.processEvent(key, events));
        }
        this.logger.info("SC: Events: subscribed to smartchain events");
    }
    async startWatchdog() {
        await super.startWatchdog();
        await this.Vaults.startVaultsWatchdog();
    }
    async init() {
        await this.storageManager.loadData(SpvVaultSwap_1.SpvVaultSwap);
        await this.Vaults.init();
        this.subscribeToEvents();
        await PluginManager_1.PluginManager.serviceInitialize(this);
    }
    async processPastSwap(swap) {
        if (swap.state === SpvVaultSwap_1.SpvVaultSwapState.SIGNED) {
            //Check if sent
            const tx = await this.bitcoinRpc.getTransaction(swap.btcTxId);
            if (tx == null) {
                await this.removeSwapData(swap, SpvVaultSwap_1.SpvVaultSwapState.FAILED);
                return;
            }
            else if (tx.confirmations === 0) {
                await swap.setState(SpvVaultSwap_1.SpvVaultSwapState.SENT);
                await this.saveSwapData(swap);
                return;
            }
            else {
                await swap.setState(SpvVaultSwap_1.SpvVaultSwapState.BTC_CONFIRMED);
                await this.saveSwapData(swap);
            }
        }
        if (swap.state === SpvVaultSwap_1.SpvVaultSwapState.SENT) {
            //Check if confirmed or double-spent
            const tx = await this.bitcoinRpc.getTransaction(swap.btcTxId);
            if (tx == null) {
                await this.removeSwapData(swap, SpvVaultSwap_1.SpvVaultSwapState.DOUBLE_SPENT);
                return;
            }
            else if (tx.confirmations > 0) {
                await swap.setState(SpvVaultSwap_1.SpvVaultSwapState.BTC_CONFIRMED);
                await this.saveSwapData(swap);
            }
        }
    }
    async processPastSwaps() {
        const swaps = await this.storageManager.query([
            {
                key: "state",
                value: [
                    SpvVaultSwap_1.SpvVaultSwapState.SIGNED,
                    SpvVaultSwap_1.SpvVaultSwapState.SENT //Check if confirmed or double-spent
                ]
            }
        ]);
        for (let { obj: swap } of swaps) {
            await this.processPastSwap(swap);
        }
    }
    getPricePrefetches(chainIdentifier, token, gasToken, abortController) {
        const pricePrefetchPromise = this.swapPricing.preFetchPrice(token, chainIdentifier).catch(e => {
            this.logger.error("getPricePrefetches(): pricePrefetchPromise error: ", e);
            abortController.abort(e);
            return null;
        });
        const gasTokenPricePrefetchPromise = token === gasToken ?
            pricePrefetchPromise :
            this.swapPricing.preFetchPrice(gasToken, chainIdentifier).catch(e => {
                this.logger.error("getPricePrefetches(): gasTokenPricePrefetchPromise error: ", e);
                abortController.abort(e);
                return null;
            });
        return { pricePrefetchPromise, gasTokenPricePrefetchPromise };
    }
    startRestServer(restServer) {
        restServer.use(this.path + "/getQuote", (0, ServerParamDecoder_1.serverParamDecoder)(10 * 1000));
        restServer.post(this.path + "/getQuote", (0, Utils_1.expressHandlerWrapper)(async (req, res) => {
            const metadata = { request: {}, times: {} };
            const chainIdentifier = req.query.chain ?? this.chains.default;
            const { signer, chainInterface, spvVaultContract } = this.getChain(chainIdentifier);
            metadata.times.requestReceived = Date.now();
            /**
             * address: string              smart chain address of the recipient
             * amount: string               amount (in sats)
             * token: string                Desired token to use
             * gasAmount: string            Desired amount in gas token to also get
             * gasToken: string
             * exactOut: boolean            Whether the swap should be an exact out instead of exact in swap
             */
            const parsedBody = await req.paramReader.getParams({
                address: (val) => val != null &&
                    typeof (val) === "string" &&
                    chainInterface.isValidAddress(val) ? val : null,
                amount: SchemaVerifier_1.FieldTypeEnum.BigInt,
                token: (val) => val != null &&
                    typeof (val) === "string" &&
                    this.isTokenSupported(chainIdentifier, val) ? val : null,
                gasAmount: SchemaVerifier_1.FieldTypeEnum.BigInt,
                gasToken: (val) => val != null &&
                    typeof (val) === "string" &&
                    chainInterface.isValidToken(val) ? val : null,
                exactOut: SchemaVerifier_1.FieldTypeEnum.BooleanOptional
            });
            if (parsedBody == null)
                throw {
                    code: 20100,
                    msg: "Invalid request body"
                };
            metadata.request = parsedBody;
            if (parsedBody.gasToken !== chainInterface.getNativeCurrencyAddress())
                throw {
                    code: 20190,
                    msg: "Unsupported gas token"
                };
            const requestedAmount = { input: !parsedBody.exactOut, amount: parsedBody.amount, token: parsedBody.token };
            const gasTokenAmount = { input: false, amount: parsedBody.gasAmount, token: parsedBody.gasToken };
            const request = {
                chainIdentifier,
                raw: req,
                parsed: parsedBody,
                metadata
            };
            const useToken = parsedBody.token;
            const gasToken = parsedBody.gasToken;
            //Check request params
            const fees = await this.AmountAssertions.preCheckFromBtcAmounts(request, requestedAmount);
            metadata.times.requestChecked = Date.now();
            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;
            const abortController = (0, Utils_1.getAbortController)(responseStream);
            //Pre-fetch data
            const { pricePrefetchPromise, gasTokenPricePrefetchPromise } = this.getPricePrefetches(chainIdentifier, useToken, gasToken, abortController);
            //Check valid amount specified (min/max)
            let { amountBD, swapFee, swapFeeInToken, totalInToken, amountBDgas, gasSwapFee, gasSwapFeeInToken, totalInGasToken } = await this.AmountAssertions.checkFromBtcAmount(request, { ...requestedAmount, pricePrefetch: pricePrefetchPromise }, fees, abortController.signal, { ...gasTokenAmount, pricePrefetch: gasTokenPricePrefetchPromise });
            metadata.times.priceCalculated = Date.now();
            //Check if we have enough funds to honor the request
            const vault = await this.Vaults.findVaultForSwap(chainIdentifier, useToken, totalInToken, gasToken, totalInGasToken);
            metadata.times.vaultPicked = Date.now();
            //Create swap receive bitcoin address
            const btcFeeRate = await this.bitcoin.getFeeRate();
            const receiveAddress = await this.bitcoin.getAddress();
            abortController.signal.throwIfAborted();
            metadata.times.addressCreated = Date.now();
            //Calculate raw amounts
            const [rawTokenAmount, rawGasTokenAmount] = vault.toRawAmounts([totalInToken, totalInGasToken]);
            [totalInToken, totalInGasToken] = vault.fromRawAmounts([rawTokenAmount, rawGasTokenAmount]);
            const expiry = Math.floor(Date.now() / 1000) + this.getInitAuthorizationTimeout(chainIdentifier);
            //Get PSBT data
            const callerFeeShare = 0n;
            const frontingFeeShare = 0n;
            const executionFeeShare = 0n;
            const utxo = vault.getLatestUtxo();
            const totalBtcOutput = amountBD + amountBDgas;
            const swap = new SpvVaultSwap_1.SpvVaultSwap(chainIdentifier, expiry, vault, utxo, receiveAddress, btcFeeRate, parsedBody.address, totalBtcOutput, totalInToken, totalInGasToken, swapFee, swapFeeInToken, gasSwapFee, gasSwapFeeInToken, callerFeeShare, frontingFeeShare, executionFeeShare, useToken, gasToken);
            const quoteId = (0, crypto_1.randomBytes)(32).toString("hex");
            this.outstandingQuotes.set(quoteId, swap);
            this.swapLogger.info(swap, "REST: /getQuote: Created swap address: " + receiveAddress + " amount: " + amountBD.toString(10));
            await responseStream.writeParamsAndEnd({
                code: 20000,
                msg: "Success",
                data: {
                    quoteId,
                    expiry,
                    address: signer.getAddress(),
                    vaultId: vault.data.getVaultId().toString(10),
                    vaultBtcAddress: vault.btcAddress,
                    btcAddress: receiveAddress,
                    btcUtxo: utxo,
                    btcFeeRate,
                    btcAmount: totalBtcOutput.toString(10),
                    btcAmountSwap: amountBD.toString(10),
                    btcAmountGas: amountBDgas.toString(10),
                    total: totalInToken.toString(10),
                    totalGas: totalInGasToken.toString(10),
                    totalFeeBtc: (swapFee + gasSwapFee).toString(10),
                    swapFeeBtc: swapFee.toString(10),
                    swapFee: swapFeeInToken.toString(10),
                    gasSwapFeeBtc: gasSwapFee.toString(10),
                    gasSwapFee: gasSwapFeeInToken.toString(10),
                    callerFeeShare: callerFeeShare.toString(10),
                    frontingFeeShare: frontingFeeShare.toString(10),
                    executionFeeShare: executionFeeShare.toString(10)
                }
            });
        }));
        restServer.use(this.path + "/postQuote", (0, ServerParamDecoder_1.serverParamDecoder)(10 * 1000));
        restServer.post(this.path + "/postQuote", (0, Utils_1.expressHandlerWrapper)(async (req, res) => {
            const metadata = { request: {}, times: {} };
            metadata.times.requestReceived = Date.now();
            const parsedBody = await req.paramReader.getParams({
                quoteId: SchemaVerifier_1.FieldTypeEnum.String,
                psbtHex: (val) => val != null &&
                    typeof (val) === "string" &&
                    Utils_1.HEX_REGEX.test(val) ? val : null
            });
            const swap = this.outstandingQuotes.get(parsedBody.quoteId);
            if (swap == null || swap.expiry < Date.now() / 1000)
                throw {
                    code: 20505,
                    msg: "Invalid quote ID, not found or expired!"
                };
            this.outstandingQuotes.delete(parsedBody.quoteId);
            const vault = await this.Vaults.getVault(swap.chainIdentifier, swap.vaultOwner, swap.vaultId);
            if (vault == null || !vault.isReady()) {
                throw {
                    code: 20506,
                    msg: "Used vault not found!"
                };
            }
            //Try parse psbt
            let transaction;
            try {
                transaction = btc_signer_1.Transaction.fromPSBT(Buffer.from(parsedBody.psbtHex, "hex"));
            }
            catch (e) {
                this.swapLogger.error(swap, "REST: /postQuote: failed to parse provided PSBT: ", e);
                throw {
                    code: 20507,
                    msg: "Error parsing PSBT, hex format required!"
                };
            }
            //Check correct psbt
            const { spvVaultContract } = this.getChain(swap.chainIdentifier);
            let data;
            try {
                data = await spvVaultContract.getWithdrawalData(await this.bitcoin.parsePsbt(transaction));
            }
            catch (e) {
                this.swapLogger.error(swap, "REST: /postQuote: failed to parse PSBT to withdrawal tx data: ", e);
                throw {
                    code: 20508,
                    msg: "PSBT transaction cannot be parsed!"
                };
            }
            if (data.recipient !== swap.recipient ||
                data.callerFeeRate !== swap.callerFeeShare ||
                data.frontingFeeRate !== swap.frontingFeeShare ||
                data.executionFeeRate !== swap.executionFeeShare ||
                data.rawAmounts[0] !== swap.rawAmountToken ||
                data.rawAmounts[1] !== swap.rawAmountGasToken ||
                data.getSpentVaultUtxo() !== swap.vaultUtxo ||
                data.btcTx.outs[0].value !== SpvVaults_1.VAULT_DUST_AMOUNT ||
                !Buffer.from(data.btcTx.outs[0].scriptPubKey.hex, "hex").equals(this.bitcoin.toOutputScript(swap.vaultAddress)) ||
                BigInt(data.btcTx.outs[2].value) !== swap.amountBtc ||
                !Buffer.from(data.btcTx.outs[2].scriptPubKey.hex, "hex").equals(this.bitcoin.toOutputScript(swap.btcAddress))) {
                throw {
                    code: 20509,
                    msg: "Invalid PSBT provided!"
                };
            }
            if (swap.vaultUtxo !== vault.getLatestUtxo()) {
                throw {
                    code: 20510,
                    msg: "Vault UTXO already spent, please try again!"
                };
            }
            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;
            const signedTx = await this.vaultSigner.signPsbt(swap.chainIdentifier, swap.vaultId, transaction, [0]);
            signedTx.finalize();
            const feeRate = Number(signedTx.fee) / signedTx.vsize;
            if (feeRate < swap.btcFeeRate)
                throw {
                    code: 20511,
                    msg: "Bitcoin transaction fee too low, expected minimum: " + swap.btcFeeRate
                };
            if (swap.vaultUtxo !== vault.getLatestUtxo()) {
                throw {
                    code: 20510,
                    msg: "Vault UTXO already spent, please try again!"
                };
            }
            vault.addWithdrawal(data);
            await this.Vaults.saveVault(vault);
            swap.btcTxId = signedTx.id;
            swap.state = SpvVaultSwap_1.SpvVaultSwapState.SIGNED;
            await PluginManager_1.PluginManager.swapCreate(swap);
            await this.saveSwapData(swap);
            this.swapLogger.info(swap, "REST: /postQuote: BTC transaction signed, txId: " + swap.btcTxId);
            try {
                await this.bitcoin.sendRawTransaction(Buffer.from(signedTx.toBytes()).toString("hex"));
                await swap.setState(SpvVaultSwap_1.SpvVaultSwapState.SENT);
            }
            catch (e) {
                this.swapLogger.error(swap, "REST: /postQuote: Failed to send BTC transaction: ", e);
                vault.removeWithdrawal(data);
                await this.Vaults.saveVault(vault);
                await this.removeSwapData(swap, SpvVaultSwap_1.SpvVaultSwapState.FAILED);
                throw {
                    code: 20512,
                    msg: "Error broadcasting bitcoin transaction!"
                };
            }
            await responseStream.writeParamsAndEnd({
                code: 20000,
                msg: "Success",
                data: {
                    txId: swap.btcTxId
                }
            });
        }));
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
            gasTokens: mappedDict
        };
    }
}
exports.SpvVaultSwapHandler = SpvVaultSwapHandler;
