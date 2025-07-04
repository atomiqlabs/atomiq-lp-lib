"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serverParamDecoder = exports.RequestParsingError = exports.RequestTimeoutError = void 0;
const SchemaVerifier_1 = require("../SchemaVerifier");
const ParamDecoder_1 = require("../ParamDecoder");
const ServerParamEncoder_1 = require("./ServerParamEncoder");
const Utils_1 = require("../../Utils");
class RequestTimeoutError extends Error {
    constructor() {
        super("Request timed out");
        // Set the prototype explicitly.
        Object.setPrototypeOf(this, RequestTimeoutError.prototype);
    }
}
exports.RequestTimeoutError = RequestTimeoutError;
class RequestParsingError extends Error {
    constructor() {
        super("Request cannot be parsed");
        // Set the prototype explicitly.
        Object.setPrototypeOf(this, RequestParsingError.prototype);
    }
}
exports.RequestParsingError = RequestParsingError;
const logger = (0, Utils_1.getLogger)("ServerParamDecoder: ");
const serverParamDecoder = (timeoutMillis) => (req, res, next) => {
    let timeout;
    res.responseStream = new ServerParamEncoder_1.ServerParamEncoder(res, 200, req);
    if (req.headers['content-type'] !== "application/x-multiple-json") {
        const dataBuffers = [];
        req.on("data", (data) => {
            dataBuffers.push(data);
        });
        req.on("end", () => {
            try {
                const body = dataBuffers.length === 0 ? {} : JSON.parse(Buffer.concat(dataBuffers).toString());
                const paramReader = {
                    getParams: (schema) => {
                        return Promise.resolve((0, SchemaVerifier_1.verifySchema)(body, schema));
                    },
                    getExistingParamsOrNull: (schema) => {
                        return (0, SchemaVerifier_1.verifySchema)(body, schema);
                    }
                };
                req.paramReader = paramReader;
                next();
            }
            catch (e) {
                logger.error("error reading legacy (non-streaming) http request", e);
                req.destroy(new RequestParsingError());
                res.destroy(new RequestParsingError());
            }
            clearTimeout(timeout);
        });
        req.on("error", (e) => {
            logger.error("error reading legacy (non-streaming) http request", e);
        });
        timeout = setTimeout(() => {
            req.destroy(new RequestTimeoutError());
            res.destroy(new RequestTimeoutError());
        }, timeoutMillis);
        return;
    }
    const decoder = new ParamDecoder_1.ParamDecoder();
    req.on("data", (data) => {
        try {
            decoder.onData(data);
        }
        catch (e) {
            logger.error("error reading streaming http request: on(\"data\")", e);
            req.destroy(new RequestParsingError());
            res.destroy(new RequestParsingError());
        }
    });
    req.on("end", () => {
        try {
            decoder.onEnd();
        }
        catch (e) {
            logger.error("error reading streaming http request: on(\"end\")", e);
            req.destroy(new RequestParsingError());
            res.destroy(new RequestParsingError());
        }
        clearTimeout(timeout);
    });
    req.on("error", (e) => {
        try {
            decoder.onError(e);
        }
        catch (e) {
            logger.error("error reading streaming http request: on(\"error\")", e);
        }
    });
    timeout = setTimeout(() => {
        try {
            decoder.onEnd();
        }
        catch (e) {
            logger.error("error reading streaming http request: timeout", e);
        }
        req.destroy(new RequestTimeoutError());
        res.destroy(new RequestTimeoutError());
    }, timeoutMillis);
    req.paramReader = decoder;
    next();
    return;
};
exports.serverParamDecoder = serverParamDecoder;
