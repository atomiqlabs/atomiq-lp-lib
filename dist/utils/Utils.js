"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAbortController = exports.deserializeBN = exports.serializeBN = exports.HEX_REGEX = exports.getLogger = exports.expressHandlerWrapper = exports.isDefinedRuntimeError = void 0;
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
function expressHandlerWrapper(func) {
    return (req, res) => {
        (async () => {
            try {
                await func(req, res);
            }
            catch (e) {
                console.error(e);
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
function getLogger(prefix) {
    return {
        debug: (msg, ...args) => console.debug(prefix + msg, ...args),
        info: (msg, ...args) => console.info(prefix + msg, ...args),
        warn: (msg, ...args) => console.warn(prefix + msg, ...args),
        error: (msg, ...args) => console.error(prefix + msg, ...args)
    };
}
exports.getLogger = getLogger;
exports.HEX_REGEX = /[0-9a-fA-F]+/;
function serializeBN(bn) {
    return bn == null ? null : bn.toString(10);
}
exports.serializeBN = serializeBN;
function deserializeBN(str) {
    return str == null ? null : BigInt(str);
}
exports.deserializeBN = deserializeBN;
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
