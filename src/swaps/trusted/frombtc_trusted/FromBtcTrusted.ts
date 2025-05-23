import {FromBtcTrustedSwap, FromBtcTrustedSwapState} from "./FromBtcTrustedSwap";
import {BitcoinRpc, BtcBlock, BtcTx, BtcVout} from "@atomiqlabs/base";
import {Express, Request, Response} from "express";
import {MultichainData, SwapBaseConfig, SwapHandler, SwapHandlerType} from "../../SwapHandler";
import {IIntermediaryStorage} from "../../../storage/IIntermediaryStorage";
import {ISwapPrice} from "../../../prices/ISwapPrice";
import {PluginManager} from "../../../plugins/PluginManager";
import {expressHandlerWrapper, getAbortController, HEX_REGEX} from "../../../utils/Utils";
import {IParamReader} from "../../../utils/paramcoders/IParamReader";
import {ServerParamEncoder} from "../../../utils/paramcoders/server/ServerParamEncoder";
import {FieldTypeEnum, verifySchema} from "../../../utils/paramcoders/SchemaVerifier";
import {IBitcoinWallet} from "../../../wallets/IBitcoinWallet";
import {FromBtcAmountAssertions} from "../../assertions/FromBtcAmountAssertions";

export type FromBtcTrustedConfig = SwapBaseConfig & {
    doubleSpendCheckInterval: number,
    swapAddressExpiry: number,
    recommendFeeMultiplier?: number
}

export type FromBtcTrustedRequestType = {
    address: string,
    amount: bigint,
    exactIn?: boolean,
    refundAddress?: string,
    token?: string
};

export class FromBtcTrusted extends SwapHandler<FromBtcTrustedSwap, FromBtcTrustedSwapState> {
    readonly type = SwapHandlerType.FROM_BTC_TRUSTED;

    readonly config: FromBtcTrustedConfig;
    readonly bitcoin: IBitcoinWallet;
    readonly bitcoinRpc: BitcoinRpc<BtcBlock>;

    readonly subscriptions: Map<string, FromBtcTrustedSwap> = new Map<string, FromBtcTrustedSwap>();
    readonly doubleSpendWatchdogSwaps: Set<FromBtcTrustedSwap> = new Set<FromBtcTrustedSwap>();

    readonly refundedSwaps: Map<string, string> = new Map();
    readonly doubleSpentSwaps: Map<string, string> = new Map();
    readonly processedTxIds: Map<string, { scTxId: string, txId: string, adjustedAmount: bigint, adjustedTotal: bigint }> = new Map();

    readonly AmountAssertions: FromBtcAmountAssertions;

    constructor(
        storageDirectory: IIntermediaryStorage<FromBtcTrustedSwap>,
        path: string,
        chains: MultichainData,
        bitcoin: IBitcoinWallet,
        swapPricing: ISwapPrice,
        bitcoinRpc: BitcoinRpc<BtcBlock>,
        config: FromBtcTrustedConfig
    ) {
        super(storageDirectory, path, chains, swapPricing);
        this.AmountAssertions = new FromBtcAmountAssertions(config, swapPricing);
        this.config = config;
        this.config.recommendFeeMultiplier ??= 1.25;
        this.bitcoin = bitcoin;
        this.bitcoinRpc = bitcoinRpc;
    }

    private getAllAncestors(tx: BtcTx): Promise<{tx: BtcTx, vout: number}[]> {
        return Promise.all(tx.ins.map(input => this.bitcoinRpc.getTransaction(input.txid).then(tx => {
            return {tx, vout: input.vout}
        })));
    }

    private async refundSwap(swap: FromBtcTrustedSwap) {
        if(swap.refundAddress==null) {
            if(swap.state!==FromBtcTrustedSwapState.REFUNDABLE) {
                await swap.setState(FromBtcTrustedSwapState.REFUNDABLE);
                await this.storageManager.saveData(swap.getIdentifierHash(), swap.getSequence(), swap);
            }
            return;
        }

        let unlock = swap.lock(30*1000);
        if(unlock==null) return;

        const feeRate = await this.bitcoin.getFeeRate();

        const ourOutput = swap.btcTx.outs[swap.vout];

        const resp = await this.bitcoin.drainAll(swap.refundAddress, [{
            type: this.bitcoin.getAddressType(),
            confirmations: swap.btcTx.confirmations,
            outputScript: Buffer.from(ourOutput.scriptPubKey.hex, "hex"),
            value: ourOutput.value,
            txId: swap.btcTx.txid,
            vout: swap.vout
        }], feeRate);

        if(resp==null) {
            this.swapLogger.error(swap, "refundSwap(): cannot refund swap because of dust limit, txId: "+swap.txId);
            unlock();
            return;
        }

        if(swap.metadata!=null) swap.metadata.times.refundSignPSBT = Date.now();
        this.swapLogger.debug(swap, "refundSwap(): signed raw transaction: "+resp.raw);

        const refundTxId = resp.txId;
        swap.refundTxId = refundTxId;

        //Send the refund TX
        await this.bitcoin.sendRawTransaction(resp.raw);
        this.swapLogger.debug(swap, "refundSwap(): sent refund transaction: "+refundTxId);

        this.refundedSwaps.set(swap.getIdentifierHash(), refundTxId);
        await this.removeSwapData(swap, FromBtcTrustedSwapState.REFUNDED);
        unlock();
    }

