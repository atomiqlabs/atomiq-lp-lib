"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleLndError = exports.deserializeBN = exports.serializeBN = exports.shuffle = exports.HEX_REGEX = exports.getLogger = exports.expressHandlerWrapper = exports.isDefinedRuntimeError = void 0;
const BN = require("bn.js");
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
        (() => __awaiter(this, void 0, void 0, function* () {
            try {
                yield func(req, res);
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
        }))();
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
function shuffle(array) {
    let currentIndex = array.length;
    // While there remain elements to shuffle...
    while (currentIndex != 0) {
        // Pick a remaining element...
        let randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [
            array[randomIndex], array[currentIndex]
        ];
    }
}
exports.shuffle = shuffle;
function serializeBN(bn) {
    return bn == null ? null : bn.toString(10);
}
exports.serializeBN = serializeBN;
function deserializeBN(str) {
    return str == null ? null : new BN(str);
}
exports.deserializeBN = deserializeBN;
/**
 * Handles & throws LND error if the error is:
 *  - network error
 *  - server side (LND) internal error
 *  - malformed input data error
 *
 * @param e
 */
function handleLndError(e) {
    if (!Array.isArray(e))
        throw e; //Throw errors that are not originating from the SDK
    if (typeof (e[0]) !== "number")
        throw e; //Throw errors that don't have proper format
    if (e[0] >= 500 && e[0] < 600)
        throw e; //Throw server errors 5xx
    if (e[0] === 400)
        throw e; //Throw malformed request data errors
}
exports.handleLndError = handleLndError;
