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
exports.deserializeBN = exports.serializeBN = exports.HEX_REGEX = exports.getLogger = exports.expressHandlerWrapper = exports.isDefinedRuntimeError = void 0;
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
function serializeBN(bn) {
    return bn == null ? null : bn.toString(10);
}
exports.serializeBN = serializeBN;
function deserializeBN(str) {
    return str == null ? null : new BN(str);
}
exports.deserializeBN = deserializeBN;
