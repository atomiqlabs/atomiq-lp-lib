import {Request, Response} from "express";
import {ServerParamEncoder} from "./paramcoders/server/ServerParamEncoder";
import {createHash} from "crypto";
import {Script, Transaction} from "@scure/btc-signer";
import {BtcTx} from "@atomiqlabs/base";

export type LoggerType = {
    debug: (msg: string, ...args: any[]) => void,
    info: (msg: string, ...args: any[]) => void,
    warn: (msg: string, ...args: any[]) => void,
    error: (msg: string, ...args: any[]) => void
};

export function getLogger(prefix: string | (() => string)): LoggerType {
    return {
        debug: (msg, ...args) => global.atomiqLogLevel >= 3 && console.debug((typeof(prefix)==="function" ? prefix() : prefix)+msg, ...args),
        info: (msg, ...args) => global.atomiqLogLevel >= 2 && console.info((typeof(prefix)==="function" ? prefix() : prefix)+msg, ...args),
        warn: (msg, ...args) => (global.atomiqLogLevel==null || global.atomiqLogLevel >= 1) && console.warn((typeof(prefix)==="function" ? prefix() : prefix)+msg, ...args),
        error: (msg, ...args) => (global.atomiqLogLevel==null || global.atomiqLogLevel >= 0) && console.error((typeof(prefix)==="function" ? prefix() : prefix)+msg, ...args)
    };
}

export type DefinedRuntimeError = {
    code: number;
    msg?: string;
    _httpStatus?: number;
    data?: any;
};

export function isDefinedRuntimeError(obj: any): obj is DefinedRuntimeError {
    if(obj.code!=null && typeof(obj.code)==="number") {
        if(obj.msg!=null && typeof(obj.msg)!=="string") return false;
        if(obj._httpStatus!=null && typeof(obj._httpStatus)!=="number") return false;
        return true;
    }
    return false;
}

const expressHandlerWrapperLogger = getLogger("ExpressHandlerWrapper: ");

export function expressHandlerWrapper(func: (
    req: Request,
    res: Response
) => Promise<void>) : ((
    req: Request,
    res: Response & {responseStream: ServerParamEncoder}
) => void) {
    return (
        req: Request,
        res: Response & {responseStream: ServerParamEncoder}
    ) => {
        (async () => {
            try {
                await func(req, res);
            } catch (e) {
                expressHandlerWrapperLogger.error("Error in called function "+req.path+": ", e);
                let statusCode = 500;
                const obj: {code: number, msg: string, data?: any} = {
                    code: 0,
                    msg: "Internal server error"
                };
                if(isDefinedRuntimeError(e)) {
                    obj.msg = e.msg;
                    obj.code = e.code;
                    obj.data = e.data;
                    statusCode = 400;
                    if(e._httpStatus!=null) statusCode = e._httpStatus;
                }
                if(res.responseStream!=null) {
                    if(res.responseStream.getAbortSignal().aborted) return;
                    res.responseStream.writeParamsAndEnd(obj).catch(e => null);
                } else {
                    res.status(statusCode).json(obj);
                }
            }
        })();
    }
}

export const HEX_REGEX = /[0-9a-fA-F]+/;

export function serializeBN(bn: bigint | null): string | null {
    return bn==null ? null : bn.toString(10);
}

export function deserializeBN(str: string | null): bigint | null {
    return str==null ? null : BigInt(str);
}

export function bigIntSorter(a: bigint, b: bigint): -1 | 0 | 1 {
    if(a < b) return -1;
    if(a > b) return 1;
    return 0;
}

/**
 * Creates an abort controller that extends the responseStream's abort signal
 *
 * @param responseStream
 */
export function getAbortController(responseStream: ServerParamEncoder): AbortController {
    const abortController = new AbortController();
    if(responseStream==null || responseStream.getAbortSignal==null) return abortController;
    const responseStreamAbortController = responseStream.getAbortSignal();
    responseStreamAbortController.addEventListener("abort", () => abortController.abort(responseStreamAbortController.reason));
    return abortController;
}

export function parsePsbt(btcTx: Transaction): BtcTx {
    const txWithoutWitness = btcTx.toBytes(true, false);
    return {
        locktime: btcTx.lockTime,
        version: btcTx.version,
        blockhash: null,
        confirmations: 0,
        txid: createHash("sha256").update(
            createHash("sha256").update(
                txWithoutWitness
            ).digest()
        ).digest().reverse().toString("hex"),
        hex: Buffer.from(txWithoutWitness).toString("hex"),
        raw: Buffer.from(btcTx.toBytes(true, true)).toString("hex"),
        vsize: btcTx.isFinal ? btcTx.vsize : null,

        outs: Array.from({length: btcTx.outputsLength}, (_, i) => i).map((index) => {
            const output = btcTx.getOutput(index);
            return {
                value: Number(output.amount),
                n: index,
                scriptPubKey: {
                    asm: Script.decode(output.script).map(val => typeof(val)==="object" ? Buffer.from(val).toString("hex") : val.toString()).join(" "),
                    hex: Buffer.from(output.script).toString("hex")
                }
            }
        }),
        ins: Array.from({length: btcTx.inputsLength}, (_, i) => i).map(index => {
            const input = btcTx.getInput(index);
            return {
                txid: Buffer.from(input.txid).toString("hex"),
                vout: input.index,
                scriptSig: {
                    asm: Script.decode(input.finalScriptSig).map(val => typeof(val)==="object" ? Buffer.from(val).toString("hex") : val.toString()).join(" "),
                    hex: Buffer.from(input.finalScriptSig).toString("hex")
                },
                sequence: input.sequence,
                txinwitness: input.finalScriptWitness==null ? [] : input.finalScriptWitness.map(witness => Buffer.from(witness).toString("hex"))
            }
        })
    };
}
