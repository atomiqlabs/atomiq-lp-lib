import {MultichainData, SwapBaseConfig, SwapHandler, SwapHandlerType} from "../SwapHandler";
import {Express, Request, Response} from "express";
import {IBitcoinWallet} from "../../wallets/IBitcoinWallet";
import {
    BitcoinRpc,
    BtcBlock, BtcTx,
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
import {SpvVault} from "./SpvVault";
import {serverParamDecoder} from "../../utils/paramcoders/server/ServerParamDecoder";
import {expressHandlerWrapper, getAbortController, HEX_REGEX} from "../../utils/Utils";
import {IParamReader} from "../../utils/paramcoders/IParamReader";
import {ServerParamEncoder} from "../../utils/paramcoders/server/ServerParamEncoder";
import {FieldTypeEnum} from "../../utils/paramcoders/SchemaVerifier";
import {FromBtcAmountAssertions} from "../assertions/FromBtcAmountAssertions";
import {randomBytes} from "crypto";
import {getInputType, OutScript, Transaction} from "@scure/btc-signer";
import {SpvVaults, VAULT_DUST_AMOUNT} from "./SpvVaults";

export type SpvVaultSwapHandlerConfig = SwapBaseConfig & {
    vaultsCheckInterval: number,
    gasTokenMax: {[chainId: string]: bigint},
    maxUnclaimedWithdrawals?: number
};

export type SpvVaultSwapRequestType = {
    address: string,
    amount: bigint,
    token: string,
    gasAmount: bigint,
    gasToken: string,
    exactOut?: boolean,
    callerFeeRate: bigint,
    frontingFeeRate: bigint
};

export type SpvVaultPostQuote = {
    quoteId: string,
    psbtHex: string
}

export class SpvVaultSwapHandler extends SwapHandler<SpvVaultSwap, SpvVaultSwapState> {

    readonly type = SwapHandlerType.FROM_BTC_SPV;

    readonly bitcoin: IBitcoinWallet;
    readonly bitcoinRpc: BitcoinRpc<BtcBlock>;
    readonly vaultSigner: ISpvVaultSigner;

    readonly btcTxIdIndex: Map<string, SpvVaultSwap> = new Map();

    readonly AmountAssertions: FromBtcAmountAssertions;
    readonly Vaults: SpvVaults;

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
        this.config = config;
        this.AmountAssertions = new FromBtcAmountAssertions(config, swapPricing);
        this.Vaults = new SpvVaults(vaultStorage, bitcoin, spvVaultSigner, bitcoinRpc, this.getChain.bind(this), config);
    }

    protected async processClaimEvent(swap: SpvVaultSwap | null, event: SpvVaultClaimEvent): Promise<void> {
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

            const vault = await this.Vaults.getVault(chainIdentifier, event.owner, event.vaultId);
            if(vault==null) continue;

            if(event instanceof SpvVaultOpenEvent) {
                await this.Vaults.processOpenEvent(vault, event);
            } else if(event instanceof SpvVaultCloseEvent) {
                await this.Vaults.processCloseEvent(vault, event);
            } else if(event instanceof SpvVaultClaimEvent) {
                const swap = this.btcTxIdIndex.get(event.btcTxId);

                if(swap!=null) {
                    swap.txIds.claim = (event as any).meta?.txId;
                    if(swap.metadata!=null) swap.metadata.times.claimTxReceived = Date.now();
                }

                await this.Vaults.processClaimEvent(vault, swap, event);
                await this.processClaimEvent(swap, event);
            } else if(event instanceof SpvVaultDepositEvent) {
                await this.Vaults.processDepositEvent(vault, event);
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

    async startWatchdog() {
        await super.startWatchdog();
        await this.Vaults.startVaultsWatchdog();
    }

    async init(): Promise<void> {
        await this.storageManager.loadData(SpvVaultSwap);
        for(let {obj: swap, hash, sequence} of await this.storageManager.query([])) {
            if(swap.btcTxId!=null) this.btcTxIdIndex.set(swap.btcTxId, swap);
        }
        await this.Vaults.init();
        this.subscribeToEvents();
        await PluginManager.serviceInitialize(this);
    }

    protected async processPastSwap(swap: SpvVaultSwap): Promise<void> {
        if(swap.state===SpvVaultSwapState.CREATED) {
            if(swap.expiry < Date.now()/1000) {
                await this.removeSwapData(swap, SpvVaultSwapState.EXPIRED);
                await this.bitcoin.addUnusedAddress(swap.btcAddress);
            }
        }

        if(swap.state===SpvVaultSwapState.SIGNED) {
            //Check if sent
            const tx = await this.bitcoinRpc.getTransaction(swap.btcTxId);
            if(tx==null) {
                await this.removeSwapData(swap, SpvVaultSwapState.FAILED);
                return;
            } else if(tx.confirmations===0) {
                await swap.setState(SpvVaultSwapState.SENT)
                await this.saveSwapData(swap);
                return;
            } else {
                await swap.setState(SpvVaultSwapState.BTC_CONFIRMED)
                await this.saveSwapData(swap);
            }
        }

        if(swap.state===SpvVaultSwapState.SENT) {
            //Check if confirmed or double-spent
            const tx = await this.bitcoinRpc.getTransaction(swap.btcTxId);
            if(tx==null) {
                await this.removeSwapData(swap, SpvVaultSwapState.DOUBLE_SPENT);
                return;
            } else if(tx.confirmations > 0) {
                await swap.setState(SpvVaultSwapState.BTC_CONFIRMED)
                await this.saveSwapData(swap);
            }
        }
    }

    protected async processPastSwaps(): Promise<void> {
        const swaps = await this.storageManager.query([
            {
                key: "state",
                value: [
                    SpvVaultSwapState.CREATED, //Check if expired
                    SpvVaultSwapState.SIGNED, //Check if sent
                    SpvVaultSwapState.SENT //Check if confirmed or double-spent
                ]
            }
        ]);

        for(let {obj: swap} of swaps) {
            await this.processPastSwap(swap);
        }
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
             * callerFeeRate: string        Caller/watchtower fee (in output token) to assign to the swap
             * frontingFeeRate: string      Fronting fee (in output token) to assign to the swap
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
                exactOut: FieldTypeEnum.BooleanOptional,
                callerFeeRate: FieldTypeEnum.BigInt,
                frontingFeeRate: FieldTypeEnum.BigInt,
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

            if(parsedBody.callerFeeRate < 0n || parsedBody.callerFeeRate >= 2n**20n) throw {
                code: 20191,
                msg: "Invalid caller fee rate"
            };
            if(parsedBody.frontingFeeRate < 0n || parsedBody.frontingFeeRate >= 2n**20n) throw {
                code: 20192,
                msg: "Invalid fronting fee rate"
            };

            const requestedAmount = {
                input: !parsedBody.exactOut,
                amount: parsedBody.exactOut ?
                    (parsedBody.amount * (100_000n + parsedBody.callerFeeRate + parsedBody.frontingFeeRate) / 100_000n) :
                    parsedBody.amount,
                token: parsedBody.token
            };
            const gasTokenAmount = {
                input: false,
                amount: parsedBody.gasAmount * (100_000n + parsedBody.callerFeeRate + parsedBody.frontingFeeRate) / 100_000n,
                token: parsedBody.gasToken
            } as const;
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
                this.type,
                request,
                {...requestedAmount, pricePrefetch: pricePrefetchPromise},
                fees,
                abortController.signal,
                {...gasTokenAmount, pricePrefetch: gasTokenPricePrefetchPromise}
            );
            metadata.times.priceCalculated = Date.now();

            const totalBtcOutput = amountBD + amountBDgas;

            //Check if we have enough funds to honor the request
            const vault = await this.Vaults.findVaultForSwap(chainIdentifier, totalBtcOutput, useToken, totalInToken, gasToken, totalInGasToken);
            metadata.times.vaultPicked = Date.now();

            //Create swap receive bitcoin address
            const btcFeeRate = await this.bitcoin.getFeeRate();
            const receiveAddress = await this.bitcoin.getAddress();
            abortController.signal.throwIfAborted();
            metadata.times.addressCreated = Date.now();

            //Adjust the amounts based on passed fees
            if(parsedBody.exactOut) {
                totalInToken = parsedBody.amount;
            } else {
                totalInToken = (totalInToken * 100_000n / (100_000n + parsedBody.callerFeeRate + parsedBody.frontingFeeRate));
            }
            totalInGasToken = (totalInGasToken * 100_000n / (100_000n + parsedBody.callerFeeRate + parsedBody.frontingFeeRate));

            //Calculate raw amounts
            const [rawTokenAmount, rawGasTokenAmount] = vault.toRawAmounts([totalInToken, totalInGasToken]);
            [totalInToken, totalInGasToken] = vault.fromRawAmounts([rawTokenAmount, rawGasTokenAmount]);

            const expiry = Math.floor(Date.now() / 1000) + this.getInitAuthorizationTimeout(chainIdentifier);

            //Get PSBT data
            const callerFeeShare = parsedBody.callerFeeRate;
            const frontingFeeShare = parsedBody.frontingFeeRate;
            const executionFeeShare = 0n;
            const utxo = vault.getLatestUtxo();

            const quoteId = randomBytes(32).toString("hex");
            const swap = new SpvVaultSwap(
                chainIdentifier, quoteId, expiry,
                vault, utxo,
                receiveAddress, btcFeeRate, parsedBody.address, totalBtcOutput, totalInToken, totalInGasToken,
                swapFee, swapFeeInToken, gasSwapFee, gasSwapFeeInToken,
                callerFeeShare, frontingFeeShare, executionFeeShare,
                useToken, gasToken
            );
            swap.metadata = metadata;

            await PluginManager.swapCreate(swap);
            await this.saveSwapData(swap);

            this.swapLogger.info(swap, "REST: /getQuote: Created swap address: "+receiveAddress+" amount: "+totalBtcOutput.toString(10));

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

        restServer.use(this.path+"/postQuote", serverParamDecoder(10*1000));
        restServer.post(this.path+"/postQuote", expressHandlerWrapper(async (req: Request & {paramReader: IParamReader}, res: Response & {responseStream: ServerParamEncoder}) => {
            let requestReceived = Date.now();

            const parsedBody: SpvVaultPostQuote = await req.paramReader.getParams({
                quoteId: FieldTypeEnum.String,
                psbtHex: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    HEX_REGEX.test(val) ? val : null
            });

            const swap = await this.storageManager.getData(parsedBody.quoteId, 0n);
            if(swap==null || swap.state!==SpvVaultSwapState.CREATED || swap.expiry < Date.now()/1000) throw {
                code: 20505,
                msg: "Invalid quote ID, not found or expired!"
            };

            const metadata: {
                times: {[key: string]: number},
                error?: any
            } = swap.metadata;
            metadata.times ??= {};
            metadata.times.requestReceived = requestReceived;

            const vault = await this.Vaults.getVault(swap.chainIdentifier, swap.vaultOwner, swap.vaultId);
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
            for(let i=1;i<transaction.inputsLength;i++) { //Skip first vault input
                const txIn = transaction.getInput(i);
                if(getInputType(txIn).txType==="legacy") throw {
                    code: 20514,
                    msg: "Legacy (pre-segwit) inputs in tx are not allowed!"
                };
                //Check UTXOs exist and are unspent
                if(await this.bitcoinRpc.isSpent(Buffer.from(txIn.txid).toString("hex")+":"+txIn.index.toString(10))) throw {
                    code: 20515,
                    msg: "Spent UTXO in inputs!"
                };
            }

            const {spvVaultContract} = this.getChain(swap.chainIdentifier);

            let data: SpvWithdrawalTransactionData;
            try {
                data = await spvVaultContract.getWithdrawalData(await this.bitcoin.parsePsbt(transaction));
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
                BigInt(data.btcTx.outs[2].value)!==swap.amountBtc ||
                !Buffer.from(data.btcTx.outs[2].scriptPubKey.hex, "hex").equals(this.bitcoin.toOutputScript(swap.btcAddress))
            ) {
                this.swapLogger.error(swap, "REST: /postQuote: Invalid psbt data submitted, raw psbt hex: ", parsedBody.psbtHex);
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
            if(!signedTx.isFinal) throw {
                code: 20513,
                msg: "One or more PSBT inputs not finalized!"
            };

            const effectiveFeeRate = await this.bitcoinRpc.getEffectiveFeeRate(await this.bitcoin.parsePsbt(signedTx));
            if(effectiveFeeRate.feeRate < swap.btcFeeRate) throw {
                code: 20511,
                msg: "Bitcoin transaction fee too low, expected minimum: "+swap.btcFeeRate+" adjusted effective fee rate: "+effectiveFeeRate.feeRate
            }

            if(swap.vaultUtxo!==vault.getLatestUtxo()) {
                throw {
                    code: 20510,
                    msg: "Vault UTXO already spent, please try again!"
                };
            }
            vault.addWithdrawal(data);
            await this.Vaults.saveVault(vault);

            //Double-check the state to prevent race condition
            if(swap.state!==SpvVaultSwapState.CREATED) throw {
                code: 20505,
                msg: "Invalid quote ID, not found or expired!"
            };
            swap.btcTxId = signedTx.id;
            swap.state = SpvVaultSwapState.SIGNED;
            await this.saveSwapData(swap);

            this.swapLogger.info(swap, "REST: /postQuote: BTC transaction signed, txId: "+swap.btcTxId);

            try {
                await this.bitcoin.sendRawTransaction(Buffer.from(signedTx.toBytes(true, true)).toString("hex"));
                await swap.setState(SpvVaultSwapState.SENT);
            } catch (e) {
                this.swapLogger.error(swap, "REST: /postQuote: Failed to send BTC transaction: ", e);
                vault.removeWithdrawal(data);
                await this.Vaults.saveVault(vault);
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
        const mappedDict = {};
        for(let chainId in this.config.gasTokenMax) {
            mappedDict[chainId] = {
                gasToken: this.getChain(chainId).chainInterface.getNativeCurrencyAddress(),
                max: this.config.gasTokenMax[chainId].toString(10)
            };
        }
        return {
            gasTokens: mappedDict
        };
    }

    protected async saveSwapData(swap: SpvVaultSwap): Promise<void> {
        if(swap.btcTxId!=null) this.btcTxIdIndex.set(swap.btcTxId, swap);
        return super.saveSwapData(swap);
    }

    protected removeSwapData(hash: string, sequence: bigint): Promise<void>;
    protected removeSwapData(swap: SpvVaultSwap, ultimateState?: SpvVaultSwapState): Promise<void>;
    protected async removeSwapData(hashOrSwap: string | SpvVaultSwap, sequenceOrUltimateState?: bigint | SpvVaultSwapState): Promise<void> {
        let swap: SpvVaultSwap;
        let state: SpvVaultSwapState;
        if(typeof(hashOrSwap)==="string") {
            if(typeof(sequenceOrUltimateState)!=="bigint") throw new Error("Sequence must be a BN instance!");
            swap = await this.storageManager.getData(hashOrSwap, sequenceOrUltimateState);
        } else {
            swap = hashOrSwap;
            if(sequenceOrUltimateState!=null && typeof(sequenceOrUltimateState)!=="bigint") state = sequenceOrUltimateState;
        }
        if(swap.btcTxId!=null) this.btcTxIdIndex.delete(swap.btcTxId);
        return super.removeSwapData(swap, state);
    }

}
