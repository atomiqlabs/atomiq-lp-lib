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
import {SpvVault} from "./SpvVault";
import {serverParamDecoder} from "../../utils/paramcoders/server/ServerParamDecoder";
import {
    expressHandlerWrapper,
    getAbortController,
    HEX_REGEX,
    isDefinedRuntimeError,
    parsePsbt
} from "../../utils/Utils";
import {IParamReader} from "../../utils/paramcoders/IParamReader";
import {ServerParamEncoder} from "../../utils/paramcoders/server/ServerParamEncoder";
import {FieldTypeEnum} from "../../utils/paramcoders/SchemaVerifier";
import {FromBtcAmountAssertions} from "../assertions/FromBtcAmountAssertions";
import {randomBytes} from "crypto";
import {Transaction} from "@scure/btc-signer";
import {SpvVaults, VAULT_DUST_AMOUNT} from "./SpvVaults";
import {isLegacyInput} from "../../utils/BitcoinUtils";
import {AmountAssertions} from "../assertions/AmountAssertions";
import {isQuoteThrow} from "../../plugins/IPlugin";
import {StickyAddress} from "./StickyAddress";

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

const TX_MAX_VSIZE = 16*1024;

type AmountAdjustUtxo = {
    value: number,
    vSize: number,
    cpfp?: {
        effectiveVSize: number,
        effectiveFeeRate: number
    }
}

function parseAmountAdjustUtxos(amountAdjustUtxos: any): AmountAdjustUtxo[] {
    if(!Array.isArray(amountAdjustUtxos)) return null;
    if(amountAdjustUtxos.length > 250) return null;
    const validArray = amountAdjustUtxos.every(value =>
        value!=null && typeof(value)==="object" && typeof(value.value)==="number" && typeof(value.vSize)==="number" &&
        (value.cpfp==null || (typeof(value.cpfp)==="object" && typeof(value.cpfp.effectiveVSize)==="number" && typeof(value.cpfp.effectiveFeeRate)==="number"))
    );
    if(!validArray) return null;
    return amountAdjustUtxos;
}

export class SpvVaultSwapHandler extends SwapHandler<SpvVaultSwap, SpvVaultSwapState> {
    readonly type = SwapHandlerType.FROM_BTC_SPV;
    readonly inflightSwapStates = new Set([SpvVaultSwapState.SIGNED, SpvVaultSwapState.SENT, SpvVaultSwapState.BTC_CONFIRMED]);

    readonly bitcoin: IBitcoinWallet;
    readonly bitcoinRpc: BitcoinRpc<BtcBlock>;
    readonly vaultSigner: ISpvVaultSigner;

    readonly btcTxIdIndex: Map<string, SpvVaultSwap> = new Map();

    readonly AmountAssertions: FromBtcAmountAssertions;
    readonly Vaults: SpvVaults;

    config: SpvVaultSwapHandlerConfig;

    readonly stickyAddresses?: IStorageManager<StickyAddress>;

    constructor(
        storageDirectory: IIntermediaryStorage<SpvVaultSwap>,
        vaultStorage: IStorageManager<SpvVault>,
        path: string,
        chainsData: MultichainData,
        swapPricing: ISwapPrice,
        bitcoin: IBitcoinWallet,
        bitcoinRpc: BitcoinRpc<BtcBlock>,
        spvVaultSigner: ISpvVaultSigner,
        config: SpvVaultSwapHandlerConfig,
        stickyAddresses?: IStorageManager<StickyAddress>
    ) {
        super(storageDirectory, path, chainsData, swapPricing);
        this.bitcoinRpc = bitcoinRpc;
        this.bitcoin = bitcoin;
        this.vaultSigner = spvVaultSigner;
        this.config = config;
        this.AmountAssertions = new FromBtcAmountAssertions(config, swapPricing);
        this.Vaults = new SpvVaults(vaultStorage, bitcoin, spvVaultSigner, bitcoinRpc, this.chains, config);
        this.stickyAddresses = stickyAddresses;

        for(let chain in this.allowedTokens) {
            //Remove chains that don't support spv vault swaps
            const {spvVaultContract} = this.getChain(chain);
            if(spvVaultContract==null) this.allowedTokens[chain].clear();
        }
    }

