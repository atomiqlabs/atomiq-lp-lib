import {FromBtcBaseConfig, FromBtcBaseSwapHandler} from "../FromBtcBaseSwapHandler";
import {FromBtcTrustedSwap, FromBtcTrustedSwapState} from "./FromBtcTrustedSwap";
import {BitcoinRpc, BtcBlock, BtcTx, ClaimEvent, InitializeEvent, RefundEvent, SwapData} from "@atomiqlabs/base";
import {Express, Request, Response} from "express";
import {MultichainData, SwapHandlerType} from "../SwapHandler";
import * as BN from "bn.js";
import {IIntermediaryStorage} from "../../storage/IIntermediaryStorage";
import {
    AuthenticatedLnd,
    broadcastChainTransaction,
    ChainTransaction,
    createChainAddress,
    getChainTransactions,
    getHeight,
    signPsbt,
    subscribeToTransactions,
    SubscribeToTransactionsChainTransactionEvent
} from "lightning";
import {ISwapPrice} from "../ISwapPrice";
import {PluginManager} from "../../plugins/PluginManager";
import * as bitcoin from "bitcoinjs-lib";
import {address, networks, Psbt, Transaction, TxOutput} from "bitcoinjs-lib";
import {IBtcFeeEstimator} from "../../fees/IBtcFeeEstimator";
import {utils} from "../../utils/coinselect2/utils";
import {expressHandlerWrapper, HEX_REGEX} from "../../utils/Utils";
import {IParamReader} from "../../utils/paramcoders/IParamReader";
import {ServerParamEncoder} from "../../utils/paramcoders/server/ServerParamEncoder";
import {FieldTypeEnum, verifySchema} from "../../utils/paramcoders/SchemaVerifier";
import {serverParamDecoder} from "../../utils/paramcoders/server/ServerParamDecoder";

export type FromBtcTrustedConfig = FromBtcBaseConfig & {
    bitcoinNetwork: networks.Network,
    feeEstimator: IBtcFeeEstimator,
    doubleSpendCheckInterval: number,
    swapAddressExpiry: number,
    recommendFeeMultiplier?: number,
}

export type FromBtcTrustedRequestType = {
    address: string,
    amount: BN,
    exactOut?: boolean
};

export class FromBtcTrusted extends FromBtcBaseSwapHandler<FromBtcTrustedSwap, FromBtcTrustedSwapState> {
    readonly type: SwapHandlerType = SwapHandlerType.FROM_BTC_TRUSTED;

    readonly config: FromBtcTrustedConfig;
    readonly bitcoinRpc: BitcoinRpc<BtcBlock>;

    readonly subscriptions: Map<string, FromBtcTrustedSwap> = new Map<string, FromBtcTrustedSwap>();
    readonly doubleSpendWatchdogSwaps: Set<FromBtcTrustedSwap> = new Set<FromBtcTrustedSwap>();

    readonly refundedSwaps: Map<string, string> = new Map();
    readonly doubleSpentSwaps: Map<string, string> = new Map();
    readonly processedTxIds: Map<string, { txId: string, adjustedAmount: BN, adjustedTotal: BN }> = new Map();

    constructor(
        storageDirectory: IIntermediaryStorage<FromBtcTrustedSwap>,
        path: string,
        chains: MultichainData,
        lnd: AuthenticatedLnd,
        swapPricing: ISwapPrice,
        bitcoinRpc: BitcoinRpc<BtcBlock>,
        config: FromBtcTrustedConfig
    ) {
        super(storageDirectory, path, chains, lnd, swapPricing);
        this.config = config;
        this.config.recommendFeeMultiplier ??= 1.25;
        this.bitcoinRpc = bitcoinRpc;
        for(let chainId in chains.chains) {
            this.allowedTokens[chainId] = new Set<string>([chains.chains[chainId].swapContract.getNativeCurrencyAddress()]);
        }
    }

    private getAllAncestors(tx: ChainTransaction): Promise<{tx: BtcTx, vout: number}[]> {
        return Promise.all(tx.inputs.map(input => this.bitcoinRpc.getTransaction(input.transaction_id).then(tx => {
            return {tx, vout: input.transaction_vout}
        })));
    }

