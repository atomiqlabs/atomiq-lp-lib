"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IBitcoinWallet = void 0;
const btc_signer_1 = require("@scure/btc-signer");
class IBitcoinWallet {
    constructor(network) {
        this.network = network;
    }
    toOutputScript(address) {
        const outputScript = (0, btc_signer_1.Address)(this.network).decode(address);
        switch (outputScript.type) {
            case "pkh":
            case "sh":
            case "wpkh":
            case "wsh":
                return Buffer.from(btc_signer_1.OutScript.encode({
                    type: outputScript.type,
                    hash: outputScript.hash
                }));
            case "tr":
                return Buffer.from(btc_signer_1.OutScript.encode({
                    type: "tr",
                    pubkey: outputScript.pubkey
                }));
        }
        throw new Error("Unrecognized address type");
    }
    fromOutputScript(outputScript) {
        return (0, btc_signer_1.Address)(this.network).encode(btc_signer_1.OutScript.decode(outputScript));
    }
    getSignedTransaction(destination, amount, feeRate, nonce, maxAllowedFeeRate) {
        return this.getSignedMultiTransaction([{ address: destination, amount }], feeRate, nonce, maxAllowedFeeRate);
    }
    async getSignedMultiTransaction(destinations, feeRate, nonce, maxAllowedFeeRate) {
        let locktime = 0;
        let sequence = 0xFFFFFFFD;
        //Apply nonce
        if (nonce != null) {
            const locktimeBN = nonce >> 24n;
            locktime = Number(locktimeBN) + 500000000;
            if (locktime > (Date.now() / 1000 - 24 * 60 * 60))
                throw new Error("Invalid escrow nonce (locktime)!");
            const sequenceBN = nonce & 0xffffffn;
            sequence = 0xFE000000 + Number(sequenceBN);
        }
        let psbt = new btc_signer_1.Transaction({ lockTime: locktime });
        destinations.forEach(dst => psbt.addOutput({
            script: this.toOutputScript(dst.address),
            amount: BigInt(dst.amount)
        }));
        await this.fundPsbt(psbt, feeRate, maxAllowedFeeRate);
        //Apply nonce
        for (let i = 0; i < psbt.inputsLength; i++) {
            psbt.updateInput(i, { sequence });
        }
        return await this.signPsbt(psbt);
    }
    async estimateFee(destination, amount, feeRate, feeRateMultiplier) {
        feeRate ?? (feeRate = await this.getFeeRate());
        if (feeRateMultiplier != null)
            feeRate = feeRate * feeRateMultiplier;
        let psbt = new btc_signer_1.Transaction();
        psbt.addOutput({
            script: this.toOutputScript(destination),
            amount: BigInt(amount)
        });
        return await this.estimatePsbtFee(psbt, feeRate);
    }
    drainAll(destination, inputs, feeRate) {
        throw new Error("Not implemented");
    }
    burnAll(inputs) {
        let psbt = new btc_signer_1.Transaction();
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
     * Post a task to be executed on the sequential thread of the wallet, in case wallets requires
     *  the UTXOs staying consistent during operation, it is recommended to implement this function
     *
     * @param executor
     */
    execute(executor) {
        return executor();
    }
}
exports.IBitcoinWallet = IBitcoinWallet;