    private async getStickyAddress(chainId: string, address: string): Promise<string | undefined> {
        if(this.stickyAddresses==null) throw new Error("Sticky addresses are not supported!");

        const {chainInterface} = this.getChain(chainId);
        const normalizedAddress = chainInterface.normalizeAddress(address);

        const addressIdentifier = chainId+"-"+normalizedAddress;

        const result = this.stickyAddresses.data[addressIdentifier];
        if(result==null) return;

        const btcAddress = result.address;

        if(this.bitcoin.isOwnedAddress!=null) {
            if(!(await this.bitcoin.isOwnedAddress(btcAddress))) {
                this.logger.warn(`getStickyAddress(): Failed to get sticky address, address ${btcAddress} is not controlled by our bitcoin wallet!`);
                return;
            }
        }

        return btcAddress;
    }

    async addStickyAddress(chainId: string, address: string, btcAddress: string) {
        if(this.stickyAddresses==null) throw new Error("Sticky addresses are not supported!");

        const {chainInterface} = this.getChain(chainId);
        const normalizedAddress = chainInterface.normalizeAddress(address);

        if(this.bitcoin.isOwnedAddress!=null) {
            if(!(await this.bitcoin.isOwnedAddress(btcAddress))) {
                this.logger.warn(`addStickyAddress(): Failed to create sticky address, address ${btcAddress} is not controlled by our bitcoin wallet!`);
                return;
            }
        }

        const addressIdentifier = chainId+"-"+normalizedAddress;

        if(this.stickyAddresses.data[addressIdentifier]!=null) {
            this.logger.warn(`addStickyAddress(): Failed to create sticky address, address sticky address already exists for ${addressIdentifier}!`);
            return;
        }
        await this.stickyAddresses.saveData(addressIdentifier, new StickyAddress(btcAddress));
    }

    protected async processClaimEvent(swap: SpvVaultSwap | null, event: SpvVaultClaimEvent): Promise<void> {
        if(swap==null) return;
        //Update swap
        swap.txIds.claim = event.meta?.txId;
        await this.removeSwapData(swap, SpvVaultSwapState.CLAIMED);
        if(swap.saveStickyAddress) try {
            await this.addStickyAddress(swap.chainIdentifier, swap.recipient, swap.btcAddress);
        } catch (e) {
            this.logger.error(`processClaimEvent(): Failed to create the sticky address for swap ${swap.getIdentifier()}`);
        }
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
        if(this.stickyAddresses!=null) {
            await this.stickyAddresses.init();
            await this.stickyAddresses.loadData(StickyAddress);
        }
        this.subscribeToEvents();
        await PluginManager.serviceInitialize(this);
    }

