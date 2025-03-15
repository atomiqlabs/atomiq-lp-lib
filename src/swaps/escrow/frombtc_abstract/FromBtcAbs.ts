import {Express, Request, Response} from "express";
import {FromBtcSwapAbs, FromBtcSwapState} from "./FromBtcSwapAbs";
import {MultichainData, SwapHandlerType} from "../../SwapHandler";
import {ISwapPrice} from "../../../prices/ISwapPrice";
import {
    BigIntBufferUtils,
    ChainSwapType,
    ClaimEvent,
    InitializeEvent,
    RefundEvent,
    SwapData
} from "@atomiqlabs/base";
import {randomBytes} from "crypto";
import {expressHandlerWrapper, getAbortController} from "../../../utils/Utils";
import {PluginManager} from "../../../plugins/PluginManager";
import {IIntermediaryStorage} from "../../../storage/IIntermediaryStorage";
import {FieldTypeEnum} from "../../../utils/paramcoders/SchemaVerifier";
import {serverParamDecoder} from "../../../utils/paramcoders/server/ServerParamDecoder";
import {IParamReader} from "../../../utils/paramcoders/IParamReader";
import {ServerParamEncoder} from "../../../utils/paramcoders/server/ServerParamEncoder";
import {FromBtcBaseConfig, FromBtcBaseSwapHandler} from "../FromBtcBaseSwapHandler";
import {IBitcoinWallet} from "../../../wallets/IBitcoinWallet";

export type FromBtcConfig = FromBtcBaseConfig & {
    confirmations: number,
    swapCsvDelta: number
};

export type FromBtcRequestType = {
    address: string,
    amount: bigint,
    token: string,
    sequence: bigint,
    exactOut?: boolean
};

/**
 * Swap handler handling from BTC swaps using PTLCs (proof-time locked contracts) and btc relay (on-chain bitcoin SPV)
 */
export class FromBtcAbs extends FromBtcBaseSwapHandler<FromBtcSwapAbs, FromBtcSwapState> {
    readonly type = SwapHandlerType.FROM_BTC;
    readonly swapType = ChainSwapType.CHAIN;

    readonly config: FromBtcConfig & {swapTsCsvDelta: bigint};

    readonly bitcoin: IBitcoinWallet;

    constructor(
        storageDirectory: IIntermediaryStorage<FromBtcSwapAbs>,
        path: string,
        chains: MultichainData,
        bitcoin: IBitcoinWallet,
        swapPricing: ISwapPrice,
        config: FromBtcConfig
    ) {
        super(storageDirectory, path, chains, swapPricing, config);
        this.bitcoin = bitcoin;
        this.config = {
            ...config,
            swapTsCsvDelta: BigInt(config.swapCsvDelta) * (config.bitcoinBlocktime / config.safetyFactor)
        };
    }

    /**
     * Returns the payment hash of the swap, takes swap nonce into account. Payment hash is chain-specific.
     *
     * @param chainIdentifier
     * @param address
     * @param amount
     */
    private getHash(chainIdentifier: string, address: string, amount: bigint): Buffer {
        const parsedOutputScript = this.bitcoin.toOutputScript(address);
        const {swapContract} = this.getChain(chainIdentifier);
        return swapContract.getHashForOnchain(parsedOutputScript, amount, this.config.confirmations, 0n);
    }

    /**
     * Processes past swap
     *
     * @param swap
     * @protected
     * @returns true if the swap should be refunded, false if nothing should be done
     */
    protected async processPastSwap(swap: FromBtcSwapAbs): Promise<boolean> {
        const {swapContract, signer} = this.getChain(swap.chainIdentifier);

        //Once authorization expires in CREATED state, the user can no more commit it on-chain
        if(swap.state===FromBtcSwapState.CREATED) {
            if(!await swapContract.isInitAuthorizationExpired(swap.data, swap)) return false;

            const isCommited = await swapContract.isCommited(swap.data);
            if(isCommited) {
                this.swapLogger.info(swap, "processPastSwap(state=CREATED): swap was commited, but processed from watchdog, address: "+swap.address);
                await swap.setState(FromBtcSwapState.COMMITED);
                await this.saveSwapData(swap);
                return false;
            }

            this.swapLogger.info(swap, "processPastSwap(state=CREATED): removing past swap due to authorization expiry, address: "+swap.address);
            await this.bitcoin.addUnusedAddress(swap.address);
            await this.removeSwapData(swap, FromBtcSwapState.CANCELED);
            return false;
        }

        //Check if commited swap expired by now
        if(swap.state===FromBtcSwapState.COMMITED) {
            if(!await swapContract.isExpired(signer.getAddress(), swap.data)) return false;

            const isCommited = await swapContract.isCommited(swap.data);
            if(isCommited) {
                this.swapLogger.info(swap, "processPastSwap(state=COMMITED): swap expired, will refund, address: "+swap.address);
                return true;
            }

            this.swapLogger.warn(swap, "processPastSwap(state=COMMITED): commited swap expired and not committed anymore (already refunded?), address: "+swap.address);
            await this.removeSwapData(swap, FromBtcSwapState.CANCELED);
            return false;
        }
    }