    private async refundSwap(swap: FromBtcTrustedSwap) {
        if(swap.refundAddress==null) {
            if(swap.state!==FromBtcTrustedSwapState.REFUNDABLE) {
                await swap.setState(FromBtcTrustedSwapState.REFUNDABLE);
                await this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
            }
            return;
        }

        let unlock = swap.lock(30*1000);
        if(unlock==null) return;

        const feeRate = await this.config.feeEstimator.estimateFee();

        const initialTx = Transaction.fromHex(swap.rawTx);
        const ourOutput = initialTx.outs[swap.vout];

        //Construct PSBT
        const refundOutputScript = address.toOutputScript(swap.refundAddress, this.config.bitcoinNetwork);
        const txBytes = utils.transactionBytes([{type: "p2wpkh"}], [{script: refundOutputScript}], "p2wpkh");
        const txFee = txBytes*feeRate;
        const adjustedOutput = ourOutput.value-txFee;
        if(adjustedOutput<546) {
            this.swapLogger.error(swap, "refundSwap(): cannot refund swap because of dust limit, txId: "+swap.txId);
            unlock();
            return;
        }

        //Construct PSBT
        const _psbt = new Psbt({network: this.config.bitcoinNetwork});
        _psbt.addInput({
            hash: initialTx.getHash(),
            index: swap.vout,
            witnessUtxo: ourOutput,
            sighashType: 0x01,
            sequence: 0xfffffffd
        });
        _psbt.addOutput({
            script: refundOutputScript,
            value: adjustedOutput
        });

        //Sign
        const {psbt, transaction} = await signPsbt({
            lnd: this.LND,
            psbt: _psbt.toHex()
        });
        if(swap.metadata!=null) swap.metadata.times.refundSignPSBT = Date.now();
        this.swapLogger.debug(swap, "refundSwap(): signed raw transaction: "+transaction);

        const signedTx = Transaction.fromHex(transaction);
        const refundTxId = signedTx.getId();
        swap.refundTxId = refundTxId;

        //Send the refund TX
        await broadcastChainTransaction({transaction, lnd: this.LND});

        this.swapLogger.debug(swap, "refundSwap(): sent refund transaction: "+refundTxId);

        this.refundedSwaps.set(swap.getHash(), refundTxId);
        await this.removeSwapData(swap, FromBtcTrustedSwapState.REFUNDED);
        unlock();
    }

    private async burn(swap: FromBtcTrustedSwap) {
        const initialTx = Transaction.fromHex(swap.rawTx);
        const ourOutput = initialTx.outs[swap.vout];

        //Check if we can even increase the feeRate by burning
        const txSize = 110;
        const burnTxFeeRate = Math.floor(ourOutput.value/txSize);
        const initialTxFeeRate = Math.ceil(swap.txFee/swap.txSize);

        if(burnTxFeeRate<initialTxFeeRate) {
            this.swapLogger.warn(swap, "burn(): cannot send burn transaction, pays too little fee, " +
                "initialTxId: "+swap.txId+" initialTxFeeRate: "+initialTxFeeRate+" burnTxFeeRate: "+burnTxFeeRate);
            this.doubleSpentSwaps.set(swap.getHash(), null);
            await this.removeSwapData(swap, FromBtcTrustedSwapState.DOUBLE_SPENT);
            return;
        }

        //Construct PSBT
        const _psbt = new Psbt({network: this.config.bitcoinNetwork});
        _psbt.addInput({
            hash: initialTx.getHash(),
            index: swap.vout,
            witnessUtxo: ourOutput,
            sighashType: 0x01,
            sequence: 0xfffffffd
        });
        _psbt.addOutput({
            script: Buffer.concat([Buffer.from([0x6a, 20]), Buffer.from("BURN, BABY, BURN! AQ", "ascii")]),
            value: 0
        });

        //Sign
        const {psbt, transaction} = await signPsbt({
            lnd: this.LND,
            psbt: _psbt.toHex()
        });
        if(swap.metadata!=null) swap.metadata.times.burnSignPSBT = Date.now();
        this.swapLogger.debug(swap, "burn(): signed raw transaction: "+transaction);

        const signedTx = Transaction.fromHex(transaction);
        const burnTxId = signedTx.getId();
        swap.burnTxId = burnTxId;

        //Send the original TX + our burn TX as a package
        const sendTxns = [swap.rawTx, transaction];
        //TODO: We should handle this in a better way
        try {
            await this.bitcoinRpc.sendRawPackage(sendTxns);
            this.swapLogger.debug(swap, "burn(): sent burn transaction: "+burnTxId);
        } catch (e) {
            this.swapLogger.error(swap, "burn(): error sending burn package: ", e);
        }

        this.doubleSpentSwaps.set(swap.getHash(), burnTxId);
        await this.removeSwapData(swap, FromBtcTrustedSwapState.DOUBLE_SPENT);
    }