    protected async processPastSwap(swap: SpvVaultSwap): Promise<void> {
        if(swap.state===SpvVaultSwapState.CREATED) {
            if(swap.expiry < Date.now()/1000) {
                await this.removeSwapData(swap, SpvVaultSwapState.EXPIRED);
                if(!swap.hasStickyAddress) await this.bitcoin.addUnusedAddress(swap.btcAddress);
            }
        }

        if(swap.state===SpvVaultSwapState.SIGNED) {
            if(swap.sending) return;
            const vault = await this.Vaults.getVault(swap.chainIdentifier, swap.vaultOwner, swap.vaultId);
            const foundWithdrawal = vault.pendingWithdrawals.find(val => val.btcTx.txid === swap.btcTxId);
            let tx = foundWithdrawal?.btcTx;
            if(tx==null) tx = await this.bitcoinRpc.getTransaction(swap.btcTxId);

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

        if(swap.state===SpvVaultSwapState.SENT || swap.state===SpvVaultSwapState.BTC_CONFIRMED) {
            //Check if confirmed or double-spent
            if(swap.sending) return;
            const vault = await this.Vaults.getVault(swap.chainIdentifier, swap.vaultOwner, swap.vaultId);
            const foundWithdrawal = vault.pendingWithdrawals.find(val => val.btcTx.txid === swap.btcTxId);
            let tx = foundWithdrawal?.btcTx;
            if(tx==null) tx = await this.bitcoinRpc.getTransaction(swap.btcTxId);

            if(tx==null) {
                await this.removeSwapData(swap, SpvVaultSwapState.DOUBLE_SPENT);
                return;
            } else if(tx.confirmations > 0) {
                if(swap.state!==SpvVaultSwapState.BTC_CONFIRMED) {
                    await swap.setState(SpvVaultSwapState.BTC_CONFIRMED)
                    await this.saveSwapData(swap);
                }
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
            await this.processPastSwap(swap)
                .catch(e => this.swapLogger.error(swap, "processPastSwap(): Error executing watchdog function: ", e));
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

            const chainIdentifier = req.query.chain as string;
            const {signer, chainInterface, spvVaultContract} = this.getChain(chainIdentifier);

            metadata.times.requestReceived = Date.now();

            /**
             * address: string              smart chain address of the recipient
             * token: string                Desired token to use
             * gasToken: string
             */
            const preFetchParsedBody = await req.paramReader.getParams({
                address: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    chainInterface.isValidAddress(val, true) ? val : null,
                token: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    this.isTokenSupported(chainIdentifier, val) ? val : null,
                gasToken: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    chainInterface.isValidToken(val) ? val : null
            });
            if(preFetchParsedBody==null) throw {
                code: 20100,
                msg: "Invalid request body"
            };

            const stickyAddressObject = req.paramReader.getExistingParamsOrNull({
                stickyAddress: FieldTypeEnum.BooleanOptional
            });
            const useStickyAddress = stickyAddressObject?.stickyAddress;

            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;
            const abortController = getAbortController(responseStream);

            //Pre-fetch data
            const {
                pricePrefetchPromise,
                gasTokenPricePrefetchPromise
            } = this.getPricePrefetches(chainIdentifier, preFetchParsedBody.token, preFetchParsedBody.gasToken, abortController);
            const nativeBalancePrefetch = this.prefetchNativeBalanceIfNeeded(chainIdentifier, abortController);
            const btcFeeRatePrefetch: Promise<number> = this.bitcoin.getFeeRate().catch(e => {
                abortController.abort(e);
                return null;
            });

            //Listener that re-adds the returned bitcoin address to the unused address list if request fails or closes
            let abortAddUnusedAddressListener: () => void;

            const bitcoinAddressPrefetch: Promise<{address: string, isStickyAddress: boolean} | null> = (async () => {
                if(useStickyAddress) {
                    const result = await this.getStickyAddress(chainIdentifier, preFetchParsedBody.address);
                    if(result!=null) return {address: result, isStickyAddress: true};
                }

                const value = await this.bitcoin.getAddress();

                //Already aborted
                if(abortController.signal.aborted) {
                    this.bitcoin.addUnusedAddress(value);
                    return null;
                }
                //Not aborted yet, add an event listener to re-add the address to the unused list
                abortController.signal.addEventListener("abort", abortAddUnusedAddressListener = () => {
                    this.bitcoin.addUnusedAddress(value);
                });
                return {address: value, isStickyAddress: false};
            })().catch(e => {
                abortController.abort(e);
                return null;
            });

            /**
             * amount: string               amount (in sats)
             * gasAmount: string            Desired amount in gas token to also get
             * exactOut: boolean            Whether the swap should be an exact out instead of exact in swap
             * callerFeeRate: string        Caller/watchtower fee (in output token) to assign to the swap
             * frontingFeeRate: string      Fronting fee (in output token) to assign to the swap
             */
            const actualParsedBody = await req.paramReader.getParams({
                amount: FieldTypeEnum.BigInt,
                gasAmount: FieldTypeEnum.BigInt,
                exactOut: FieldTypeEnum.BooleanOptional,
                callerFeeRate: FieldTypeEnum.BigInt,
                frontingFeeRate: FieldTypeEnum.BigInt,
            });
            abortController.signal.throwIfAborted();
            if(actualParsedBody==null) throw {
                code: 20100,
                msg: "Invalid request body"
            };

            const inputAmountAdjustments = req.paramReader.getExistingParamsOrNull({
                amountUtxos: FieldTypeEnum.AnyOptional,
                amountFeeRate: FieldTypeEnum.NumberOptional
            });
            if(inputAmountAdjustments==null) throw {
                code: 20100,
                msg: "Invalid request body"
            };

            const clientInputUtxos: AmountAdjustUtxo[] | null = inputAmountAdjustments?.amountUtxos!=null
                ? parseAmountAdjustUtxos(inputAmountAdjustments.amountUtxos)
                : null;
            if(inputAmountAdjustments?.amountUtxos!=null && clientInputUtxos==null) throw {
                code: 20100,
                msg: "Invalid request body (amountUtxos)"
            };

            const parsedBody: SpvVaultSwapRequestType = {...preFetchParsedBody, ...actualParsedBody};
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
            if(clientInputUtxos!=null) {
                if(parsedBody.exactOut) throw {
                    code: 20193,
                    msg: "amountAdjustUtxos cannot be specified for exactOut swaps!"
                };

                let btcFeeRate = await btcFeeRatePrefetch;
                if(inputAmountAdjustments.amountFeeRate!=null && inputAmountAdjustments.amountFeeRate>btcFeeRate)
                    btcFeeRate = inputAmountAdjustments.amountFeeRate;

                let feeAccumulator: number = 0;
                let valueAccumulator: number = 0;
                for(let utxo of clientInputUtxos) {
                    const cpfpAdditionalFee: number = utxo.cpfp==null ? 0 : Math.ceil(utxo.cpfp.effectiveVSize * Math.max(0, btcFeeRate - utxo.cpfp.effectiveFeeRate));
                    const spendFee: number = utxo.vSize * btcFeeRate;
                    const totalFee: number = cpfpAdditionalFee + spendFee;
                    if(totalFee > utxo.value) continue; //Skip detrimental UTXO
                    feeAccumulator += totalFee;
                    valueAccumulator += utxo.value;
                }

                let baseTxVSize: number = 10.5; // 4b version, 1b inputs, 1b outputs, 4b locktime, 0.5vB witness flag + witness elements count
                //vault input and output
                baseTxVSize += 32 + 4 + 1 + 4; //Input base
                baseTxVSize += this.vaultSigner.getAddressType()==="p2tr" ? (1+1+65)/4 : (1+1+72+1+33)/4;
                baseTxVSize += 8 + 1; //Output base
                baseTxVSize += this.vaultSigner.getAddressType()==="p2tr" ? 34 : 22;
                //opreturn output
                baseTxVSize += 8 + 1; //Output base
                const opReturnDataSize = spvVaultContract.toOpReturnData(parsedBody.address, parsedBody.gasAmount > 0 ? [0xffffffffffffffffn, 0xffffffffffffffffn] : [0xffffffffffffffffn]).length;
                baseTxVSize += (opReturnDataSize <= 0x4b ? 2 : 3 /*Needs an OP_PUSHDATA1 opcode*/) + opReturnDataSize;
                //LP output
                baseTxVSize += 8 + 1; //Output base
                baseTxVSize += this.bitcoin.getAddressType()==="p2tr" ? 34 : this.bitcoin.getAddressType()==="p2wpkh" ? 22 : 23;

                const baseTxFee = Math.ceil(baseTxVSize) * btcFeeRate;
                feeAccumulator += baseTxFee;

                const amount = Math.floor(valueAccumulator - Math.ceil(feeAccumulator));
                requestedAmount.amount = BigInt(amount);
            }

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

            this.checkTooManyInflightSwaps();

            //Check request params
            const fees = await this.AmountAssertions.preCheckFromBtcAmounts(this.type, request, requestedAmount, gasTokenAmount);
            metadata.times.requestChecked = Date.now();

            await this.checkNativeBalance(chainIdentifier, nativeBalancePrefetch, abortController.signal);

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
            let vault: SpvVault;
            do {
                vault = await this.Vaults.findVaultForSwap(chainIdentifier, totalBtcOutput, useToken, totalInToken, gasToken, totalInGasToken);
            } while (await this.Vaults.checkVaultReplacedTransactions(vault, true));
            abortController.signal.throwIfAborted();
            metadata.times.vaultPicked = Date.now();

            //Create swap receive bitcoin address
            const btcFeeRate = await btcFeeRatePrefetch;
            const btcAddressObject = await bitcoinAddressPrefetch;
            abortController.signal.throwIfAborted();
            metadata.times.addressCreated = Date.now();

            const receiveAddress = btcAddressObject.address;
            const hasStickyAddress = btcAddressObject.isStickyAddress;

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
            swap.saveStickyAddress = useStickyAddress && !hasStickyAddress
            swap.hasStickyAddress = hasStickyAddress;

            //We can remove the listener to add unused address now, as we are about to save the swap
            abortController.signal.removeEventListener("abort", abortAddUnusedAddressListener);
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
                    executionFeeShare: executionFeeShare.toString(10),

                    usedUtxoInputCalculation: clientInputUtxos!=null
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

            this.checkTooManyInflightSwaps();

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

            for(let i=1;i<transaction.inputsLength;i++) { //Skip first vault input
                const txIn = transaction.getInput(i);
                if (isLegacyInput(txIn)) throw {
                    code: 20514,
                    msg: "Legacy (pre-segwit) inputs in tx are not allowed!"
                };
            }

            //Check the posted quote with the plugins
            AmountAssertions.handlePluginErrorResponses(await PluginManager.onHandlePostedFromBtcQuote(
                this.type,
                {chainIdentifier: swap.chainIdentifier, raw: req, parsed: parsedBody, metadata},
                swap
            ));

            //Check correct psbt
            for(let i=1;i<transaction.inputsLength;i++) { //Skip first vault input
                const txIn = transaction.getInput(i);
                //Check UTXOs exist and are unspent
                if(await this.bitcoinRpc.isSpent(Buffer.from(txIn.txid).toString("hex")+":"+txIn.index.toString(10))) throw {
                    code: 20515,
                    msg: "Spent UTXO in inputs!"
                };
            }

            const {spvVaultContract} = this.getChain(swap.chainIdentifier);

            let data: SpvWithdrawalTransactionData;
            try {
                data = await spvVaultContract.getWithdrawalData(parsePsbt(transaction));
            } catch (e) {
                this.swapLogger.error(swap, "REST: /postQuote: failed to parse PSBT to withdrawal tx data: ", e);
                throw {
                    code: 20508,
                    msg: "PSBT transaction cannot be parsed!"
                };
            }

            if(
                !data.isRecipient(swap.recipient) ||
                data.callerFeeRate!==swap.callerFeeShare ||
                data.frontingFeeRate!==swap.frontingFeeShare ||
                data.executionFeeRate!==swap.executionFeeShare ||
                data.rawAmounts[0]!==swap.rawAmountToken ||
                data.rawAmounts[1]!==swap.rawAmountGasToken ||
                data.getExecutionData()!=null ||
                data.getSpentVaultUtxo()!==swap.vaultUtxo ||
                data.btcTx.outs[0].value!==VAULT_DUST_AMOUNT ||
                !Buffer.from(data.btcTx.outs[0].scriptPubKey.hex, "hex").equals(this.bitcoin.toOutputScript(swap.vaultAddress)) ||
                BigInt(data.btcTx.outs[2].value)!==swap.amountBtc ||
                !Buffer.from(data.btcTx.outs[2].scriptPubKey.hex, "hex").equals(this.bitcoin.toOutputScript(swap.btcAddress)) ||
                (data.btcTx.locktime > 0 && data.btcTx.locktime < 500_000_000) ||
                data.btcTx.locktime > Math.floor(Date.now()/1000) - 1_000_000
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
                    msg: "Vault UTXO already spent, please get another quote and try again!"
                };
            }

            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;

            const signedTx = await this.vaultSigner.signPsbt(swap.chainIdentifier, swap.vaultId, transaction, [0]);
            if(!signedTx.isFinal) throw {
                code: 20513,
                msg: "One or more PSBT inputs not finalized!"
            };

            const effectiveFeeRate = await this.bitcoinRpc.getEffectiveFeeRate(parsePsbt(signedTx));
            if(effectiveFeeRate.feeRate < 1 || Math.round(effectiveFeeRate.feeRate) < swap.btcFeeRate) throw {
                code: 20511,
                msg: "Bitcoin transaction fee too low, expected minimum: "+swap.btcFeeRate+" adjusted effective fee rate: "+effectiveFeeRate.feeRate
            }

            const txVsize = signedTx.vsize;
            if(txVsize>TX_MAX_VSIZE) throw {
                code: 20516,
                msg: "Bitcoin transaction size too large, maximum: "+TX_MAX_VSIZE+" actual: "+txVsize
            };

            const pluginCheckResult = await PluginManager.onHandlePreFromBtcExecute(
                SwapHandlerType.FROM_BTC_SPV,
                swap
            );
            if(isQuoteThrow(pluginCheckResult)) {
                if(swap.state===SpvVaultSwapState.CREATED)
                    await this.removeSwapData(swap, SpvVaultSwapState.FAILED);
                throw {
                    code: 29999,
                    msg: pluginCheckResult.message
                };
            }

            await this.Vaults.checkVaultReplacedTransactions(vault, true);
            if(swap.vaultUtxo!==vault.getLatestUtxo()) {
                throw {
                    code: 20510,
                    msg: "Vault UTXO already spent, please get another quote and try again!"
                };
            }

            const unlock = swap.lock(120);
            if(!unlock) throw {
                code: 20517,
                msg: "Bitcoin transaction submission already in progress, please retry later!"
            };

            let swapSendingSet = false;
            let dataSendingSet = false;
            try {
                const btcRawTx = Buffer.from(signedTx.toBytes(true, true)).toString("hex");

                //Double-check the state to prevent race condition
                if(swap.state!==SpvVaultSwapState.CREATED) throw {
                    code: 20505,
                    msg: "Invalid quote ID, not found or expired!"
                };

                //Double check in-flight swap count
                this.checkTooManyInflightSwaps();

                swap.btcTxId = signedTx.id;
                swap.state = SpvVaultSwapState.SIGNED;
                swap.sending = true;
                swapSendingSet = true;
                await this.saveSwapData(swap);

                data.btcTx.raw = btcRawTx;
                (data as any).sending = true;
                vault.addWithdrawal(data);
                dataSendingSet = true;
                await this.Vaults.saveVault(vault);

                this.swapLogger.info(swap, "REST: /postQuote: BTC transaction signed, txId: "+swap.btcTxId);

                try {
                    await this.bitcoin.sendRawTransaction(btcRawTx);
                    await swap.setState(SpvVaultSwapState.SENT);
                    (data as any).sending = false;
                    swap.sending = false;
                } catch (e) {
                    this.swapLogger.error(swap, "REST: /postQuote: Failed to send BTC transaction: ", e);
                    throw {
                        code: 20512,
                        msg: "Error broadcasting bitcoin transaction!"
                    };
                }
            } catch (e) {
                if(swapSendingSet) swap.sending = false;
                if(dataSendingSet) {
                    (data as any).sending = false;
                    vault.removeWithdrawal(data);
                    await this.Vaults.saveVault(vault);
                }

                //Check if the error is only because the state has already changed
                if(!isDefinedRuntimeError(e) || e.code!==20505) {
                    //We only make the swap failed if the error happened in CREATED or SIGNED states
                    if(swap.state===SpvVaultSwapState.CREATED || swap.state===SpvVaultSwapState.SIGNED) {
                        if(isDefinedRuntimeError(e) && swap.metadata!=null) swap.metadata.postQuoteError = e;
                        await this.removeSwapData(swap, SpvVaultSwapState.FAILED);
                    }
                }

                throw e;
            } finally {
                unlock();
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

    protected async removeSwapData(swap: SpvVaultSwap, ultimateState?: SpvVaultSwapState): Promise<void> {
        if(swap.btcTxId!=null) this.btcTxIdIndex.delete(swap.btcTxId);
        return super.removeSwapData(swap, ultimateState);
    }

}
