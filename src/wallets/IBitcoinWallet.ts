import {BtcTx} from "@atomiqlabs/base";
import {Command} from "@atomiqlabs/server-base";
import {Address, OutScript, Transaction} from "@scure/btc-signer";
import {BTC_NETWORK} from "@scure/btc-signer/utils";

export type BitcoinUtxo = {
    address: string,
    type: "p2wpkh" | "p2sh-p2wpkh" | "p2tr",
    confirmations: number,
    outputScript: Buffer,
    value: number,
    txId: string,
    vout: number
};

export type SignPsbtResponse = {
    psbt: Transaction,
    tx: Transaction,
    raw: string,
    txId: string,
    networkFee: number
};

export abstract class IBitcoinWallet {

    readonly network: BTC_NETWORK;

    protected constructor(network: BTC_NETWORK) {
        this.network = network;
    }

    toOutputScript(address: string): Buffer {
        const outputScript = Address(this.network).decode(address);
        switch(outputScript.type) {
            case "pkh":
            case "sh":
            case "wpkh":
            case "wsh":
                return Buffer.from(OutScript.encode({
                    type: outputScript.type,
                    hash: outputScript.hash
                }));
            case "tr":
                return Buffer.from(OutScript.encode({
                    type: "tr",
                    pubkey: outputScript.pubkey
                }));
        }
        throw new Error("Unrecognized address type");
    }

    getSignedTransaction(destination: string, amount: number, feeRate?: number, nonce?: bigint, maxAllowedFeeRate?: number): Promise<SignPsbtResponse> {
        return this.getSignedMultiTransaction([{address: destination, amount}], feeRate, nonce, maxAllowedFeeRate);
    }

    async getSignedMultiTransaction(
      destinations: {address: string, amount: number}[], feeRate?: number, nonce?: bigint, maxAllowedFeeRate?: number
    ): Promise<SignPsbtResponse> {
        let locktime = 0;
        let sequence = 0xFFFFFFFD;
        //Apply nonce
        if(nonce!=null) {
            const locktimeBN = nonce >> 24n;
            locktime = Number(locktimeBN) + 500000000;
            if(locktime > (Date.now()/1000 - 24*60*60)) throw new Error("Invalid escrow nonce (locktime)!");

            const sequenceBN = nonce & 0xFFFFFFn;
            sequence = 0xFE000000 + Number(sequenceBN);
        }

        let psbt = new Transaction({lockTime: locktime});
        destinations.forEach(dst => psbt.addOutput({
            script: this.toOutputScript(dst.address),
            amount: BigInt(dst.amount)
        }));

        await this.fundPsbt(psbt, feeRate, maxAllowedFeeRate);

        //Apply nonce
        for(let i=0;i<psbt.inputsLength;i++) {
            psbt.updateInput(i, {sequence});
        }

        return await this.signPsbt(psbt);
    }

    async estimateFee(destination: string, amount: number, feeRate?: number, feeRateMultiplier?: number): Promise<{satsPerVbyte: number, networkFee: number}> {
        feeRate ??= await this.getFeeRate();
        if(feeRateMultiplier!=null) feeRate = feeRate * feeRateMultiplier;

        let psbt = new Transaction();
        psbt.addOutput({
            script: this.toOutputScript(destination),
            amount: BigInt(amount)
        });

        return await this.estimatePsbtFee(psbt, feeRate);
    }

    drainAll(destination: string | Buffer, inputs: Omit<BitcoinUtxo, "address">[], feeRate?: number): Promise<SignPsbtResponse> {
        throw new Error("Not implemented");
    }

    burnAll(inputs: Omit<BitcoinUtxo, "address">[]): Promise<SignPsbtResponse> {
        let psbt = new Transaction();
        inputs.forEach(input => psbt.addInput({
            txid: input.txId,
            index: input.vout,
            witnessUtxo: {
                script: input.outputScript,
                amount: BigInt(input.value)
            },
            sighashType: 0x01,
            sequence: 0
        }));
        psbt.addOutput({
            script: Buffer.concat([Buffer.from([0x6a, 20]), Buffer.from("BURN, BABY, BURN! AQ", "ascii")]),
            amount: 0n
        });
        return this.signPsbt(psbt);
    }