    protected async processPastSwap(swap: FromBtcTrustedSwap, tx: ChainTransaction | null): Promise<void> {
        let parsedTx: Transaction = null;
        let foundVout: TxOutput = null;
        let vout: number = -1;
        if(tx!=null) {
            parsedTx = Transaction.fromHex(tx.transaction);
            const requiredOutputScript = address.toOutputScript(swap.btcAddress, this.config.bitcoinNetwork);
            vout = parsedTx.outs.findIndex(vout => vout.script.equals(requiredOutputScript));
            if(vout!==-1) foundVout = parsedTx.outs[vout];
        }

        const {swapContract, signer} = this.getChain(swap.chainIdentifier);

        if(swap.state===FromBtcTrustedSwapState.CREATED) {
            this.subscriptions.set(swap.btcAddress, swap);
            if(foundVout==null) {
                //Check expiry
                if(swap.expiresAt<Date.now()) {
                    this.subscriptions.delete(swap.btcAddress);
                    await this.removeSwapData(swap, FromBtcTrustedSwapState.EXPIRED);
                    return;
                }
                return;
            }
            const sentSats = new BN(foundVout.value);
            if(sentSats.eq(swap.inputSats)) {
                swap.adjustedInput = swap.inputSats;
                swap.adjustedOutput = swap.outputTokens;
            } else {
                //If lower than minimum then ignore
                if(sentSats.lt(this.config.min)) return;
                if(sentSats.gt(this.config.max)) {
                    swap.adjustedInput = sentSats;
                    swap.rawTx = tx.transaction;
                    swap.txId = tx.id;
                    swap.vout = vout;
                    this.subscriptions.delete(swap.btcAddress);
                    await this.refundSwap(swap);
                    return;
                }
                //Adjust the amount
                swap.adjustedInput = sentSats;
                swap.adjustedOutput = swap.outputTokens.mul(sentSats).div(swap.inputSats);
            }
            swap.rawTx = tx.transaction;
            swap.txId = tx.id;
            swap.vout = vout;
            this.subscriptions.delete(swap.btcAddress);
            await swap.setState(FromBtcTrustedSwapState.RECEIVED);
            await this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
        }

        if(swap.state===FromBtcTrustedSwapState.RECEIVED) {
            //Check if transaction still exists
            if(tx==null || foundVout==null || tx.id!==swap.txId) {
                await swap.setState(FromBtcTrustedSwapState.CREATED);
                await this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
                return;
            }
            //Check if it is confirmed
            if(tx.confirmation_count>0) {
                await swap.setState(FromBtcTrustedSwapState.BTC_CONFIRMED);
                await this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
            } else {
                //Check if it pays high enough fee AND has confirmed ancestors
                const ancestors = await this.getAllAncestors(tx);
                const allAncestorsConfirmed = ancestors.reduce((prev, curr) => prev && curr.tx.confirmations>0, true);
                const totalInput = ancestors.reduce((prev, curr) => prev + curr.tx.outs[curr.vout].value, 0);
                const totalOutput = parsedTx.outs.reduce((prev, curr) => prev + curr.value, 0);
                const fee = totalInput-totalOutput;
                const feePerVbyte = Math.ceil(fee/parsedTx.virtualSize());
                if(
                    allAncestorsConfirmed &&
                    (feePerVbyte>=swap.recommendedFee || feePerVbyte>=await this.config.feeEstimator.estimateFee())
                ) {
                    if(swap.state!==FromBtcTrustedSwapState.RECEIVED) return;
                    swap.txSize = parsedTx.virtualSize();
                    swap.txFee = fee;
                    await swap.setState(FromBtcTrustedSwapState.BTC_CONFIRMED);
                    await this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
                } else {
                    return;
                }
            }
        }

        if(swap.state===FromBtcTrustedSwapState.REFUNDABLE) {
            if(swap.refundAddress!=null) {
                await this.refundSwap(swap);
                return;
            }
        }

        if(swap.doubleSpent || tx==null || foundVout==null || tx.id!==swap.txId) {
            if(swap.state===FromBtcTrustedSwapState.REFUNDABLE) {
                await swap.setState(FromBtcTrustedSwapState.CREATED);
                return;
            }
            if(!swap.doubleSpent) {
                swap.doubleSpent = true;
                try {
                    await this.burn(swap);
                    this.doubleSpendWatchdogSwaps.delete(swap);
                } catch (e) {
                    this.swapLogger.error(swap, "processPastSwap(): Error burning swap: ", e);
                    swap.doubleSpent = false;
                }
            }
            return;
        } else {
            if(!tx.is_confirmed && !this.doubleSpendWatchdogSwaps.has(swap)) {
                this.swapLogger.debug(swap, "processPastSwap(): Adding swap transaction to double spend watchdog list: ", swap.txId);
                this.doubleSpendWatchdogSwaps.add(swap);
            }
        }
        if(tx.confirmation_count > 0 && this.doubleSpendWatchdogSwaps.delete(swap)) {
            this.swapLogger.debug(swap, "processPastSwap(): Removing confirmed swap transaction from double spend watchdog list: ", swap.txId);
        }

        if(swap.state===FromBtcTrustedSwapState.BTC_CONFIRMED) {
            //Send gas token
            const balance: Promise<BN> = swapContract.getBalance(signer.getAddress(), swapContract.getNativeCurrencyAddress(), false);
            try {
                await this.checkBalance(swap.adjustedOutput, balance, null);
                if(swap.metadata!=null) swap.metadata.times.receivedBalanceChecked = Date.now();
            } catch (e) {
                this.swapLogger.error(swap, "processPastSwap(): Error not enough balance: ", e);
                await this.refundSwap(swap);
                return;
            }

            if(swap.state!==FromBtcTrustedSwapState.BTC_CONFIRMED) return;

            let unlock = swap.lock(30*1000);
            if(unlock==null) return;

            const txns = await swapContract.txsTransfer(signer.getAddress(), swapContract.getNativeCurrencyAddress(), swap.adjustedOutput, swap.dstAddress);
            await swapContract.sendAndConfirm(signer, txns, true, null, false, async (txId: string, rawTx: string) => {
                swap.txIds = {init: txId};
                swap.scRawTx = rawTx;
                if(swap.state===FromBtcTrustedSwapState.BTC_CONFIRMED) {
                    await swap.setState(FromBtcTrustedSwapState.SENT);
                    await this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
                }
                if(unlock!=null) unlock();
                unlock = null;
            });
        }

        if(swap.state===FromBtcTrustedSwapState.SENT) {
            const txStatus = await swapContract.getTxStatus(swap.scRawTx);
            switch(txStatus) {
                case "not_found":
                    //Retry
                    swap.txIds = {init: null};
                    swap.scRawTx = null;
                    await swap.setState(FromBtcTrustedSwapState.RECEIVED);
                    await this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
                    break;
                case "reverted":
                    //Cancel invoice
                    await this.refundSwap(swap);
                    this.swapLogger.info(swap, "processPastSwap(): transaction reverted, refunding btc on-chain: ", swap.btcAddress);
                    break;
                case "success":
                    await swap.setState(FromBtcTrustedSwapState.CONFIRMED);
                    await this.storageManager.saveData(swap.getHash(), swap.getSequence(), swap);
                    break;
            }
        }

        if(swap.state===FromBtcTrustedSwapState.CONFIRMED) {
            this.processedTxIds.set(swap.getHash(), {
                txId: swap.txIds.init,
                adjustedAmount: swap.adjustedInput,
                adjustedTotal: swap.adjustedOutput
            });
            if(tx.confirmation_count>0) await this.removeSwapData(swap, FromBtcTrustedSwapState.FINISHED);
        }
    }

