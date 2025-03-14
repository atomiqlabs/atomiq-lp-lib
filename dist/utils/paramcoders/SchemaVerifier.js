"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifySchema = exports.FieldTypeEnum = exports.parseBigInt = void 0;
function parseBigInt(str) {
    if (str == null)
        return null;
    if (typeof (str) !== "string" && typeof (str) !== "number")
        return null;
    try {
        return BigInt(str);
    }
    catch (e) {
        return null;
    }
}
exports.parseBigInt = parseBigInt;
var FieldTypeEnum;
(function (FieldTypeEnum) {
    FieldTypeEnum[FieldTypeEnum["String"] = 0] = "String";
    FieldTypeEnum[FieldTypeEnum["Boolean"] = 1] = "Boolean";
    FieldTypeEnum[FieldTypeEnum["Number"] = 2] = "Number";
    FieldTypeEnum[FieldTypeEnum["BigInt"] = 3] = "BigInt";
    FieldTypeEnum[FieldTypeEnum["Any"] = 4] = "Any";
    FieldTypeEnum[FieldTypeEnum["StringOptional"] = 100] = "StringOptional";
    FieldTypeEnum[FieldTypeEnum["BooleanOptional"] = 101] = "BooleanOptional";
    FieldTypeEnum[FieldTypeEnum["NumberOptional"] = 102] = "NumberOptional";
    FieldTypeEnum[FieldTypeEnum["BigIntOptional"] = 103] = "BigIntOptional";
    FieldTypeEnum[FieldTypeEnum["AnyOptional"] = 104] = "AnyOptional";
})(FieldTypeEnum = exports.FieldTypeEnum || (exports.FieldTypeEnum = {}));
function verifySchema(req, schema) {
    if (req == null)
        return null;
    const resultSchema = {};
    for (let fieldName in schema) {
        const val = req[fieldName];
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
        if (type === FieldTypeEnum.Any || type === FieldTypeEnum.AnyOptional) {
            resultSchema[fieldName] = val;
        }
        else if (type === FieldTypeEnum.Boolean || type === FieldTypeEnum.BooleanOptional) {
            if (typeof (val) !== "boolean")
                return null;
            resultSchema[fieldName] = val;
        }
        else if (type === FieldTypeEnum.Number || type === FieldTypeEnum.NumberOptional) {
            if (typeof (val) !== "number")
                return null;
            if (isNaN(val))
                return null;
            resultSchema[fieldName] = val;
        }
        else if (type === FieldTypeEnum.BigInt || type === FieldTypeEnum.BigIntOptional) {
            const result = parseBigInt(val);
            if (result == null)
                return null;
            resultSchema[fieldName] = result;
        }
        else if (type === FieldTypeEnum.String || type === FieldTypeEnum.StringOptional) {
            if (typeof (val) !== "string")
                return null;
            resultSchema[fieldName] = val;
        }
        else {
            //Probably another request schema
            const result = verifySchema(val, type);
            if (result == null)
                return null;
            resultSchema[fieldName] = result;
        }
    }
    return resultSchema;
}
exports.verifySchema = verifySchema;
