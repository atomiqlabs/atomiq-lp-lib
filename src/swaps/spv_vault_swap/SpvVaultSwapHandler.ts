import {MultichainData, SwapBaseConfig, SwapHandler, SwapHandlerType} from "../SwapHandler";
import {Express, Request, Response} from "express";
import {IBitcoinWallet} from "../../wallets/IBitcoinWallet";
import {
    BitcoinRpc,
    BtcBlock,
    ChainEvent,
    IStorageManager,
    SpvVaultClaimEvent,
    SpvVaultCloseEvent,
    SpvVaultDepositEvent,
    SpvVaultEvent,
    SpvVaultOpenEvent,
    SpvWithdrawalTransactionData,
    SwapData
} from "@atomiqlabs/base";
import {IIntermediaryStorage} from "../../storage/IIntermediaryStorage";
import {ISwapPrice} from "../../prices/ISwapPrice";
import {SpvVaultSwap, SpvVaultSwapState} from "./SpvVaultSwap";
import {ISpvVaultSigner} from "../../wallets/ISpvVaultSigner";
import {PluginManager} from "../../plugins/PluginManager";
import {SpvVault, SpvVaultState} from "./SpvVault";
import {serverParamDecoder} from "../../utils/paramcoders/server/ServerParamDecoder";
import {bigIntSorter, expressHandlerWrapper, getAbortController, HEX_REGEX} from "../../utils/Utils";
import {IParamReader} from "../../utils/paramcoders/IParamReader";
import {ServerParamEncoder} from "../../utils/paramcoders/server/ServerParamEncoder";
import {FieldTypeEnum} from "../../utils/paramcoders/SchemaVerifier";
import {FromBtcAmountAssertions} from "../assertions/FromBtcAmountAssertions";
import {randomBytes} from "crypto";
import {Transaction} from "@scure/btc-signer";

const VAULT_DUST_AMOUNT = 600;
const VAULT_INIT_CONFIRMATIONS = 2;

export type SpvVaultSwapHandlerConfig = SwapBaseConfig & {
    vaultsCheckInterval: number,
    gasTokenMax: bigint
};

export type SpvVaultSwapRequestType = {
    address: string,
    amount: bigint,
    token: string,
    gasAmount: bigint,
    gasToken: string,
    exactOut?: boolean
};

export type SpvVaultPostQuote = {
    quoteId: string,
    psbtHex: string
}

class SpvVaultSwapHandler extends SwapHandler<SpvVaultSwap, SpvVaultSwapState> {

    readonly type: SwapHandlerType = SwapHandlerType.FROM_BTC_SPV;

    readonly bitcoin: IBitcoinWallet;
    readonly bitcoinRpc: BitcoinRpc<BtcBlock>;
    readonly vaultSigner: ISpvVaultSigner;
    readonly vaultStorage: IStorageManager<SpvVault>;

    readonly outstandingQuotes: Map<string, SpvVaultSwap> = new Map();

    readonly AmountAssertions: FromBtcAmountAssertions;

    config: SpvVaultSwapHandlerConfig;

    constructor(
        storageDirectory: IIntermediaryStorage<SpvVaultSwap>,
        vaultStorage: IStorageManager<SpvVault>,
        path: string,
        chainsData: MultichainData,
        swapPricing: ISwapPrice,
        bitcoin: IBitcoinWallet,
        bitcoinRpc: BitcoinRpc<BtcBlock>,
        spvVaultSigner: ISpvVaultSigner,
        config: SpvVaultSwapHandlerConfig
    ) {
        super(storageDirectory, path, chainsData, swapPricing);
        this.bitcoinRpc = bitcoinRpc;
        this.bitcoin = bitcoin;
        this.vaultSigner = spvVaultSigner;
        this.vaultStorage = vaultStorage;
        this.config = config;
        this.AmountAssertions = new FromBtcAmountAssertions(config, swapPricing);
    }

    protected async processDepositEvent(vault: SpvVault, event: SpvVaultDepositEvent): Promise<void> {
        vault.update(event);
        await this.vaultStorage.saveData(vault.getIdentifier(), vault);
    }