    protected async processPastSwaps(): Promise<void> {
        const queriedData = await this.storageManager.query([
            {
                key: "state",
                value: [
                    FromBtcTrustedSwapState.REFUNDABLE,
                    FromBtcTrustedSwapState.CREATED,
                    FromBtcTrustedSwapState.RECEIVED,
                    FromBtcTrustedSwapState.BTC_CONFIRMED,
                    FromBtcTrustedSwapState.SENT,
                    FromBtcTrustedSwapState.CONFIRMED
                ]
            }
        ]);

        const startingBlockheight = queriedData.reduce((prev, swap) => Math.min(prev, swap.createdHeight), Infinity);
        if(startingBlockheight===Infinity) return;
        const {transactions} = await getChainTransactions({lnd: this.LND, after: startingBlockheight});

        for(let swap of queriedData) {
            const tx = transactions.find(tx => tx.output_addresses.includes(swap.btcAddress));
            try {
                await this.processPastSwap(swap, tx);
            } catch (e) {
                this.swapLogger.error(swap, "processPastSwaps(): Error ocurred while processing swap: ", e);
            }
        }
    }

    private isValidBitcoinAddress(address: string) {
        try {
            bitcoin.address.toOutputScript(address, this.config.bitcoinNetwork);
            return true;
        } catch (e) {}
        return false;
    }

