"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePsbt = exports.getAbortController = exports.bigIntSorter = exports.deserializeBN = exports.serializeBN = exports.HEX_REGEX = exports.expressHandlerWrapper = exports.isDefinedRuntimeError = exports.getLogger = void 0;
const crypto_1 = require("crypto");
const btc_signer_1 = require("@scure/btc-signer");
function getLogger(prefix) {
    return {
        debug: (msg, ...args) => global.atomiqLogLevel >= 3 && console.debug((typeof (prefix) === "function" ? prefix() : prefix) + msg, ...args),
        info: (msg, ...args) => global.atomiqLogLevel >= 2 && console.info((typeof (prefix) === "function" ? prefix() : prefix) + msg, ...args),
        warn: (msg, ...args) => (global.atomiqLogLevel == null || global.atomiqLogLevel >= 1) && console.warn((typeof (prefix) === "function" ? prefix() : prefix) + msg, ...args),
        error: (msg, ...args) => (global.atomiqLogLevel == null || global.atomiqLogLevel >= 0) && console.error((typeof (prefix) === "function" ? prefix() : prefix) + msg, ...args)
    };
}
exports.getLogger = getLogger;
function isDefinedRuntimeError(obj) {
    if (obj.code != null && typeof (obj.code) === "number") {
        if (obj.msg != null && typeof (obj.msg) !== "string")
            return false;
        if (obj._httpStatus != null && typeof (obj._httpStatus) !== "number")
            return false;
        return true;
    }
    return false;
}
exports.isDefinedRuntimeError = isDefinedRuntimeError;
const expressHandlerWrapperLogger = getLogger("ExpressHandlerWrapper: ");
function expressHandlerWrapper(func) {
    return (req, res) => {
        (async () => {
            try {
                await func(req, res);
            }
            catch (e) {
                if (!isDefinedRuntimeError(e) || e._httpStatus !== 200)
                    expressHandlerWrapperLogger.error("Error in called function " + req.path + ": ", e);
                let statusCode = 500;
                const obj = {
                    code: 0,
                    msg: "Internal server error"
                };
                if (isDefinedRuntimeError(e)) {
                    obj.msg = e.msg;
                    obj.code = e.code;
                    obj.data = e.data;
                    statusCode = 400;
                    if (e._httpStatus != null)
                        statusCode = e._httpStatus;
                }
                if (res.responseStream != null) {
                    if (res.responseStream.getAbortSignal().aborted)
                        return;
                    res.responseStream.writeParamsAndEnd(obj).catch(e => null);
                }
                else {
                    res.status(statusCode).json(obj);
                }
            }
        })();
    };
}
exports.expressHandlerWrapper = expressHandlerWrapper;
exports.HEX_REGEX = /[0-9a-fA-F]+/;
function serializeBN(bn) {
    return bn == null ? null : bn.toString(10);
}
exports.serializeBN = serializeBN;
function deserializeBN(str) {
    return str == null ? null : BigInt(str);
}
exports.deserializeBN = deserializeBN;
function bigIntSorter(a, b) {
    if (a < b)
        return -1;
    if (a > b)
        return 1;
    return 0;
}
exports.bigIntSorter = bigIntSorter;
/**
 * Creates an abort controller that extends the responseStream's abort signal
 *
 * @param responseStream
 */
function getAbortController(responseStream) {
    const abortController = new AbortController();
    if (responseStream == null || responseStream.getAbortSignal == null)
        return abortController;
    const responseStreamAbortController = responseStream.getAbortSignal();
    responseStreamAbortController.addEventListener("abort", () => abortController.abort(responseStreamAbortController.reason));
    return abortController;
}
exports.getAbortController = getAbortController;
function parsePsbt(btcTx) {
    const txWithoutWitness = btcTx.toBytes(true, false);
    return {
        locktime: btcTx.lockTime,
        version: btcTx.version,
        blockhash: null,
        confirmations: 0,
        txid: (0, crypto_1.createHash)("sha256").update((0, crypto_1.createHash)("sha256").update(txWithoutWitness).digest()).digest().reverse().toString("hex"),
        hex: Buffer.from(txWithoutWitness).toString("hex"),
        raw: Buffer.from(btcTx.toBytes(true, true)).toString("hex"),
        vsize: btcTx.isFinal ? btcTx.vsize : null,
        outs: Array.from({ length: btcTx.outputsLength }, (_, i) => i).map((index) => {
            const output = btcTx.getOutput(index);
            return {
                value: Number(output.amount),
                n: index,
                scriptPubKey: {
                    asm: btc_signer_1.Script.decode(output.script).map(val => typeof (val) === "object" ? Buffer.from(val).toString("hex") : val.toString()).join(" "),
                    hex: Buffer.from(output.script).toString("hex")
                }
            };
        }),
        ins: Array.from({ length: btcTx.inputsLength }, (_, i) => i).map(index => {
            const input = btcTx.getInput(index);
            return {
                txid: Buffer.from(input.txid).toString("hex"),
                vout: input.index,
                scriptSig: {
                    asm: btc_signer_1.Script.decode(input.finalScriptSig).map(val => typeof (val) === "object" ? Buffer.from(val).toString("hex") : val.toString()).join(" "),
                    hex: Buffer.from(input.finalScriptSig).toString("hex")
                },
                sequence: input.sequence,
                txinwitness: input.finalScriptWitness == null ? [] : input.finalScriptWitness.map(witness => Buffer.from(witness).toString("hex"))
            };
        })
    };
}
exports.parsePsbt = parsePsbt;