    /**
     * Initializes the wallet, called before any actions on the wallet
     */
    abstract init(): Promise<void>;

    /**
     * Returns whether the wallet is ready
     */
    abstract isReady(): boolean;
    /**
     * Returns the status defined string to be displayed in the status message
     */
    abstract getStatus(): string;
    /**
     * Additional status information to be displayed in the status message
     */
    abstract getStatusInfo(): Promise<Record<string, string>>;
    /**
     * Returns the commands that will be exposed
     */
    abstract getCommands(): Command<any>[];

    /**
     * Returns the address type of the wallet
     */
    abstract getAddressType(): "p2wpkh" | "p2sh-p2wpkh" | "p2tr";
    /**
     * Returns an unused address suitable for receiving
     */
    abstract getAddress(): Promise<string>;
    /**
     * Adds previously returned address (with getAddress call), to the pool of unused addresses
     * @param address
     */
    abstract addUnusedAddress(address: string): Promise<void>;
    /**
     * Returns the wallet balance, separated between confirmed and unconfirmed balance (both in sats)
     */
    abstract getBalance(): Promise<{confirmed: number, unconfirmed: number}>;
    /**
     * Returns the total spendable wallet balance in sats
     */
    abstract getSpendableBalance(): Promise<number>;

    /**
     * Returns all wallet transactions confirmed after the specified blockheight (includes also unconfirmed
     *  wallet transaction!!)
     *
     * @param startHeight
     */
    abstract getWalletTransactions(startHeight?: number): Promise<BtcTx[]>;
    /**
     * Returns the in-wallet transaction as identified by its transaction ID
     *
     * @param txId
     */
    abstract getWalletTransaction(txId: string): Promise<BtcTx | null>;
    /**
     * Subscribes to wallet transactions, should fire when transaction enters mempool, and then also
     *  for the first confirmation of the transactions
     *
     * @param callback
     * @param abortSignal
     */
    abstract subscribeToWalletTransactions(callback: (tx: BtcTx) => void, abortSignal?: AbortSignal): void;

    /**
     * Estimates a network fee (in sats), for sending a specific PSBT, the provided PSBT might not contain
     *  any inputs, hence the fee returned should also reflect the transaction size increase by adding
     *  wallet UTXOs as inputs
     *
     * @param psbt
     * @param feeRate
     */
    abstract estimatePsbtFee(psbt: Transaction, feeRate?: number): Promise<{satsPerVbyte: number, networkFee: number}>;
    /**
     * Funds the provided PSBT (adds wallet UTXOs)
     *
     * @param psbt
     * @param feeRate
     * @param maxAllowedFeeRate
     */
    abstract fundPsbt(psbt: Transaction, feeRate?: number, maxAllowedFeeRate?: number): Promise<Transaction>;
    /**
     * Signs the provided PSBT
     *
     * @param psbt
     */
    abstract signPsbt(psbt: Transaction): Promise<SignPsbtResponse>;
    /**
     * Broadcasts a raw bitcoin hex encoded transaction
     *
     * @param tx
     */
    abstract sendRawTransaction(tx: string): Promise<void>;

    /**
     * Returns bitcoin network fee in sats/vB
     */
    abstract getFeeRate(): Promise<number>;
    /**
     * Returns the blockheight of the bitcoin chain
     */
    abstract getBlockheight(): Promise<number>;

    /**
     * Post a task to be executed on the sequential thread of the wallet, in case wallets requires
     *  the UTXOs staying consistent during operation, it is recommended to implement this function
     *
     * @param executor
     */
    execute(executor: () => Promise<void>): Promise<void> {
        return executor();
    }

}