    private async burn(swap: FromBtcTrustedSwap) {
        const ourOutput = swap.btcTx.outs[swap.vout];

        //Check if we can even increase the feeRate by burning
        const txSize = 110;
        const burnTxFeeRate = Math.floor(ourOutput.value/txSize);
        const initialTxFeeRate = Math.ceil(swap.txFee/swap.txSize);

        if(burnTxFeeRate<initialTxFeeRate) {
            this.swapLogger.warn(swap, "burn(): cannot send burn transaction, pays too little fee, " +
                "initialTxId: "+swap.txId+" initialTxFeeRate: "+initialTxFeeRate+" burnTxFeeRate: "+burnTxFeeRate);
            this.doubleSpentSwaps.set(swap.getIdentifierHash(), null);
            await this.removeSwapData(swap, FromBtcTrustedSwapState.DOUBLE_SPENT);
            return;
        }

        //Construct PSBT
        const resp = await this.bitcoin.burnAll([{
            type: this.bitcoin.getAddressType(),
            confirmations: swap.btcTx.confirmations,
            outputScript: Buffer.from(ourOutput.scriptPubKey.hex, "hex"),
            value: ourOutput.value,
            txId: swap.btcTx.txid,
            vout: swap.vout
        }]);
        if(swap.metadata!=null) swap.metadata.times.burnSignPSBT = Date.now();
        this.swapLogger.debug(swap, "burn(): signed raw transaction: "+resp.raw);

        const burnTxId = resp.txId;
        swap.burnTxId = burnTxId;

        //Send the original TX + our burn TX as a package
        const sendTxns = [swap.btcTx.raw, resp.raw];
        //TODO: We should handle this in a better way
        try {
            await this.bitcoinRpc.sendRawPackage(sendTxns);
            this.swapLogger.debug(swap, "burn(): sent burn transaction: "+burnTxId);
        } catch (e) {
            this.swapLogger.error(swap, "burn(): error sending burn package: ", e);
        }

        this.doubleSpentSwaps.set(swap.getIdentifierHash(), burnTxId);
        await this.removeSwapData(swap, FromBtcTrustedSwapState.DOUBLE_SPENT);
    }

