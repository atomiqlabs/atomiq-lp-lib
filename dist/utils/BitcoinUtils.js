"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLegacyInput = void 0;
const utxo_1 = require("@scure/btc-signer/utxo");
const btc_signer_1 = require("@scure/btc-signer");
function parsePushOpcode(script) {
    if (script[0] === 0x00) {
        return Uint8Array.from([]);
    }
    if (script[0] <= 0x4b) {
        return script.slice(1, 1 + script[0]);
    }
    if (script[0] === 0x4c) {
        return script.slice(2, 2 + script[1]);
    }
    if (script[0] === 0x4d) {
        const length = Buffer.from(script.slice(1, 3)).readUInt16LE();
        return script.slice(3, 3 + length);
    }
    if (script[0] === 0x4e) {
        const length = Buffer.from(script.slice(1, 5)).readUInt32LE();
        return script.slice(5, 5 + length);
    }
    if (script[0] === 0x4f) {
        return Uint8Array.from([0x81]);
    }
    if (script[0] >= 0x51 && script[0] <= 0x60) {
        return Uint8Array.from([script[0] - 0x50]);
    }
    throw new Error("No push opcode detected");
}
function isLegacyInput(input) {
    const prevOut = (0, utxo_1.getPrevOut)(input);
    const first = btc_signer_1.OutScript.decode(prevOut.script);
    if (first.type === "tr" || first.type === "wsh" || first.type === "wpkh")
        return false;
    if (first.type === "sh") {
        const redeemScript = input.redeemScript ?? parsePushOpcode(input.finalScriptSig);
        const second = btc_signer_1.OutScript.decode(redeemScript);
        if (second.type === "wsh" || second.type === "wpkh")
            return false;
    }
    return true;
}
exports.isLegacyInput = isLegacyInput;