    protected async processOpenEvent(vault: SpvVault, event: SpvVaultOpenEvent): Promise<void> {
        if(vault.state===SpvVaultState.BTC_CONFIRMED) {
            vault.state = SpvVaultState.OPENED;
            vault.update(event);
            await this.vaultStorage.saveData(vault.getIdentifier(), vault);
        }
    }

    protected async processCloseEvent(vault: SpvVault, event: SpvVaultCloseEvent): Promise<void> {
        if(vault.state===SpvVaultState.OPENED) {
            vault.state = SpvVaultState.CLOSED;
            vault.update(event);
            await this.vaultStorage.saveData(vault.getIdentifier(), vault);
        }
    }

    protected async processClaimEvent(vault: SpvVault, swap: SpvVaultSwap | null, event: SpvVaultClaimEvent): Promise<void> {
        //Update vault
        const foundPendingWithdrawal = vault.pendingWithdrawals.findIndex(val => val.btcTx.txid===event.btcTxId);
        if(foundPendingWithdrawal!==-1) vault.pendingWithdrawals.splice(foundPendingWithdrawal, 1);
        vault.update(event);
        await this.vaultStorage.saveData(vault.getIdentifier(), vault);

        if(swap==null) return;
        //Update swap
        swap.txIds.claim = event.meta?.txId;
        await this.removeSwapData(swap, SpvVaultSwapState.CLAIMED);
    }

    /**
     * Chain event processor
     *
     * @param chainIdentifier
     * @param eventData
     */
    protected async processEvent(chainIdentifier: string, eventData: ChainEvent<SwapData>[]): Promise<boolean> {
        for(let event of eventData) {
            if(!(event instanceof SpvVaultEvent)) continue;

            const vault = this.vaultStorage.data[chainIdentifier+"_"+event.owner+"_"+event.vaultId.toString(10)];
            if(vault==null) continue;

            if(event instanceof SpvVaultOpenEvent) {
                await this.processOpenEvent(vault, event);
            } else if(event instanceof SpvVaultCloseEvent) {
                await this.processCloseEvent(vault, event);
            } else if(event instanceof SpvVaultClaimEvent) {
                const swap = await this.storageManager.getData(event.btcTxId, 0n);

                if(swap!=null) {
                    swap.txIds.claim = (event as any).meta?.txId;
                    if(swap.metadata!=null) swap.metadata.times.claimTxReceived = Date.now();
                }

                await this.processClaimEvent(vault, swap, event);
            } else if(event instanceof SpvVaultDepositEvent) {
                await this.processDepositEvent(vault, event);
            }
        }

        return true;
    }

    /**
     * Initializes chain events subscription
     */
    protected subscribeToEvents() {
        for(let key in this.chains.chains) {
            this.chains.chains[key].chainEvents.registerListener((events: ChainEvent<SwapData>[]) => this.processEvent(key, events));
        }
        this.logger.info("SC: Events: subscribed to smartchain events");
    }