    protected async processPastSwap(swap: FromBtcTrustedSwap, tx: BtcTx | null, vout: number | null): Promise<void> {
        const foundVout: BtcVout = tx.outs[vout];

        const {chainInterface, signer} = this.getChain(swap.chainIdentifier);

        const outputScript = this.bitcoin.toOutputScript(swap.btcAddress).toString("hex");

        if(swap.state===FromBtcTrustedSwapState.CREATED) {
            this.subscriptions.set(outputScript, swap);
            if(foundVout==null) {
                //Check expiry
                if(swap.expiresAt<Date.now()) {
                    this.subscriptions.delete(outputScript);
                    await this.bitcoin.addUnusedAddress(swap.btcAddress);
                    await this.removeSwapData(swap, FromBtcTrustedSwapState.EXPIRED);
                    return;
                }
                return;
            }
            const sentSats = BigInt(foundVout.value);
            if(sentSats === swap.amount) {
                swap.adjustedInput = swap.amount;
                swap.adjustedOutput = swap.outputTokens;
            } else {
                //If lower than minimum then ignore
                if(sentSats < this.config.min) return;
                if(sentSats > this.config.max) {
                    swap.adjustedInput = sentSats;
                    swap.btcTx = tx;
                    swap.txId = tx.txid;
                    swap.vout = vout;
                    this.subscriptions.delete(outputScript);
                    await this.refundSwap(swap);
                    return;
                }
                //Adjust the amount
                swap.adjustedInput = sentSats;
                swap.adjustedOutput = swap.outputTokens * sentSats / swap.amount;
            }
            swap.btcTx = tx;
            swap.txId = tx.txid;
            swap.vout = vout;
            this.subscriptions.delete(outputScript);
            await swap.setState(FromBtcTrustedSwapState.RECEIVED);
            await this.storageManager.saveData(swap.getIdentifierHash(), swap.getSequence(), swap);
        }

        if(swap.state===FromBtcTrustedSwapState.RECEIVED) {
            //Check if transaction still exists
            if(tx==null || foundVout==null || tx.txid!==swap.txId) {
                await swap.setState(FromBtcTrustedSwapState.CREATED);
                await this.storageManager.saveData(swap.getIdentifierHash(), swap.getSequence(), swap);
                return;
            }
            //Check if it is confirmed
            if(tx.confirmations>0) {
                await swap.setState(FromBtcTrustedSwapState.BTC_CONFIRMED);
                await this.storageManager.saveData(swap.getIdentifierHash(), swap.getSequence(), swap);
            } else {
                //Check if it pays high enough fee AND has confirmed ancestors
                const ancestors = await this.getAllAncestors(tx);
                const allAncestorsConfirmed = ancestors.reduce((prev, curr) => prev && curr.tx.confirmations>0, true);
                const totalInput = ancestors.reduce((prev, curr) => prev + curr.tx.outs[curr.vout].value, 0);
                const totalOutput = tx.outs.reduce((prev, curr) => prev + curr.value, 0);
                const fee = totalInput-totalOutput;
                const feePerVbyte = Math.ceil(fee/tx.vsize);
                if(
                    allAncestorsConfirmed &&
                    (feePerVbyte>=swap.recommendedFee || feePerVbyte>=await this.bitcoin.getFeeRate())
                ) {
                    if(swap.state!==FromBtcTrustedSwapState.RECEIVED) return;
                    swap.txSize = tx.vsize;
                    swap.txFee = fee;
                    await swap.setState(FromBtcTrustedSwapState.BTC_CONFIRMED);
                    await this.storageManager.saveData(swap.getIdentifierHash(), swap.getSequence(), swap);
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

        if(swap.doubleSpent || tx==null || foundVout==null || tx.txid!==swap.txId) {
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
            if(tx.confirmations<=0 && !this.doubleSpendWatchdogSwaps.has(swap)) {
                this.swapLogger.debug(swap, "processPastSwap(): Adding swap transaction to double spend watchdog list: ", swap.txId);
                this.doubleSpendWatchdogSwaps.add(swap);
            }
        }
        if(tx.confirmations>0 && this.doubleSpendWatchdogSwaps.delete(swap)) {
            this.swapLogger.debug(swap, "processPastSwap(): Removing confirmed swap transaction from double spend watchdog list: ", swap.txId);
        }

        if(swap.state===FromBtcTrustedSwapState.BTC_CONFIRMED) {
            //Send gas token
            const balance: Promise<bigint> = chainInterface.getBalance(signer.getAddress(), swap.token);
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

            const txns = await chainInterface.txsTransfer(signer.getAddress(), swap.token, swap.adjustedOutput, swap.dstAddress);
            await chainInterface.sendAndConfirm(signer, txns, true, null, false, async (txId: string, rawTx: string) => {
                swap.txIds = {init: txId};
                swap.scRawTx = rawTx;
                if(swap.state===FromBtcTrustedSwapState.BTC_CONFIRMED) {
                    await swap.setState(FromBtcTrustedSwapState.SENT);
                    await this.storageManager.saveData(swap.getIdentifierHash(), swap.getSequence(), swap);
                }
                if(unlock!=null) unlock();
                unlock = null;
            });
        }

        if(swap.state===FromBtcTrustedSwapState.SENT) {
            const txStatus = await chainInterface.getTxStatus(swap.scRawTx);
            switch(txStatus) {
                case "not_found":
                    //Retry
                    swap.txIds = {init: null};
                    swap.scRawTx = null;
                    await swap.setState(FromBtcTrustedSwapState.RECEIVED);
                    await this.storageManager.saveData(swap.getIdentifierHash(), swap.getSequence(), swap);
                    break;
                case "reverted":
                    //Cancel invoice
                    await this.refundSwap(swap);
                    this.swapLogger.info(swap, "processPastSwap(): transaction reverted, refunding btc on-chain: ", swap.btcAddress);
                    break;
                case "success":
                    await swap.setState(FromBtcTrustedSwapState.CONFIRMED);
                    await this.storageManager.saveData(swap.getIdentifierHash(), swap.getSequence(), swap);
                    break;
            }
        }

        if(swap.state===FromBtcTrustedSwapState.CONFIRMED) {
            this.processedTxIds.set(swap.getIdentifierHash(), {
                txId: swap.txId,
                scTxId: swap.txIds.init,
                adjustedAmount: swap.adjustedInput,
                adjustedTotal: swap.adjustedOutput
            });
            if(tx.confirmations>0) await this.removeSwapData(swap, FromBtcTrustedSwapState.FINISHED);
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

        const startingBlockheight = queriedData.reduce((prev, {obj: swap}) => Math.min(prev, swap.createdHeight), Infinity);
        if(startingBlockheight===Infinity) return;
        const transactions = await this.bitcoin.getWalletTransactions(startingBlockheight);

        const map = new Map<string, {tx: BtcTx, vout: number}[]>();
        transactions.forEach(tx => {
            tx.outs.forEach((out, vout) => {
                const existing = map.get(out.scriptPubKey.hex);
                if(existing==null) {
                    map.set(out.scriptPubKey.hex, [{tx, vout}]);
                } else {
                    existing.push({tx, vout});
                }
            })
        });

        for(let {obj: swap} of queriedData) {
            const outputScript = this.bitcoin.toOutputScript(swap.btcAddress).toString("hex");
            const txs = map.get(outputScript) ?? [];
            try {
                await this.processPastSwap(swap, txs[0]?.tx, txs[0]?.vout);
            } catch (e) {
                this.swapLogger.error(swap, "processPastSwaps(): Error ocurred while processing swap: ", e);
            }
        }
    }

    private isValidBitcoinAddress(address: string) {
        try {
            this.bitcoin.toOutputScript(address);
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
            const {chainInterface, signer} = this.getChain(chainIdentifier);

            metadata.times.requestReceived = Date.now();
            /**
             * address: string              solana address of the recipient
             * refundAddress?: string       bitcoin address to use in case of refund
             * amount: string               amount (in lamports/smart chain base units) of the invoice
             * exactOut: boolean            whether to create and exact output swap
             */
            req.query.token ??= chainInterface.getNativeCurrencyAddress();
            const parsedBody: FromBtcTrustedRequestType = verifySchema(req.query,{
                address: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    chainInterface.isValidAddress(val) ? val : null,
                refundAddress: (val: string) => val==null ? "" :
                    typeof(val)==="string" &&
                    this.isValidBitcoinAddress(val) ? val : null,
                token: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    this.isTokenSupported(chainIdentifier, val) ? val : null,
                amount: FieldTypeEnum.BigInt,
                exactIn: (val: string) => val==="true" ? true :
                    (val==="false" || val===undefined) ? false : null
            });
            if(parsedBody==null) throw {
                code: 20100,
                msg: "Invalid request body"
            };
            metadata.request = parsedBody;

            const refundAddress = parsedBody.refundAddress==="" ? null : parsedBody.refundAddress;

            const requestedAmount = {input: parsedBody.exactIn, amount: parsedBody.amount, token: parsedBody.token};
            const request = {
                chainIdentifier,
                raw: req,
                parsed: parsedBody,
                metadata
            };
            const useToken = parsedBody.token;

            //Check request params
            const fees = await this.AmountAssertions.preCheckFromBtcAmounts(this.type, request, requestedAmount);
            metadata.times.requestChecked = Date.now();

            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;
            const abortController = getAbortController(responseStream);

            //Pre-fetch data
            const pricePrefetchPromise = this.swapPricing.preFetchPrice(useToken, chainIdentifier).catch(e => {
                this.logger.error("pricePrefetchPromise(): pricePrefetch error: ", e);
                abortController.abort(e);
                return null;
            });
            const balancePrefetch = chainInterface.getBalance(signer.getAddress(), useToken).catch(e => {
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
            } = await this.AmountAssertions.checkFromBtcAmount(this.type, request, {...requestedAmount, pricePrefetch: pricePrefetchPromise}, fees, abortController.signal);
            metadata.times.priceCalculated = Date.now();

            //Make sure we have MORE THAN ENOUGH to honor the swap request
            await this.checkBalance(totalInToken * 4n, balancePrefetch, abortController.signal)
            metadata.times.balanceChecked = Date.now();

            const blockHeight = await this.bitcoin.getBlockheight();
            const feeRate = await this.bitcoin.getFeeRate();
            const recommendedFee = Math.ceil(feeRate*this.config.recommendFeeMultiplier);
            if(recommendedFee===0) throw {
                _httpStatus: 500,
                code: 21100,
                msg: "Cannot estimate bitcoin fee!"
            };
            metadata.times.feeEstimated = Date.now();

            const receiveAddress = await this.bitcoin.getAddress();
            const outputScript = this.bitcoin.toOutputScript(receiveAddress).toString("hex");
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
                blockHeight,
                Date.now()+(this.config.swapAddressExpiry*1000),
                recommendedFee,
                refundAddress,
                useToken
            );
            metadata.times.swapCreated = Date.now();
            createdSwap.metadata = metadata;

            await PluginManager.swapCreate(createdSwap);
            await this.storageManager.saveData(createdSwap.getIdentifierHash(), createdSwap.getSequence(), createdSwap);
            this.subscriptions.set(outputScript, createdSwap);

            this.swapLogger.info(createdSwap, "REST: /getAddress: Created swap address: "+createdSwap.btcAddress+" amount: "+amountBD.toString(10));

            res.status(200).json({
                code: 10000,
                msg: "Success",
                data: {
                    paymentHash: createdSwap.getIdentifierHash(),
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
        restServer.get(this.path+"/getAddress", getAddress);

        const getInvoiceStatus = expressHandlerWrapper(async (req, res) => {
            /**
             * paymentHash: string          payment hash of the invoice
             * sequence: BN                 secret sequence for the swap,
             */
            const parsedBody = verifySchema(req.query, {
                paymentHash: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    val.length===64 &&
                    HEX_REGEX.test(val) ? val: null,
                sequence: FieldTypeEnum.BigInt,
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
                data: {
                    adjustedAmount: processedTxData.adjustedAmount.toString(10),
                    adjustedTotal: processedTxData.adjustedTotal.toString(10),
                    txId: processedTxData.txId,
                    scTxId: processedTxData.scTxId
                }
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

            const invoiceData: FromBtcTrustedSwap = await this.storageManager.getData(parsedBody.paymentHash, parsedBody.sequence);
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
                    adjustedTotal: invoiceData.adjustedOutput.toString(10),
                    txId: invoiceData.txId
                }
            };

            if (invoiceData.state === FromBtcTrustedSwapState.BTC_CONFIRMED) throw {
                _httpStatus: 200,
                code: 10013,
                msg: "Bitcoin accepted, payment processing",
                data: {
                    adjustedAmount: invoiceData.adjustedInput.toString(10),
                    adjustedTotal: invoiceData.adjustedOutput.toString(10),
                    txId: invoiceData.txId
                }
            };

            if (invoiceData.state === FromBtcTrustedSwapState.SENT) throw {
                _httpStatus: 200,
                code: 10012,
                msg: "Tx sent",
                data: {
                    adjustedAmount: invoiceData.adjustedInput.toString(10),
                    adjustedTotal: invoiceData.adjustedOutput.toString(10),
                    txId: invoiceData.txId,
                    scTxId: invoiceData.txIds.init
                }
            };

            if (invoiceData.state === FromBtcTrustedSwapState.CONFIRMED || invoiceData.state === FromBtcTrustedSwapState.FINISHED) throw {
                _httpStatus: 200,
                code: 10000,
                msg: "Success, tx confirmed",
                data: {
                    adjustedAmount: invoiceData.adjustedInput.toString(10),
                    adjustedTotal: invoiceData.adjustedOutput.toString(10),
                    txId: invoiceData.txId,
                    scTxId: invoiceData.txIds.init
                }
            };

            if (invoiceData.state === FromBtcTrustedSwapState.REFUNDABLE) throw {
                _httpStatus: 200,
                code: 10016,
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
                sequence: FieldTypeEnum.BigInt,
                refundAddress: (val: string) => val!=null &&
                    typeof(val)==="string" &&
                    this.isValidBitcoinAddress(val) ? val : null
            });
            if(parsedBody==null) throw {
                code: 20100,
                msg: "Invalid request"
            };

            const invoiceData: FromBtcTrustedSwap = await this.storageManager.getData(parsedBody.paymentHash, null);
            if (invoiceData==null || invoiceData.getSequence()!==parsedBody.sequence) throw {
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
            const tx = await this.bitcoin.getWalletTransaction(swap.txId);
            if(tx==null) {
                this.swapLogger.debug(swap, "checkDoubleSpends(): Swap was double spent, burning... - original txId: "+swap.txId);
                this.processPastSwap(swap, null, null);
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
        this.bitcoin.subscribeToWalletTransactions((btcTx: BtcTx) => {
            for(let out of btcTx.outs) {
                const savedSwap = this.subscriptions.get(out.scriptPubKey.hex);
                if(savedSwap==null) continue;
                this.processPastSwap(savedSwap, btcTx, out.n);
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

}