"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const SwapHandler_1 = require("../SwapHandler");
const base_1 = require("@atomiqlabs/base");
const SpvVaultSwap_1 = require("./SpvVaultSwap");
const PluginManager_1 = require("../../plugins/PluginManager");
const SpvVault_1 = require("./SpvVault");
const ServerParamDecoder_1 = require("../../utils/paramcoders/server/ServerParamDecoder");
const Utils_1 = require("../../utils/Utils");
const SchemaVerifier_1 = require("../../utils/paramcoders/SchemaVerifier");
const FromBtcAmountAssertions_1 = require("../assertions/FromBtcAmountAssertions");
const crypto_1 = require("crypto");
const btc_signer_1 = require("@scure/btc-signer");
const VAULT_DUST_AMOUNT = 600;
const VAULT_INIT_CONFIRMATIONS = 2;
class SpvVaultSwapHandler extends SwapHandler_1.SwapHandler {
    constructor(storageDirectory, vaultStorage, path, chainsData, swapPricing, bitcoin, bitcoinRpc, spvVaultSigner, config) {
        super(storageDirectory, path, chainsData, swapPricing);
        this.type = SwapHandler_1.SwapHandlerType.FROM_BTC_SPV;
        this.outstandingQuotes = new Map();
        this.bitcoinRpc = bitcoinRpc;
        this.bitcoin = bitcoin;
        this.vaultSigner = spvVaultSigner;
        this.vaultStorage = vaultStorage;
        this.config = config;
        this.AmountAssertions = new FromBtcAmountAssertions_1.FromBtcAmountAssertions(config, swapPricing);
    }
    async processDepositEvent(vault, event) {
        vault.update(event);
        await this.vaultStorage.saveData(vault.getIdentifier(), vault);
    }
    async processOpenEvent(vault, event) {
        if (vault.state === SpvVault_1.SpvVaultState.BTC_CONFIRMED) {
            vault.state = SpvVault_1.SpvVaultState.OPENED;
            vault.update(event);
            await this.vaultStorage.saveData(vault.getIdentifier(), vault);
        }
    }
    async processCloseEvent(vault, event) {
        if (vault.state === SpvVault_1.SpvVaultState.OPENED) {
            vault.state = SpvVault_1.SpvVaultState.CLOSED;
            vault.update(event);
            await this.vaultStorage.saveData(vault.getIdentifier(), vault);
        }
    }
    async processClaimEvent(vault, swap, event) {
        //Update vault
        const foundPendingWithdrawal = vault.pendingWithdrawals.findIndex(val => val.btcTx.txid === event.btcTxId);
        if (foundPendingWithdrawal !== -1)
            vault.pendingWithdrawals.splice(foundPendingWithdrawal, 1);
        vault.update(event);
        await this.vaultStorage.saveData(vault.getIdentifier(), vault);
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
            const vault = this.vaultStorage.data[chainIdentifier + "_" + event.owner + "_" + event.vaultId.toString(10)];
            if (vault == null)
                continue;
            if (event instanceof base_1.SpvVaultOpenEvent) {
                await this.processOpenEvent(vault, event);
            }
            else if (event instanceof base_1.SpvVaultCloseEvent) {
                await this.processCloseEvent(vault, event);
            }
            else if (event instanceof base_1.SpvVaultClaimEvent) {
                const swap = await this.storageManager.getData(event.btcTxId, 0n);
                if (swap != null) {
                    swap.txIds.claim = event.meta?.txId;
                    if (swap.metadata != null)
                        swap.metadata.times.claimTxReceived = Date.now();
                }
                await this.processClaimEvent(vault, swap, event);
            }
            else if (event instanceof base_1.SpvVaultDepositEvent) {
                await this.processDepositEvent(vault, event);
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
    async createVaults(chainId, count, token, confirmations = 2, feeRate) {
        const { signer, chainInterface, tokenMultipliers, spvVaultContract } = this.getChain(chainId);
        //Check vaultId of the latest saved vault
        let latestVaultId = -1n;
        for (let key in this.vaultStorage.data) {
            const vault = this.vaultStorage.data[key];
            if (vault.chainId !== chainId)
                continue;
            if (vault.data.getOwner() !== signer.getAddress())
                continue;
            if (vault.data.getVaultId() > latestVaultId)
                latestVaultId = vault.data.getVaultId();
        }
        latestVaultId++;
        const vaultAddreses = [];
        for (let i = 0; i < count; i++) {
            const vaultId = latestVaultId + BigInt(i);
            const address = await this.vaultSigner.getAddress(chainId, vaultId);
            vaultAddreses.push({ vaultId, address });
        }
        //Construct transaction
        const txResult = await this.bitcoin.getSignedMultiTransaction(vaultAddreses.map(val => {
            return { address: val.address, amount: VAULT_DUST_AMOUNT };
        }), feeRate);
        const nativeToken = chainInterface.getNativeCurrencyAddress();
        const vaults = await Promise.all(vaultAddreses.map(async (val, index) => {
            const vaultData = await spvVaultContract.createVaultData(val.vaultId, txResult.txId + ":" + index, confirmations, [
                { token, multiplier: tokenMultipliers?.[token] ?? 1n },
                { token: nativeToken, multiplier: tokenMultipliers?.[nativeToken] ?? 1n }
            ]);
            return new SpvVault_1.SpvVault(chainId, vaultData, val.address);
        }));
        //Save vaults
        await this.vaultStorage.saveDataArr(vaults.map(val => {
            return { id: val.getIdentifier(), object: val };
        }));
        //Send bitcoin tx
        await this.bitcoin.sendRawTransaction(txResult.raw);
        this.logger.info("createVaults(): Funding " + count + " vaults, bitcoin txId: " + txResult.txId);
        return {
            vaultsCreated: vaults.map(val => val.data.getVaultId()),
            btcTxId: txResult.txId
        };
    }
    async listVaults(chainId, token) {
        return Object.keys(this.vaultStorage.data)
            .map(key => this.vaultStorage.data[key])
            .filter(val => chainId == null ? true : val.chainId === chainId)
            .filter(val => token == null ? true : val.data.getTokenData()[0].token === token);
    }
    async fundVault(vault, tokenAmounts) {
        if (vault.state !== SpvVault_1.SpvVaultState.OPENED)
            throw new Error("Vault not opened!");
        this.logger.info("fundVault(): Depositing tokens to the vault " + vault.data.getVaultId().toString(10) + ", amounts: " + tokenAmounts.map(val => val.toString(10)).join(", "));
        const { signer, spvVaultContract } = this.getChain(vault.chainId);
        const txId = await spvVaultContract.deposit(signer, vault.data, tokenAmounts, { waitForConfirmation: true });
        this.logger.info("fundVault(): Tokens deposited to vault " + vault.data.getVaultId().toString(10) + ", amounts: " + tokenAmounts.map(val => val.toString(10)).join(", ") + ", txId: " + txId);
        return txId;
    }
    async syncVaults(vaults) {
    }
    async checkVaults() {
        const vaults = Object.keys(this.vaultStorage.data).map(key => this.vaultStorage.data[key]);
        for (let vault of vaults) {
            const { signer, spvVaultContract } = this.getChain(vault.chainId);
            if (vault.data.getOwner() !== signer.getAddress())
                continue;
            if (vault.state === SpvVault_1.SpvVaultState.BTC_INITIATED) {
                //Check if btc tx confirmed
                const txId = vault.initialUtxo.split(":")[0];
                const btcTx = await this.bitcoinRpc.getTransaction(txId);
                if (btcTx.confirmations >= VAULT_INIT_CONFIRMATIONS) {
                    //Double-check the state here to prevent race condition
                    if (vault.state === SpvVault_1.SpvVaultState.BTC_INITIATED) {
                        vault.state = SpvVault_1.SpvVaultState.BTC_CONFIRMED;
                        await this.vaultStorage.saveData(vault.getIdentifier(), vault);
                    }
                    this.logger.info("checkVaults(): Vault ID " + vault.data.getVaultId().toString(10) + " confirmed on bitcoin, opening vault on " + vault.chainId);
                }
            }
            if (vault.state === SpvVault_1.SpvVaultState.BTC_CONFIRMED) {
                const txId = await spvVaultContract.open(signer, vault.data, { waitForConfirmation: true });
                this.logger.info("checkVaults(): Vault ID " + vault.data.getVaultId().toString(10) + " opened on " + vault.chainId + " txId: " + txId);
                vault.state = SpvVault_1.SpvVaultState.OPENED;
                await this.vaultStorage.saveData(vault.getIdentifier(), vault);
            }
        }
    }
    async startVaultsWatchdog() {
        let rerun;
        rerun = async () => {
            await this.checkVaults().catch(e => console.error(e));
            setTimeout(rerun, this.config.vaultsCheckInterval);
        };
        await rerun();
    }
    async startWatchdog() {
        await super.startWatchdog();
        await this.startVaultsWatchdog();
    }
    async init() {
        await this.storageManager.loadData(SpvVaultSwap_1.SpvVaultSwap);
        const vaults = await this.vaultStorage.loadData(SpvVault_1.SpvVault);
        await this.syncVaults(vaults);
        this.subscribeToEvents();
        await PluginManager_1.PluginManager.serviceInitialize(this);
    }
    processPastSwaps() {
        return Promise.resolve(undefined);
    }
    async getVault(chainId, owner, vaultId) {
        const vault = this.vaultStorage.data[chainId + "_" + owner + "_" + vaultId.toString(10)];
        if (vault == null)
            return null;
        if (vault.state !== SpvVault_1.SpvVaultState.OPENED)
            return null;
        return vault;
    }
    /**
     * Returns a ready-to-use vault for a specific request
     *
     * @param chainIdentifier
     * @param token
     * @param amount
     * @param gasToken
     * @param gasTokenAmount
     * @protected
     */
    async findVaultForSwap(chainIdentifier, token, amount, gasToken, gasTokenAmount) {
        const { signer } = this.getChain(chainIdentifier);
        const candidates = Object.keys(this.vaultStorage.data)
            .map(key => this.vaultStorage.data[key])
            .filter(vault => vault.chainId === chainIdentifier && vault.data.getOwner() === signer.getAddress() && vault.isReady())
            .filter(vault => {
            const token0 = vault.balances[0];
            if (token0.token !== token || token0.scaledAmount < amount)
                return false;
            if (gasToken != null && gasTokenAmount !== 0n) {
                const token1 = vault.balances[1];
                if (token1.token !== gasToken || token1.scaledAmount < gasTokenAmount)
                    return false;
            }
            return true;
        });
        candidates.sort((a, b) => (0, Utils_1.bigIntSorter)(a.balances[0].scaledAmount, b.balances[0].scaledAmount));
        const pluginResponse = await PluginManager_1.PluginManager.onVaultSelection(chainIdentifier, { token, amount }, { token: gasToken, amount: gasTokenAmount }, candidates);
        this.AmountAssertions.handlePluginErrorResponses(pluginResponse);
        const result = pluginResponse ?? candidates[0];
        if (result == null)
            throw {
                code: 20301,
                msg: "No suitable swap vault found, try again later!"
            };
        return result;
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
            const vault = await this.findVaultForSwap(chainIdentifier, useToken, totalInToken, gasToken, totalInGasToken);
            metadata.times.vaultPicked = Date.now();
            //Create swap receive bitcoin address
            const receiveAddress = await this.bitcoin.getAddress();
            const btcFeeRate = await this.bitcoin.getFeeRate();
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
            /**
             * address: string              smart chain address of the recipient
             * amount: string               amount (in sats)
             * token: string                Desired token to use
             * gasAmount: string            Desired amount in gas token to also get
             * gasToken: string
             * exactOut: boolean            Whether the swap should be an exact out instead of exact in swap
             */
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
            const vault = await this.getVault(swap.chainIdentifier, swap.vaultOwner, swap.vaultId);
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
                data = await spvVaultContract.getWithdrawalDataFromTx(await this.bitcoin.parsePsbt(transaction));
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
                data.btcTx.outs[0].value !== VAULT_DUST_AMOUNT ||
                !Buffer.from(data.btcTx.outs[0].scriptPubKey.hex, "hex").equals(this.bitcoin.toOutputScript(swap.vaultAddress)) ||
                BigInt(data.btcTx.outs[1].value) !== swap.amountBtc ||
                !Buffer.from(data.btcTx.outs[1].scriptPubKey.hex, "hex").equals(this.bitcoin.toOutputScript(swap.btcAddress))) {
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
            await this.vaultStorage.saveData(vault.getIdentifier(), vault);
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
                await this.vaultStorage.saveData(vault.getIdentifier(), vault);
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
        return {};
    }
}