    async createVaults(chainId: string, count: number, token: string, confirmations: number = 2, feeRate?: number): Promise<{vaultsCreated: bigint[], btcTxId: string}> {
        const {signer, chainInterface, tokenMultipliers, spvVaultContract} = this.getChain(chainId);

        //Check vaultId of the latest saved vault
        let latestVaultId: bigint = -1n;
        for(let key in this.vaultStorage.data) {
            const vault = this.vaultStorage.data[key];
            if(vault.chainId!==chainId) continue;
            if(vault.data.getOwner()!==signer.getAddress()) continue;
            if(vault.data.getVaultId() > latestVaultId) latestVaultId = vault.data.getVaultId();
        }

        latestVaultId++;

        const vaultAddreses: {vaultId: bigint, address: string}[] = [];
        for(let i=0;i<count;i++) {
            const vaultId = latestVaultId + BigInt(i);
            const address = await this.vaultSigner.getAddress(chainId, vaultId);
            vaultAddreses.push({vaultId, address});
        }

        //Construct transaction
        const txResult = await this.bitcoin.getSignedMultiTransaction(vaultAddreses.map(val => {
            return {address: val.address, amount: VAULT_DUST_AMOUNT}
        }), feeRate);

        const nativeToken = chainInterface.getNativeCurrencyAddress();

        const vaults = await Promise.all(vaultAddreses.map(async (val, index) => {
            const vaultData = await spvVaultContract.createVaultData(val.vaultId, txResult.txId+":"+index, confirmations, [
                {token, multiplier: tokenMultipliers?.[token] ?? 1n},
                {token: nativeToken, multiplier: tokenMultipliers?.[nativeToken] ?? 1n}
            ]);
            return new SpvVault(chainId, vaultData, val.address);
        }));

        //Save vaults
        await this.vaultStorage.saveDataArr(vaults.map(val => {
            return {id: val.getIdentifier(), object: val}
        }));

        //Send bitcoin tx
        await this.bitcoin.sendRawTransaction(txResult.raw);

        this.logger.info("createVaults(): Funding "+count+" vaults, bitcoin txId: "+txResult.txId);

        return {
            vaultsCreated: vaults.map(val => val.data.getVaultId()),
            btcTxId: txResult.txId
        };
    }

    async listVaults(chainId?: string, token?: string) {
        return Object.keys(this.vaultStorage.data)
            .map(key => this.vaultStorage.data[key])
            .filter(val => chainId==null ? true : val.chainId===chainId)
            .filter(val => token==null ? true : val.data.getTokenData()[0].token===token);
    }

    async fundVault(vault: SpvVault, tokenAmounts: bigint[]): Promise<string> {
        if(vault.state!==SpvVaultState.OPENED) throw new Error("Vault not opened!");

        this.logger.info("fundVault(): Depositing tokens to the vault "+vault.data.getVaultId().toString(10)+", amounts: "+tokenAmounts.map(val => val.toString(10)).join(", "));

        const {signer, spvVaultContract} = this.getChain(vault.chainId);

        const txId = await spvVaultContract.deposit(signer, vault.data, tokenAmounts, {waitForConfirmation: true});

        this.logger.info("fundVault(): Tokens deposited to vault "+vault.data.getVaultId().toString(10)+", amounts: "+tokenAmounts.map(val => val.toString(10)).join(", ")+", txId: "+txId);

        return txId;
    }

    async syncVaults(vaults: SpvVault<SpvWithdrawalTransactionData>[]) {

    }

    async checkVaults() {
        const vaults = Object.keys(this.vaultStorage.data).map(key => this.vaultStorage.data[key]);

        for(let vault of vaults) {
            const {signer, spvVaultContract} = this.getChain(vault.chainId);
            if(vault.data.getOwner()!==signer.getAddress()) continue;

            if(vault.state===SpvVaultState.BTC_INITIATED) {
                //Check if btc tx confirmed
                const txId = vault.initialUtxo.split(":")[0];
                const btcTx = await this.bitcoinRpc.getTransaction(txId);
                if(btcTx.confirmations >= VAULT_INIT_CONFIRMATIONS) {
                    //Double-check the state here to prevent race condition
                    if(vault.state===SpvVaultState.BTC_INITIATED) {
                        vault.state = SpvVaultState.BTC_CONFIRMED;
                        await this.vaultStorage.saveData(vault.getIdentifier(), vault);
                    }
                    this.logger.info("checkVaults(): Vault ID "+vault.data.getVaultId().toString(10)+" confirmed on bitcoin, opening vault on "+vault.chainId);
                }
            }

            if(vault.state===SpvVaultState.BTC_CONFIRMED) {
                const txId = await spvVaultContract.open(signer, vault.data, {waitForConfirmation: true});
                this.logger.info("checkVaults(): Vault ID "+vault.data.getVaultId().toString(10)+" opened on "+vault.chainId+" txId: "+txId);

                vault.state = SpvVaultState.OPENED;
                await this.vaultStorage.saveData(vault.getIdentifier(), vault);
            }
        }
    }