    /**
     * Checks past swaps, refunds and deletes ones that are already expired.
     */
    protected async processPastSwaps() {

        const queriedData = await this.storageManager.query([
            {
                key: "state",
                value: [
                    FromBtcSwapState.CREATED,
                    FromBtcSwapState.COMMITED
                ]
            }
        ]);

        const refundSwaps: FromBtcSwapAbs[] = [];

        for(let {obj: swap} of queriedData) {
            if(await this.processPastSwap(swap)) refundSwaps.push(swap);
        }

        await this.refundSwaps(refundSwaps);
    }

    /**
     * Refunds all swaps (calls SC on-chain refund function)
     *
     * @param refundSwaps
     * @protected
     */
    protected async refundSwaps(refundSwaps: FromBtcSwapAbs[]) {
        for(let refundSwap of refundSwaps) {
            const {swapContract, signer} = this.getChain(refundSwap.chainIdentifier);
            const unlock = refundSwap.lock(swapContract.refundTimeout);
            if(unlock==null) continue;
            this.swapLogger.debug(refundSwap, "refundSwaps(): initiate refund of swap");
            await swapContract.refund(signer, refundSwap.data, true, false, {waitForConfirmation: true});
            this.swapLogger.info(refundSwap, "refundSwaps(): swap refunded, address: "+refundSwap.address);
            //The swap should be removed by the event handler
            await refundSwap.setState(FromBtcSwapState.REFUNDED);
            unlock();
        }
    }

    protected async processInitializeEvent(chainIdentifier: string, savedSwap: FromBtcSwapAbs, event: InitializeEvent<SwapData>) {
        this.swapLogger.info(savedSwap, "SC: InitializeEvent: swap initialized by the client, address: "+savedSwap.address);

        if(savedSwap.state===FromBtcSwapState.CREATED) {
            await savedSwap.setState(FromBtcSwapState.COMMITED);
            await this.saveSwapData(savedSwap);
        }
    }

    protected async processClaimEvent(chainIdentifier: string, savedSwap: FromBtcSwapAbs, event: ClaimEvent<SwapData>): Promise<void> {
        savedSwap.txId = Buffer.from(event.result, "hex").reverse().toString("hex");

        this.swapLogger.info(savedSwap, "SC: ClaimEvent: swap successfully claimed by the client, address: "+savedSwap.address);
        await this.removeSwapData(savedSwap, FromBtcSwapState.CLAIMED);
    }

    protected async processRefundEvent(chainIdentifier: string, savedSwap: FromBtcSwapAbs, event: RefundEvent<SwapData>) {
        savedSwap.txIds.refund = (event as any).meta?.txId;

        this.swapLogger.info(event, "SC: RefundEvent: swap refunded, address: "+savedSwap.address);
        await this.bitcoin.addUnusedAddress(savedSwap.address);
        await this.removeSwapData(savedSwap, FromBtcSwapState.REFUNDED);
    }

    /**
     * Calculates the requested claimer bounty, based on client's request
     *
     * @param req
     * @param expiry
     * @param signal
     * @throws {DefinedRuntimeError} will throw an error if the plugin cancelled the request
     * @returns {Promise<BN>} resulting claimer bounty to be used with the swap
     */
    private async getClaimerBounty(req: Request & {paramReader: IParamReader}, expiry: bigint, signal: AbortSignal): Promise<bigint> {
        const parsedClaimerBounty = await req.paramReader.getParams({
            claimerBounty: {
                feePerBlock: FieldTypeEnum.BigInt,
                safetyFactor: FieldTypeEnum.BigInt,
                startTimestamp: FieldTypeEnum.BigInt,
                addBlock: FieldTypeEnum.BigInt,
                addFee: FieldTypeEnum.BigInt,
            },
        }).catch(e => null);

        signal.throwIfAborted();

        if(parsedClaimerBounty==null || parsedClaimerBounty.claimerBounty==null) {
            throw {
                code: 20043,
                msg: "Invalid claimerBounty"
            };
        }

        const tsDelta: bigint = expiry - parsedClaimerBounty.claimerBounty.startTimestamp;
        const blocksDelta: bigint = tsDelta / this.config.bitcoinBlocktime * parsedClaimerBounty.claimerBounty.safetyFactor;
        const totalBlock: bigint = blocksDelta + parsedClaimerBounty.claimerBounty.addBlock;
        return parsedClaimerBounty.claimerBounty.addFee + (totalBlock * parsedClaimerBounty.claimerBounty.feePerBlock);
    }

