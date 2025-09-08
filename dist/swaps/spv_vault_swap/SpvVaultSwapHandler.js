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
const BitcoinUtils_1 = require("../../utils/BitcoinUtils");
const TX_MAX_VSIZE = 16 * 1024;
class SpvVaultSwapHandler extends SwapHandler_1.SwapHandler {
    constructor(storageDirectory, vaultStorage, path, chainsData, swapPricing, bitcoin, bitcoinRpc, spvVaultSigner, config) {
        super(storageDirectory, path, chainsData, swapPricing);
        this.type = SwapHandler_1.SwapHandlerType.FROM_BTC_SPV;
        this.btcTxIdIndex = new Map();
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
                const swap = this.btcTxIdIndex.get(event.btcTxId);
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
        for (let { obj: swap, hash, sequence } of await this.storageManager.query([])) {
            if (swap.btcTxId != null)
                this.btcTxIdIndex.set(swap.btcTxId, swap);
        }
        await this.Vaults.init();
        this.subscribeToEvents();
        await PluginManager_1.PluginManager.serviceInitialize(this);
    }
    async processPastSwap(swap) {
        if (swap.state === SpvVaultSwap_1.SpvVaultSwapState.CREATED) {
            if (swap.expiry < Date.now() / 1000) {
                await this.removeSwapData(swap, SpvVaultSwap_1.SpvVaultSwapState.EXPIRED);
                await this.bitcoin.addUnusedAddress(swap.btcAddress);
            }
        }
        if (swap.state === SpvVaultSwap_1.SpvVaultSwapState.SIGNED) {
            if (swap.sending)
                return;
            const vault = await this.Vaults.getVault(swap.chainIdentifier, swap.vaultOwner, swap.vaultId);
            const foundWithdrawal = vault.pendingWithdrawals.find(val => val.btcTx.txid === swap.btcTxId);
            let tx = foundWithdrawal?.btcTx;
            if (tx == null)
                tx = await this.bitcoinRpc.getTransaction(swap.btcTxId);
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
            if (swap.sending)
                return;
            const vault = await this.Vaults.getVault(swap.chainIdentifier, swap.vaultOwner, swap.vaultId);
            const foundWithdrawal = vault.pendingWithdrawals.find(val => val.btcTx.txid === swap.btcTxId);
            let tx = foundWithdrawal?.btcTx;
            if (tx == null)
                tx = await this.bitcoinRpc.getTransaction(swap.btcTxId);
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
                    SpvVaultSwap_1.SpvVaultSwapState.CREATED,
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
             * callerFeeRate: string        Caller/watchtower fee (in output token) to assign to the swap
             * frontingFeeRate: string      Fronting fee (in output token) to assign to the swap
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
                exactOut: SchemaVerifier_1.FieldTypeEnum.BooleanOptional,
                callerFeeRate: SchemaVerifier_1.FieldTypeEnum.BigInt,
                frontingFeeRate: SchemaVerifier_1.FieldTypeEnum.BigInt,
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
            if (parsedBody.callerFeeRate < 0n || parsedBody.callerFeeRate >= 2n ** 20n)
                throw {
                    code: 20191,
                    msg: "Invalid caller fee rate"
                };
            if (parsedBody.frontingFeeRate < 0n || parsedBody.frontingFeeRate >= 2n ** 20n)
                throw {
                    code: 20192,
                    msg: "Invalid fronting fee rate"
                };
            const requestedAmount = {
                input: !parsedBody.exactOut,
                amount: parsedBody.exactOut ?
                    (parsedBody.amount * (100000n + parsedBody.callerFeeRate + parsedBody.frontingFeeRate) / 100000n) :
                    parsedBody.amount,
                token: parsedBody.token
            };
            const gasTokenAmount = {
                input: false,
                amount: parsedBody.gasAmount * (100000n + parsedBody.callerFeeRate + parsedBody.frontingFeeRate) / 100000n,
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
            const fees = await this.AmountAssertions.preCheckFromBtcAmounts(this.type, request, requestedAmount, gasTokenAmount);
            metadata.times.requestChecked = Date.now();
            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;
            const abortController = (0, Utils_1.getAbortController)(responseStream);
            //Pre-fetch data
            const { pricePrefetchPromise, gasTokenPricePrefetchPromise } = this.getPricePrefetches(chainIdentifier, useToken, gasToken, abortController);
            //Check valid amount specified (min/max)
            let { amountBD, swapFee, swapFeeInToken, totalInToken, amountBDgas, gasSwapFee, gasSwapFeeInToken, totalInGasToken } = await this.AmountAssertions.checkFromBtcAmount(this.type, request, { ...requestedAmount, pricePrefetch: pricePrefetchPromise }, fees, abortController.signal, { ...gasTokenAmount, pricePrefetch: gasTokenPricePrefetchPromise });
            metadata.times.priceCalculated = Date.now();
            const totalBtcOutput = amountBD + amountBDgas;
            //Check if we have enough funds to honor the request
            let vault;
            do {
                vault = await this.Vaults.findVaultForSwap(chainIdentifier, totalBtcOutput, useToken, totalInToken, gasToken, totalInGasToken);
            } while (await this.Vaults.checkVaultReplacedTransactions(vault, true));
            abortController.signal.throwIfAborted();
            metadata.times.vaultPicked = Date.now();
            //Create swap receive bitcoin address
            const btcFeeRate = await this.bitcoin.getFeeRate();
            const receiveAddress = await this.bitcoin.getAddress();
            abortController.signal.throwIfAborted();
            metadata.times.addressCreated = Date.now();
            //Adjust the amounts based on passed fees
            if (parsedBody.exactOut) {
                totalInToken = parsedBody.amount;
            }
            else {
                totalInToken = (totalInToken * 100000n / (100000n + parsedBody.callerFeeRate + parsedBody.frontingFeeRate));
            }
            totalInGasToken = (totalInGasToken * 100000n / (100000n + parsedBody.callerFeeRate + parsedBody.frontingFeeRate));
            //Calculate raw amounts
            const [rawTokenAmount, rawGasTokenAmount] = vault.toRawAmounts([totalInToken, totalInGasToken]);
            [totalInToken, totalInGasToken] = vault.fromRawAmounts([rawTokenAmount, rawGasTokenAmount]);
            const expiry = Math.floor(Date.now() / 1000) + this.getInitAuthorizationTimeout(chainIdentifier);
            //Get PSBT data
            const callerFeeShare = parsedBody.callerFeeRate;
            const frontingFeeShare = parsedBody.frontingFeeRate;
            const executionFeeShare = 0n;
            const utxo = vault.getLatestUtxo();
            const quoteId = (0, crypto_1.randomBytes)(32).toString("hex");
            const swap = new SpvVaultSwap_1.SpvVaultSwap(chainIdentifier, quoteId, expiry, vault, utxo, receiveAddress, btcFeeRate, parsedBody.address, totalBtcOutput, totalInToken, totalInGasToken, swapFee, swapFeeInToken, gasSwapFee, gasSwapFeeInToken, callerFeeShare, frontingFeeShare, executionFeeShare, useToken, gasToken);
            swap.metadata = metadata;
            await PluginManager_1.PluginManager.swapCreate(swap);
            await this.saveSwapData(swap);
            this.swapLogger.info(swap, "REST: /getQuote: Created swap address: " + receiveAddress + " amount: " + totalBtcOutput.toString(10));
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
            let requestReceived = Date.now();
            const parsedBody = await req.paramReader.getParams({
                quoteId: SchemaVerifier_1.FieldTypeEnum.String,
                psbtHex: (val) => val != null &&
                    typeof (val) === "string" &&
                    Utils_1.HEX_REGEX.test(val) ? val : null
            });
            const swap = await this.storageManager.getData(parsedBody.quoteId, 0n);
            if (swap == null || swap.state !== SpvVaultSwap_1.SpvVaultSwapState.CREATED || swap.expiry < Date.now() / 1000)
                throw {
                    code: 20505,
                    msg: "Invalid quote ID, not found or expired!"
                };
            const metadata = swap.metadata;
            metadata.times ?? (metadata.times = {});
            metadata.times.requestReceived = requestReceived;
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
            for (let i = 1; i < transaction.inputsLength; i++) { //Skip first vault input
                const txIn = transaction.getInput(i);
                if ((0, BitcoinUtils_1.isLegacyInput)(txIn))
                    throw {
                        code: 20514,
                        msg: "Legacy (pre-segwit) inputs in tx are not allowed!"
                    };
                //Check UTXOs exist and are unspent
                if (await this.bitcoinRpc.isSpent(Buffer.from(txIn.txid).toString("hex") + ":" + txIn.index.toString(10)))
                    throw {
                        code: 20515,
                        msg: "Spent UTXO in inputs!"
                    };
            }
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
                data.getExecutionData() != null ||
                data.getSpentVaultUtxo() !== swap.vaultUtxo ||
                data.btcTx.outs[0].value !== SpvVaults_1.VAULT_DUST_AMOUNT ||
                !Buffer.from(data.btcTx.outs[0].scriptPubKey.hex, "hex").equals(this.bitcoin.toOutputScript(swap.vaultAddress)) ||
                BigInt(data.btcTx.outs[2].value) !== swap.amountBtc ||
                !Buffer.from(data.btcTx.outs[2].scriptPubKey.hex, "hex").equals(this.bitcoin.toOutputScript(swap.btcAddress)) ||
                (data.btcTx.locktime > 0 && data.btcTx.locktime < 500000000) ||
                data.btcTx.locktime > Math.floor(Date.now() / 1000) - 1000000) {
                this.swapLogger.error(swap, "REST: /postQuote: Invalid psbt data submitted, raw psbt hex: ", parsedBody.psbtHex);
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
            if (!signedTx.isFinal)
                throw {
                    code: 20513,
                    msg: "One or more PSBT inputs not finalized!"
                };
            const effectiveFeeRate = await this.bitcoinRpc.getEffectiveFeeRate(await this.bitcoin.parsePsbt(signedTx));
            if (effectiveFeeRate.feeRate < swap.btcFeeRate)
                throw {
                    code: 20511,
                    msg: "Bitcoin transaction fee too low, expected minimum: " + swap.btcFeeRate + " adjusted effective fee rate: " + effectiveFeeRate.feeRate
                };
            const txVsize = signedTx.vsize;
            if (txVsize > TX_MAX_VSIZE)
                throw {
                    code: 20516,
                    msg: "Bitcoin transaction size too large, maximum: " + TX_MAX_VSIZE + " actual: " + txVsize
                };
            await this.Vaults.checkVaultReplacedTransactions(vault, true);
            if (swap.vaultUtxo !== vault.getLatestUtxo()) {
                throw {
                    code: 20510,
                    msg: "Vault UTXO already spent, please try again!"
                };
            }
            try {
                const btcRawTx = Buffer.from(signedTx.toBytes(true, true)).toString("hex");
                //Double-check the state to prevent race condition
                if (swap.state !== SpvVaultSwap_1.SpvVaultSwapState.CREATED) {
                    throw {
                        code: 20505,
                        msg: "Invalid quote ID, not found or expired!"
                    };
                }
                swap.btcTxId = signedTx.id;
                swap.state = SpvVaultSwap_1.SpvVaultSwapState.SIGNED;
                swap.sending = true;
                await this.saveSwapData(swap);
                data.btcTx.raw = btcRawTx;
                data.sending = true;
                vault.addWithdrawal(data);
                await this.Vaults.saveVault(vault);
                this.swapLogger.info(swap, "REST: /postQuote: BTC transaction signed, txId: " + swap.btcTxId);
                try {
                    await this.bitcoin.sendRawTransaction(btcRawTx);
                    await swap.setState(SpvVaultSwap_1.SpvVaultSwapState.SENT);
                    data.sending = false;
                    swap.sending = false;
                }
                catch (e) {
                    this.swapLogger.error(swap, "REST: /postQuote: Failed to send BTC transaction: ", e);
                    throw {
                        code: 20512,
                        msg: "Error broadcasting bitcoin transaction!"
                    };
                }
            }
            catch (e) {
                data.sending = false;
                swap.sending = false;
                vault.removeWithdrawal(data);
                await this.Vaults.saveVault(vault);
                await this.removeSwapData(swap, SpvVaultSwap_1.SpvVaultSwapState.FAILED);
                throw e;
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
    async saveSwapData(swap) {
        if (swap.btcTxId != null)
            this.btcTxIdIndex.set(swap.btcTxId, swap);
        return super.saveSwapData(swap);
    }
    async removeSwapData(hashOrSwap, sequenceOrUltimateState) {
        let swap;
        let state;
        if (typeof (hashOrSwap) === "string") {
            if (typeof (sequenceOrUltimateState) !== "bigint")
                throw new Error("Sequence must be a BN instance!");
            swap = await this.storageManager.getData(hashOrSwap, sequenceOrUltimateState);
        }
        else {
            swap = hashOrSwap;
            if (sequenceOrUltimateState != null && typeof (sequenceOrUltimateState) !== "bigint")
                state = sequenceOrUltimateState;
        }
        if (swap.btcTxId != null)
            this.btcTxIdIndex.delete(swap.btcTxId);
        return super.removeSwapData(swap, state);
    }
}
exports.SpvVaultSwapHandler = SpvVaultSwapHandler;