    startRestServer(restServer: Express): void {

        const getAddress = expressHandlerWrapper(async (req: Request & {paramReader: IParamReader}, res: Response & {responseStream: ServerParamEncoder}) => {
            const metadata: {
                request: any,
                invoiceRequest?: any,
                invoiceResponse?: any,
                times: {[key: string]: number}
            } = {request: {}, times: {}};

            const chainIdentifier = req.query.chain as string ?? this.chains.default;
            const {swapContract, signer} = this.getChain(chainIdentifier);

            metadata.times.requestReceived = Date.now();
            /**
             * address: string              solana address of the recipient
             * refundAddress?: string       bitcoin address to use in case of refund
             * amount: string               amount (in lamports/smart chain base units) of the invoice
             * exactOut: boolean            whether to create and exact output swap
             */
            const parsedBody: FromBtcTrustedRequestType = await req.paramReader.getParams({
                address: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    swapContract.isValidAddress(val) ? val : null,
                amount: FieldTypeEnum.BN,
                exactOut: FieldTypeEnum.BooleanOptional
            });
            if(parsedBody==null) throw {
                code: 20100,
                msg: "Invalid request body"
            };
            metadata.request = parsedBody;

            const refundAddressData = req.paramReader.getExistingParamsOrNull({
                refundAddress: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    this.isValidBitcoinAddress(val) ? val : null
            });
            const refundAddress = refundAddressData?.refundAddress;

            const requestedAmount = {input: !parsedBody.exactOut, amount: parsedBody.amount};
            const request = {
                chainIdentifier,
                raw: req,
                parsed: parsedBody,
                metadata
            };
            const useToken = swapContract.getNativeCurrencyAddress();

            //Check request params
            const fees = await this.preCheckAmounts(request, requestedAmount, useToken);
            metadata.times.requestChecked = Date.now();

            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;
            const abortController = this.getAbortController(responseStream);

            //Pre-fetch data
            const {pricePrefetchPromise} = this.getFromBtcPricePrefetches(chainIdentifier, useToken, abortController);
            const balancePrefetch = swapContract.getBalance(signer.getAddress(), useToken, false).catch(e => {
                this.logger.error("getBalancePrefetch(): balancePrefetch error: ", e);
                abortController.abort(e);
                return null;
            });

            //Check valid amount specified (min/max)
            const {
                amountBD,
                swapFee,
                swapFeeInToken,
                totalInToken
            } = await this.checkFromBtcAmount(request, requestedAmount, fees, useToken, abortController.signal, pricePrefetchPromise);
            metadata.times.priceCalculated = Date.now();

            //Make sure we have MORE THAN ENOUGH to honor the swap request
            await this.checkBalance(totalInToken.mul(new BN(4)), balancePrefetch, abortController.signal)
            metadata.times.balanceChecked = Date.now();

            const {current_block_height} = await getHeight({lnd: this.LND});
            const feeRate = await this.config.feeEstimator.estimateFee();
            const recommendedFee = Math.ceil(feeRate*this.config.recommendFeeMultiplier);
            if(recommendedFee===0) throw {
                _httpStatus: 500,
                code: 21100,
                msg: "Cannot estimate bitcoin fee!"
            };
            metadata.times.feeEstimated = Date.now();

            const {address: receiveAddress} = await createChainAddress({
                lnd: this.LND,
                format: "p2wpkh"
            });
            abortController.signal.throwIfAborted();
            metadata.times.addressCreated = Date.now();

            const createdSwap = new FromBtcTrustedSwap(
                chainIdentifier,
                swapFee,
                swapFeeInToken,
                receiveAddress,
                amountBD,
                parsedBody.address,
                totalInToken,
                current_block_height,
                Date.now()+(this.config.swapAddressExpiry*1000),
                recommendedFee,
                refundAddress
            );
            metadata.times.swapCreated = Date.now();
            createdSwap.metadata = metadata;

            await PluginManager.swapCreate(createdSwap);
            await this.storageManager.saveData(createdSwap.getHash(), createdSwap.getSequence(), createdSwap);
            this.subscriptions.set(createdSwap.btcAddress, createdSwap);

            this.swapLogger.info(createdSwap, "REST: /getAddress: Created swap address: "+createdSwap.btcAddress+" amount: "+amountBD.toString(10));

            await responseStream.writeParamsAndEnd({
                msg: "Success",
                code: 10000,
                data: {
                    paymentHash: createdSwap.getHash(),
                    sequence: createdSwap.getSequence().toString(10),
                    btcAddress: receiveAddress,
                    amountSats: amountBD.toString(10),
                    swapFeeSats: swapFee.toString(10),
                    swapFee: swapFeeInToken.toString(10),
                    total: totalInToken.toString(10),
                    intermediaryKey: signer.getAddress(),
                    recommendedFee,
                    expiresAt: createdSwap.expiresAt
                }
            });
        });
        restServer.use(this.path+"/getAddress", serverParamDecoder(10*1000));
        restServer.post(this.path+"/getAddress", getAddress);

        const getInvoiceStatus = expressHandlerWrapper(async (req, res) => {
            /**
             * paymentHash: string          payment hash of the invoice
             */
            const parsedBody = verifySchema(req.query, {
                paymentHash: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    val.length===64 &&
                    HEX_REGEX.test(val) ? val: null,
            });
            if(parsedBody==null) throw {
                code: 20100,
                msg: "Invalid request"
            };

            const processedTxData = this.processedTxIds.get(parsedBody.paymentHash);
            if(processedTxData!=null) throw {
                _httpStatus: 200,
                code: 10000,
                msg: "Success, tx confirmed",
                data: processedTxData
            };

            const refundTxId = this.refundedSwaps.get(parsedBody.paymentHash);
            if(refundTxId!=null) throw {
                _httpStatus: 200,
                code: 10014,
                msg: "Refunded",
                data: {
                    txId: refundTxId
                }
            };

            const doubleSpendTxId = this.doubleSpentSwaps.get(parsedBody.paymentHash);
            if(doubleSpendTxId!=null) throw {
                _httpStatus: 200,
                code: 10015,
                msg: "Double spend detected, deposit burned",
                data: {
                    txId: doubleSpendTxId
                }
            };

            const invoiceData: FromBtcTrustedSwap = await this.storageManager.getData(parsedBody.paymentHash, null);
            if (invoiceData==null) throw {
                _httpStatus: 200,
                code: 10001,
                msg: "Swap expired/canceled"
            };

            if (invoiceData.state === FromBtcTrustedSwapState.CREATED) throw {
                _httpStatus: 200,
                code: 10010,
                msg: "Bitcoin yet unpaid"
            };

            if (invoiceData.state === FromBtcTrustedSwapState.RECEIVED) throw {
                _httpStatus: 200,
                code: 10011,
                msg: "Bitcoin received, payment processing",
                data: {
                    adjustedAmount: invoiceData.adjustedInput.toString(10),
                    adjustedTotal: invoiceData.adjustedOutput.toString(10)
                }
            };

            if (invoiceData.state === FromBtcTrustedSwapState.BTC_CONFIRMED) throw {
                _httpStatus: 200,
                code: 10013,
                msg: "Bitcoin accepted, payment processing",
                data: {
                    adjustedAmount: invoiceData.adjustedInput.toString(10),
                    adjustedTotal: invoiceData.adjustedOutput.toString(10)
                }
            };

            if (invoiceData.state === FromBtcTrustedSwapState.SENT) throw {
                _httpStatus: 200,
                code: 10012,
                msg: "Tx sent",
                data: {
                    adjustedAmount: invoiceData.adjustedInput.toString(10),
                    adjustedTotal: invoiceData.adjustedOutput.toString(10),
                    txId: invoiceData.txIds.init
                }
            };

            if (invoiceData.state === FromBtcTrustedSwapState.CONFIRMED || invoiceData.state === FromBtcTrustedSwapState.FINISHED) throw {
                _httpStatus: 200,
                code: 10000,
                msg: "Success, tx confirmed",
                data: {
                    adjustedAmount: invoiceData.adjustedInput.toString(10),
                    adjustedTotal: invoiceData.adjustedOutput.toString(10),
                    txId: invoiceData.txIds.init
                }
            };

            if (invoiceData.state === FromBtcTrustedSwapState.REFUNDABLE) throw {
                _httpStatus: 200,
                code: 10015,
                msg: "Refundable",
                data: {
                    adjustedAmount: invoiceData.adjustedInput.toString(10)
                }
            };
        });
        restServer.get(this.path+"/getAddressStatus", getInvoiceStatus);

        const setRefundAddress = expressHandlerWrapper(async (req, res) => {
            /**
             * paymentHash: string          payment hash of the invoice
             * sequence: BN                 secret sequence for the swap,
             * refundAddress: string        valid bitcoin address to be used for refunds
             */
            const parsedBody = verifySchema({...req.body, ...req.query}, {
                paymentHash: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    val.length===64 &&
                    HEX_REGEX.test(val) ? val: null,
                sequence: FieldTypeEnum.BN,
                refundAddress: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    this.isValidBitcoinAddress(val) ? val : null
            });
            if(parsedBody==null) throw {
                code: 20100,
                msg: "Invalid request"
            };

            const invoiceData: FromBtcTrustedSwap = await this.storageManager.getData(parsedBody.paymentHash, null);
            if (invoiceData==null || !invoiceData.getSequence().eq(parsedBody.sequence)) throw {
                code: 10001,
                msg: "Swap not found"
            };

            if(invoiceData.refundAddress!=null) throw {
                code: 10080,
                msg: "Refund address already set!",
                data: {
                    refundAddress: invoiceData.refundAddress
                }
            };

            invoiceData.refundAddress = parsedBody.refundAddress;

            if (invoiceData.state === FromBtcTrustedSwapState.REFUNDABLE) {
                this.refundSwap(invoiceData).catch(e => {
                    this.swapLogger.error(invoiceData, "/setRefundAddress: Failed to refund!");
                });
            }

            throw {
                _httpStatus: 200,
                code: 10000,
                msg: "Refund address set"
            };
        });
        restServer.get(this.path+"/setRefundAddress", setRefundAddress);
        restServer.post(this.path+"/setRefundAddress", setRefundAddress);

        this.logger.info("started at path: ", this.path);
    }