    private getDummySwapData(chainIdentifier: string, useToken: string, address: string): Promise<SwapData> {
        const {swapContract, signer} = this.getChain(chainIdentifier);
        const dummyAmount = BigInt(Math.floor(Math.random() * 0x1000000));
        return swapContract.createSwapData(
            ChainSwapType.CHAIN,
            signer.getAddress(),
            address,
            useToken,
            dummyAmount,
            swapContract.getHashForOnchain(randomBytes(32), dummyAmount, 3, null).toString("hex"),
            BigIntBufferUtils.fromBuffer(randomBytes(8)),
            BigInt(Math.floor(Date.now()/1000)) + this.config.swapTsCsvDelta,
            false,
            true,
            BigInt(Math.floor(Math.random() * 0x10000)),
            BigInt(Math.floor(Math.random() * 0x10000))
        );
    }

    /**
     * Sets up required listeners for the REST server
     *
     * @param restServer
     */
    startRestServer(restServer: Express) {

        restServer.use(this.path+"/getAddress", serverParamDecoder(10*1000));
        restServer.post(this.path+"/getAddress", expressHandlerWrapper(async (req: Request & {paramReader: IParamReader}, res: Response & {responseStream: ServerParamEncoder}) => {
            const metadata: {
                request: any,
                times: {[key: string]: number},
            } = {request: {}, times: {}};

            const chainIdentifier = req.query.chain as string ?? this.chains.default;
            const {swapContract, signer, chainInterface} = this.getChain(chainIdentifier);
            const depositToken = req.query.depositToken as string ?? chainInterface.getNativeCurrencyAddress();
            this.checkAllowedDepositToken(chainIdentifier, depositToken);

            metadata.times.requestReceived = Date.now();
            /**
             * address: string              solana address of the recipient
             * amount: string               amount (in sats) of the invoice
             * token: string                Desired token to use
             * exactOut: boolean            Whether the swap should be an exact out instead of exact in swap
             * sequence: BN                 Unique sequence number for the swap
             *
             *Sent later
             * claimerBounty: object        Data for calculating claimer bounty
             *  - feePerBlock: string           Fee per block to be synchronized with btc relay
             *  - safetyFactor: number          Safety factor to multiply required blocks (when using 10 min block time)
             *  - startTimestamp: string        UNIX seconds used for timestamp delta calc
             *  - addBlock: number              Additional blocks to add to the calculation
             *  - addFee: string                Additional fee to add to the final claimer bounty
             * feeRate: string              Fee rate to be used for init signature
             */
            const parsedBody: FromBtcRequestType = await req.paramReader.getParams({
                address: (val: string) => val!=null &&
                        typeof(val)==="string" &&
                        chainInterface.isValidAddress(val) ? val : null,
                amount: FieldTypeEnum.BigInt,
                token: (val: string) => val!=null &&
                        typeof(val)==="string" &&
                        this.isTokenSupported(chainIdentifier, val) ? val : null,
                sequence: FieldTypeEnum.BigInt,
                exactOut: FieldTypeEnum.BooleanOptional
            });
            if(parsedBody==null) throw {
                code: 20100,
                msg: "Invalid request body"
            };
            metadata.request = parsedBody;

            const requestedAmount = {input: !parsedBody.exactOut, amount: parsedBody.amount};
            const request = {
                chainIdentifier,
                raw: req,
                parsed: parsedBody,
                metadata
            };
            const useToken = parsedBody.token;

            //Check request params
            this.checkSequence(parsedBody.sequence);
            const fees = await this.AmountAssertions.preCheckFromBtcAmounts(request, requestedAmount, useToken);
            metadata.times.requestChecked = Date.now();

            //Create abortController for parallel prefetches
            const responseStream = res.responseStream;
            const abortController = getAbortController(responseStream);

            //Pre-fetch data
            const {
                pricePrefetchPromise,
                gasTokenPricePrefetchPromise,
                depositTokenPricePrefetchPromise
            } = this.getFromBtcPricePrefetches(chainIdentifier, useToken, depositToken, abortController);
            const balancePrefetch: Promise<bigint> = this.getBalancePrefetch(chainIdentifier, useToken, abortController);
            const signDataPrefetchPromise: Promise<any> = this.getSignDataPrefetch(chainIdentifier, abortController, responseStream);

            const dummySwapData = await this.getDummySwapData(chainIdentifier, useToken, parsedBody.address);
            abortController.signal.throwIfAborted();
            const baseSDPromise: Promise<bigint> = this.getBaseSecurityDepositPrefetch(
                chainIdentifier, dummySwapData, depositToken,
                gasTokenPricePrefetchPromise, depositTokenPricePrefetchPromise,
                abortController
            );

            //Check valid amount specified (min/max)
            const {
                amountBD,
                swapFee,
                swapFeeInToken,
                totalInToken,
                securityDepositApyPPM,
                securityDepositBaseMultiplierPPM
            } = await this.AmountAssertions.checkFromBtcAmount(request, requestedAmount, fees, useToken, abortController.signal, pricePrefetchPromise);
            metadata.times.priceCalculated = Date.now();

            if(securityDepositApyPPM!=null) fees.securityDepositApyPPM = securityDepositApyPPM;
            if(securityDepositBaseMultiplierPPM!=null) fees.securityDepositBaseMultiplierPPM = securityDepositBaseMultiplierPPM;

            //Check if we have enough funds to honor the request
            await this.checkBalance(totalInToken, balancePrefetch, abortController.signal);
            metadata.times.balanceChecked = Date.now();

            //Create swap receive bitcoin address
            const receiveAddress = await this.bitcoin.getAddress();
            abortController.signal.throwIfAborted();
            metadata.times.addressCreated = Date.now();

            const paymentHash = this.getHash(chainIdentifier, receiveAddress, amountBD);
            const currentTimestamp = BigInt(Math.floor(Date.now()/1000));
            const expiryTimeout = this.config.swapTsCsvDelta;
            const expiry = currentTimestamp + expiryTimeout;

            //Calculate security deposit
            const totalSecurityDeposit = await this.getSecurityDeposit(
                chainIdentifier, amountBD, swapFee, expiryTimeout,
                baseSDPromise, depositToken, depositTokenPricePrefetchPromise, fees,
                abortController.signal, metadata
            );
            metadata.times.securityDepositCalculated = Date.now();

            //Calculate claimer bounty
            const totalClaimerBounty = await this.getClaimerBounty(req, expiry, abortController.signal);
            metadata.times.claimerBountyCalculated = Date.now();

            //Create swap data
            const data: SwapData = await swapContract.createSwapData(
                ChainSwapType.CHAIN,
                signer.getAddress(),
                parsedBody.address,
                useToken,
                totalInToken,
                paymentHash.toString("hex"),
                parsedBody.sequence,
                expiry,
                false,
                true,
                totalSecurityDeposit,
                totalClaimerBounty,
                depositToken
            );
            data.setExtraData(swapContract.getExtraData(
                this.bitcoin.toOutputScript(receiveAddress),
                amountBD,
                this.config.confirmations
            ).toString("hex"));
            abortController.signal.throwIfAborted();
            metadata.times.swapCreated = Date.now();

            //Sign the swap
            const sigData = await this.getFromBtcSignatureData(chainIdentifier, data, req, abortController.signal, signDataPrefetchPromise);
            metadata.times.swapSigned = Date.now();

            const createdSwap: FromBtcSwapAbs = new FromBtcSwapAbs(chainIdentifier, receiveAddress, this.config.confirmations, amountBD, swapFee, swapFeeInToken);
            createdSwap.data = data;
            createdSwap.metadata = metadata;
            createdSwap.prefix = sigData.prefix;
            createdSwap.timeout = sigData.timeout;
            createdSwap.signature = sigData.signature;
            createdSwap.feeRate = sigData.feeRate;

            await PluginManager.swapCreate(createdSwap);
            await this.saveSwapData(createdSwap);

            this.swapLogger.info(createdSwap, "REST: /getAddress: Created swap address: "+receiveAddress+" amount: "+amountBD.toString(10));

            await responseStream.writeParamsAndEnd({
                code: 20000,
                msg: "Success",
                data: {
                    amount: amountBD.toString(10),
                    btcAddress: receiveAddress,
                    address: signer.getAddress(),
                    swapFee: swapFeeInToken.toString(10),
                    total: totalInToken.toString(10),
                    confirmations: this.config.confirmations,
                    data: data.serialize(),
                    prefix: sigData.prefix,
                    timeout: sigData.timeout,
                    signature: sigData.signature
                }
            });

        }));

        this.logger.info("REST: Started at path: ", this.path);
    }

    /**
     * Initializes swap handler, loads data and subscribes to chain events
     */
    async init() {
        await this.loadData(FromBtcSwapAbs);
        this.subscribeToEvents();
        await PluginManager.serviceInitialize(this);
    }

    getInfoData(): any {
        return {
            confirmations: this.config.confirmations,

            cltv: this.config.swapCsvDelta,
            timestampCltv: Number(this.config.swapTsCsvDelta)
        };
    }

}