    async startVaultsWatchdog() {
        let rerun: () => Promise<void>;
        rerun = async () => {
            await this.checkVaults().catch( e => console.error(e));
            setTimeout(rerun, this.config.vaultsCheckInterval);
        };
        await rerun();
    }

    async startWatchdog() {
        await super.startWatchdog();
        await this.startVaultsWatchdog();
    }

    async init(): Promise<void> {
        await this.storageManager.loadData(SpvVaultSwap);
        const vaults = await this.vaultStorage.loadData(SpvVault);
        await this.syncVaults(vaults);
        this.subscribeToEvents();
        await PluginManager.serviceInitialize(this);
    }

    protected processPastSwaps(): Promise<void> {
        return Promise.resolve(undefined);
    }

    protected async getVault(chainId: string, owner: string, vaultId: bigint) {
        const vault = this.vaultStorage.data[chainId+"_"+owner+"_"+vaultId.toString(10)];
        if(vault==null) return null;
        if(vault.state!==SpvVaultState.OPENED) return null;
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
    protected async findVaultForSwap(chainIdentifier: string, token: string, amount: bigint, gasToken: string, gasTokenAmount: bigint): Promise<SpvVault<SpvWithdrawalTransactionData> | null> {
        const {signer} = this.getChain(chainIdentifier);

        const candidates = Object.keys(this.vaultStorage.data)
            .map(key => this.vaultStorage.data[key])
            .filter(vault =>
                vault.chainId===chainIdentifier && vault.data.getOwner()===signer.getAddress() && vault.isReady()
            )
            .filter(vault => {
                const token0 = vault.balances[0];
                if(token0.token!==token || token0.scaledAmount < amount) return false;
                if(gasToken!=null && gasTokenAmount!==0n) {
                    const token1 = vault.balances[1];
                    if(token1.token!==gasToken || token1.scaledAmount < gasTokenAmount) return false;
                }
                return true;
            });

        candidates.sort((a, b) => bigIntSorter(a.balances[0].scaledAmount, b.balances[0].scaledAmount));

        const pluginResponse = await PluginManager.onVaultSelection(
            chainIdentifier, {token, amount}, {token: gasToken, amount: gasTokenAmount}, candidates
        );
        this.AmountAssertions.handlePluginErrorResponses(pluginResponse);

        const result = pluginResponse as SpvVault<SpvWithdrawalTransactionData> ?? candidates[0];

        if(result==null) throw {
            code: 20301,
            msg: "No suitable swap vault found, try again later!"
        };

        return result;
    }

    protected getPricePrefetches(chainIdentifier: string, token: string, gasToken: string, abortController: AbortController) {
        const pricePrefetchPromise: Promise<bigint> = this.swapPricing.preFetchPrice(token, chainIdentifier).catch(e => {
            this.logger.error("getPricePrefetches(): pricePrefetchPromise error: ", e);
            abortController.abort(e);
            return null;
        });
        const gasTokenPricePrefetchPromise: Promise<bigint> = token===gasToken ?
            pricePrefetchPromise :
            this.swapPricing.preFetchPrice(gasToken, chainIdentifier).catch(e => {
                this.logger.error("getPricePrefetches(): gasTokenPricePrefetchPromise error: ", e);
                abortController.abort(e);
                return null;
            });
        return {pricePrefetchPromise, gasTokenPricePrefetchPromise};
    }

    startRestServer(restServer: Express): void {
        restServer.use(this.path+"/getQuote", serverParamDecoder(10*1000));
        restServer.post(this.path+"/getQuote", expressHandlerWrapper(async (req: Request & {paramReader: IParamReader}, res: Response & {responseStream: ServerParamEncoder}) => {
            const metadata: {
                request: any,
                times: {[key: string]: number},
            } = {request: {}, times: {}};

            const chainIdentifier = req.query.chain as string ?? this.chains.default;
            const {signer, chainInterface, spvVaultContract} = this.getChain(chainIdentifier);

            metadata.times.requestReceived = Date.now();
            /**
             * address: string              smart chain address of the recipient
             * amount: string               amount (in sats)
             * token: string                Desired token to use
             * gasAmount: string            Desired amount in gas token to also get
             * gasToken: string
             * exactOut: boolean            Whether the swap should be an exact out instead of exact in swap
             */
            const parsedBody: SpvVaultSwapRequestType = await req.paramReader.getParams({
                address: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    chainInterface.isValidAddress(val) ? val : null,
                amount: FieldTypeEnum.BigInt,
                token: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    this.isTokenSupported(chainIdentifier, val) ? val : null,
                gasAmount: FieldTypeEnum.BigInt,
                gasToken: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    chainInterface.isValidToken(val) ? val : null,
                exactOut: FieldTypeEnum.BooleanOptional
            });
            if(parsedBody==null) throw {
                code: 20100,
                msg: "Invalid request body"
            };
            metadata.request = parsedBody;

            if(parsedBody.gasToken!==chainInterface.getNativeCurrencyAddress()) throw {
                code: 20190,
                msg: "Unsupported gas token"
            };

            const requestedAmount = {input: !parsedBody.exactOut, amount: parsedBody.amount, token: parsedBody.token};
            const gasTokenAmount = {input: false, amount: parsedBody.gasAmount, token: parsedBody.gasToken} as const;
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
            const abortController = getAbortController(responseStream);

            //Pre-fetch data
            const {
                pricePrefetchPromise,
                gasTokenPricePrefetchPromise
            } = this.getPricePrefetches(chainIdentifier, useToken, gasToken, abortController);

            //Check valid amount specified (min/max)
            let {
                amountBD,
                swapFee,
                swapFeeInToken,
                totalInToken,
                amountBDgas,
                gasSwapFee,
                gasSwapFeeInToken,
                totalInGasToken
            } = await this.AmountAssertions.checkFromBtcAmount(
                request,
                {...requestedAmount, pricePrefetch: pricePrefetchPromise},
                fees,
                abortController.signal,
                {...gasTokenAmount, pricePrefetch: gasTokenPricePrefetchPromise}
            );
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

            const swap = new SpvVaultSwap(
                chainIdentifier, expiry,
                vault, utxo,
                receiveAddress, btcFeeRate, parsedBody.address, totalBtcOutput, totalInToken, totalInGasToken,
                swapFee, swapFeeInToken, gasSwapFee, gasSwapFeeInToken,
                callerFeeShare, frontingFeeShare, executionFeeShare,
                useToken, gasToken
            );

            const quoteId = randomBytes(32).toString("hex");

            this.outstandingQuotes.set(quoteId, swap);

            this.swapLogger.info(swap, "REST: /getQuote: Created swap address: "+receiveAddress+" amount: "+amountBD.toString(10));

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

        restServer.use(this.path+"/postQuote", serverParamDecoder(10*1000));
        restServer.post(this.path+"/postQuote", expressHandlerWrapper(async (req: Request & {paramReader: IParamReader}, res: Response & {responseStream: ServerParamEncoder}) => {
            const metadata: {
                request: any,
                times: {[key: string]: number},
            } = {request: {}, times: {}};

            metadata.times.requestReceived = Date.now();
            /**
             * address: string              smart chain address of the recipient
             * amount: string               amount (in sats)
             * token: string                Desired token to use
             * gasAmount: string            Desired amount in gas token to also get
             * gasToken: string
             * exactOut: boolean            Whether the swap should be an exact out instead of exact in swap
             */
            const parsedBody: SpvVaultPostQuote = await req.paramReader.getParams({
                quoteId: FieldTypeEnum.String,
                psbtHex: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    HEX_REGEX.test(val) ? val : null
            });

            const swap = this.outstandingQuotes.get(parsedBody.quoteId);
            if(swap==null || swap.expiry < Date.now()/1000) throw {
                code: 20505,
                msg: "Invalid quote ID, not found or expired!"
            };
            this.outstandingQuotes.delete(parsedBody.quoteId);

            const vault = await this.getVault(swap.chainIdentifier, swap.vaultOwner, swap.vaultId);
            if(vault==null || !vault.isReady()) {
                throw {
                    code: 20506,
                    msg: "Used vault not found!"
                };
            }

            //Try parse psbt
            let transaction: Transaction;
            try {
                transaction = Transaction.fromPSBT(Buffer.from(parsedBody.psbtHex, "hex"));
            } catch (e) {
                this.swapLogger.error(swap, "REST: /postQuote: failed to parse provided PSBT: ", e);
                throw {
                    code: 20507,
                    msg: "Error parsing PSBT, hex format required!"
                };
            }

            //Check correct psbt
            const {spvVaultContract} = this.getChain(swap.chainIdentifier);

            let data: SpvWithdrawalTransactionData;
            try {
                data = await spvVaultContract.getWithdrawalDataFromTx(await this.bitcoin.parsePsbt(transaction));
            } catch (e) {
                this.swapLogger.error(swap, "REST: /postQuote: failed to parse PSBT to withdrawal tx data: ", e);
                throw {
                    code: 20508,
                    msg: "PSBT transaction cannot be parsed!"
                };
            }

            if(
                data.recipient!==swap.recipient ||
                data.callerFeeRate!==swap.callerFeeShare ||
                data.frontingFeeRate!==swap.frontingFeeShare ||
                data.executionFeeRate!==swap.executionFeeShare ||
                data.rawAmounts[0]!==swap.rawAmountToken ||
                data.rawAmounts[1]!==swap.rawAmountGasToken ||
                data.getSpentVaultUtxo()!==swap.vaultUtxo ||
                data.btcTx.outs[0].value!==VAULT_DUST_AMOUNT ||
                !Buffer.from(data.btcTx.outs[0].scriptPubKey.hex, "hex").equals(this.bitcoin.toOutputScript(swap.vaultAddress)) ||
                BigInt(data.btcTx.outs[1].value)!==swap.amountBtc ||
                !Buffer.from(data.btcTx.outs[1].scriptPubKey.hex, "hex").equals(this.bitcoin.toOutputScript(swap.btcAddress))
            ) {
                throw {
                    code: 20509,
                    msg: "Invalid PSBT provided!"
                };
            }

            if(swap.vaultUtxo!==vault.getLatestUtxo()) {
                throw {
                    code: 20510,
                    msg: "Vault UTXO already spent, please try again!"
                };
            }

            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;

            const signedTx = await this.vaultSigner.signPsbt(swap.chainIdentifier, swap.vaultId, transaction, [0]);

            const feeRate = Number(signedTx.fee) / signedTx.vsize;
            if(feeRate < swap.btcFeeRate) throw {
                code: 20511,
                msg: "Bitcoin transaction fee too low, expected minimum: "+swap.btcFeeRate
            }

            if(swap.vaultUtxo!==vault.getLatestUtxo()) {
                throw {
                    code: 20510,
                    msg: "Vault UTXO already spent, please try again!"
                };
            }
            vault.addWithdrawal(data);
            await this.vaultStorage.saveData(vault.getIdentifier(), vault);

            swap.btcTxId = signedTx.id;
            swap.state = SpvVaultSwapState.SIGNED;
            await PluginManager.swapCreate(swap);
            await this.saveSwapData(swap);

            this.swapLogger.info(swap, "REST: /postQuote: BTC transaction signed, txId: "+swap.btcTxId);

            try {
                await this.bitcoin.sendRawTransaction(Buffer.from(signedTx.toBytes()).toString("hex"));
                await swap.setState(SpvVaultSwapState.SENT);
            } catch (e) {
                this.swapLogger.error(swap, "REST: /postQuote: Failed to send BTC transaction: ", e);
                vault.removeWithdrawal(data);
                await this.vaultStorage.saveData(vault.getIdentifier(), vault);
                await this.removeSwapData(swap, SpvVaultSwapState.FAILED);
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

    getInfoData(): any {
        return {};
    }

}
