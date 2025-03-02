"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParamDecoder = void 0;
const SchemaVerifier_1 = require("./SchemaVerifier");
class ParamDecoder {
    constructor() {
        this.frameHeader = null;
        this.frameData = [];
        this.frameDataLength = 0;
        this.closed = false;
        this.params = {};
    }
    onFrameRead(data) {
        const obj = JSON.parse(data.toString());
        for (let key in obj) {
            if (this.params[key] == null) {
                this.params[key] = {
                    promise: Promise.resolve(obj[key]),
                    resolve: null,
                    reject: null,
                    value: obj[key]
                };
            }
            else {
                if (this.params[key].resolve != null) {
                    this.params[key].resolve(obj[key]);
                    this.params[key].resolve = null;
                    this.params[key].reject = null;
                }
            }
        }
    }
    onData(data) {
        let leavesBuffer = data;
        while (leavesBuffer != null && leavesBuffer.length > 0) {
            if (this.frameHeader == null) {
                if (leavesBuffer.length <= 4) {
                    this.frameHeader = leavesBuffer;
                    leavesBuffer = null;
                }
                else {
                    this.frameHeader = leavesBuffer.subarray(0, 4);
                    leavesBuffer = leavesBuffer.subarray(4);
                }
            }
            else if (this.frameHeader.length < 4) {
                const requiredLen = 4 - this.frameHeader.length;
                if (leavesBuffer.length <= requiredLen) {
                    this.frameHeader = Buffer.concat([this.frameHeader, leavesBuffer]);
                    leavesBuffer = null;
                }
                else {
                    this.frameHeader = Buffer.concat([this.frameHeader, leavesBuffer.subarray(0, requiredLen)]);
                    leavesBuffer = leavesBuffer.subarray(requiredLen);
                }
            }
            if (leavesBuffer == null)
                continue;
            if (this.frameHeader == null || this.frameHeader.length < 4)
                continue;
            const frameLength = this.frameHeader.readUint32LE();
            const requiredLen = frameLength - this.frameDataLength;
            if (leavesBuffer.length <= requiredLen) {
                this.frameData.push(leavesBuffer);
                this.frameDataLength += leavesBuffer.length;
                leavesBuffer = null;
            }
            else {
                this.frameData.push(leavesBuffer.subarray(0, requiredLen));
                this.frameDataLength += requiredLen;
                leavesBuffer = leavesBuffer.subarray(requiredLen);
            }
            if (frameLength === this.frameDataLength) {
                //Message read success
                this.onFrameRead(Buffer.concat(this.frameData));
                this.frameHeader = null;
                this.frameData = [];
                this.frameDataLength = 0;
            }
        }
    }
    onEnd() {
        for (let key in this.params) {
            if (this.params[key].reject != null) {
                this.params[key].reject(new Error("EOF before field seen!"));
            }
        }
        this.closed = true;
    }
    onError(e) {
        for (let key in this.params) {
            if (this.params[key].reject != null) {
                this.params[key].reject(e);
            }
        }
        this.closed = true;
    }
    getParam(key) {
        if (this.params[key] == null) {
            if (this.closed)
                return Promise.reject(new Error("Stream already closed without param received!"));
            let resolve;
            let reject;
            const promise = new Promise((_resolve, _reject) => {
                resolve = _resolve;
                reject = _reject;
            });
            this.params[key] = {
                resolve,
                reject,
                promise,
                value: null
            };
        }
        return this.params[key].promise;
    }
    async getParams(schema) {
        const resultSchema = {};
        for (let fieldName in schema) {
            const val = await this.getParam(fieldName);
            const type = schema[fieldName];
            if (typeof (type) === "function") {
                const result = type(val);
                if (result == null)
                    return null;
                resultSchema[fieldName] = result;
                continue;
            }
            if (val == null && type >= 100) {
                resultSchema[fieldName] = null;
                continue;
            }
            if (type === SchemaVerifier_1.FieldTypeEnum.Any || type === SchemaVerifier_1.FieldTypeEnum.AnyOptional) {
                resultSchema[fieldName] = val;
            }
            else if (type === SchemaVerifier_1.FieldTypeEnum.Boolean || type === SchemaVerifier_1.FieldTypeEnum.BooleanOptional) {
                if (typeof (val) !== "boolean")
                    return null;
                resultSchema[fieldName] = val;
            }
            else if (type === SchemaVerifier_1.FieldTypeEnum.Number || type === SchemaVerifier_1.FieldTypeEnum.NumberOptional) {
                if (typeof (val) !== "number")
                    return null;
                if (isNaN(val))
                    return null;
                resultSchema[fieldName] = val;
            }
            else if (type === SchemaVerifier_1.FieldTypeEnum.BigInt || type === SchemaVerifier_1.FieldTypeEnum.BigIntOptional) {
                const result = (0, SchemaVerifier_1.parseBigInt)(val);
                if (result == null)
                    return null;
                resultSchema[fieldName] = result;
            }
            else if (type === SchemaVerifier_1.FieldTypeEnum.String || type === SchemaVerifier_1.FieldTypeEnum.StringOptional) {
                if (typeof (val) !== "string")
                    return null;
                resultSchema[fieldName] = val;
            }
            else {
                //Probably another request schema
                const result = (0, SchemaVerifier_1.verifySchema)(val, type);
                if (result == null)
                    return null;
                resultSchema[fieldName] = result;
            }
        }
        return resultSchema;
    }
    getExistingParamsOrNull(schema) {
        const resultSchema = {};
        for (let fieldName in schema) {
            const val = this.params[fieldName]?.value;
            if (val == null) {
                resultSchema[fieldName] = null;
                continue;
            }
            const type = schema[fieldName];
            if (typeof (type) === "function") {
                const result = type(val);
                if (result == null)
                    return null;
                resultSchema[fieldName] = result;
                continue;
            }
            if (type === SchemaVerifier_1.FieldTypeEnum.Any || type === SchemaVerifier_1.FieldTypeEnum.AnyOptional) {
                resultSchema[fieldName] = val;
            }
            else if (type === SchemaVerifier_1.FieldTypeEnum.Boolean || type === SchemaVerifier_1.FieldTypeEnum.BooleanOptional) {
                if (typeof (val) !== "boolean")
                    return null;
                resultSchema[fieldName] = val;
            }
            else if (type === SchemaVerifier_1.FieldTypeEnum.Number || type === SchemaVerifier_1.FieldTypeEnum.NumberOptional) {
                if (typeof (val) !== "number")
                    return null;
                if (isNaN(val))
                    return null;
                resultSchema[fieldName] = val;
            }
            else if (type === SchemaVerifier_1.FieldTypeEnum.BigInt || type === SchemaVerifier_1.FieldTypeEnum.BigIntOptional) {
                const result = (0, SchemaVerifier_1.parseBigInt)(val);
                if (result == null)
                    return null;
                resultSchema[fieldName] = result;
            }
            else if (type === SchemaVerifier_1.FieldTypeEnum.String || type === SchemaVerifier_1.FieldTypeEnum.StringOptional) {
                if (typeof (val) !== "string")
                    return null;
                resultSchema[fieldName] = val;
            }
            else {
                //Probably another request schema
                const result = (0, SchemaVerifier_1.verifySchema)(val, type);
                if (result == null)
                    return null;
                resultSchema[fieldName] = result;
            }
        }
        return resultSchema;
    }
}
exports.ParamDecoder = ParamDecoder;