    private async checkDoubleSpends(): Promise<void> {
        for(let swap of this.doubleSpendWatchdogSwaps.keys()) {
            const tx = await this.bitcoinRpc.getTransaction(swap.txId);
            if(tx==null) {
                this.swapLogger.debug(swap, "checkDoubleSpends(): Swap was double spent, burning... - original txId: "+swap.txId);
                this.processPastSwap(swap, null);
            }
        }
    }

    private async startDoubleSpendWatchdog() {
        let rerun: () => Promise<void>;
        rerun = async () => {
            await this.checkDoubleSpends().catch( e => console.error(e));
            setTimeout(rerun, this.config.doubleSpendCheckInterval);
        };
        await rerun();
    }

    private listenToTxns() {
        const res = subscribeToTransactions({lnd: this.LND});
        res.on("chain_transaction", (tx: SubscribeToTransactionsChainTransactionEvent) => {
            for(let address of tx.output_addresses) {
                const savedSwap = this.subscriptions.get(address);
                if(savedSwap==null) continue;
                this.processPastSwap(savedSwap, tx);
                return;
            }
        });
    }

    async startWatchdog() {
        await super.startWatchdog();
        await this.startDoubleSpendWatchdog();
    }

    async init(): Promise<void> {
        await this.storageManager.loadData(FromBtcTrustedSwap);
        this.listenToTxns();
        await PluginManager.serviceInitialize(this);
    }

    getInfoData(): any {
        return {};
    }

    protected processClaimEvent(chainIdentifier: string, event: ClaimEvent<SwapData>): Promise<void> {
        return Promise.resolve(undefined);
    }

    protected processInitializeEvent(chainIdentifier: string, event: InitializeEvent<SwapData>): Promise<void> {
        return Promise.resolve(undefined);
    }

    protected processRefundEvent(chainIdentifier: string, event: RefundEvent<SwapData>): Promise<void> {
        return Promise.resolve(undefined);
    }

}