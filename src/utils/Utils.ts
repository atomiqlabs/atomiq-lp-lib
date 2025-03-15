import {Request, Response} from "express";
import {ServerParamEncoder} from "./paramcoders/server/ServerParamEncoder";

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
                console.error(e);
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

export type LoggerType = {
    debug: (msg: string, ...args: any[]) => void,
    info: (msg: string, ...args: any[]) => void,
    warn: (msg: string, ...args: any[]) => void,
    error: (msg: string, ...args: any[]) => void
};

export function getLogger(prefix: string): LoggerType {
    return {
        debug: (msg, ...args) => console.debug(prefix+msg, ...args),
        info: (msg, ...args) => console.info(prefix+msg, ...args),
        warn: (msg, ...args) => console.warn(prefix+msg, ...args),
        error: (msg, ...args) => console.error(prefix+msg, ...args)
    };
}

export const HEX_REGEX = /[0-9a-fA-F]+/;

export function serializeBN(bn: bigint | null): string | null {
    return bn==null ? null : bn.toString(10);
}

export function deserializeBN(str: string | null): bigint | null {
    return str==null ? null : BigInt(str);
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
