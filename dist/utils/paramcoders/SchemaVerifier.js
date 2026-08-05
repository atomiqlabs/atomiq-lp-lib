"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifySchema = exports.verifySchemaField = exports.FieldTypeEnum = exports.parseBigInt = void 0;
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
    FieldTypeEnum[FieldTypeEnum["BigIntPositive"] = 5] = "BigIntPositive";
    FieldTypeEnum[FieldTypeEnum["BigIntNotNegative"] = 6] = "BigIntNotNegative";
    FieldTypeEnum[FieldTypeEnum["NumberPositive"] = 7] = "NumberPositive";
    FieldTypeEnum[FieldTypeEnum["NumberNotNegative"] = 8] = "NumberNotNegative";
    FieldTypeEnum[FieldTypeEnum["StringOptional"] = 100] = "StringOptional";
    FieldTypeEnum[FieldTypeEnum["BooleanOptional"] = 101] = "BooleanOptional";
    FieldTypeEnum[FieldTypeEnum["NumberOptional"] = 102] = "NumberOptional";
    FieldTypeEnum[FieldTypeEnum["BigIntOptional"] = 103] = "BigIntOptional";
    FieldTypeEnum[FieldTypeEnum["AnyOptional"] = 104] = "AnyOptional";
    FieldTypeEnum[FieldTypeEnum["BigIntPositiveOptional"] = 105] = "BigIntPositiveOptional";
    FieldTypeEnum[FieldTypeEnum["BigIntNotNegativeOptional"] = 106] = "BigIntNotNegativeOptional";
    FieldTypeEnum[FieldTypeEnum["NumberPositiveOptional"] = 107] = "NumberPositiveOptional";
    FieldTypeEnum[FieldTypeEnum["NumberNotNegativeOptional"] = 108] = "NumberNotNegativeOptional";
})(FieldTypeEnum = exports.FieldTypeEnum || (exports.FieldTypeEnum = {}));
function verifySchemaField(val, type, fieldName, resultSchema) {
    if (typeof (type) === "function") {
        const result = type(val);
        if (result == null)
            return false;
        resultSchema[fieldName] = result;
        return true;
    }
    if (val == null && type >= 100) {
        resultSchema[fieldName] = null;
        return true;
    }
    if (type === FieldTypeEnum.Any || type === FieldTypeEnum.AnyOptional) {
        resultSchema[fieldName] = val;
    }
    else if (type === FieldTypeEnum.Boolean || type === FieldTypeEnum.BooleanOptional) {
        if (typeof (val) !== "boolean")
            return false;
        resultSchema[fieldName] = val;
    }
    else if (type === FieldTypeEnum.Number || type === FieldTypeEnum.NumberOptional) {
        if (typeof (val) !== "number")
            return false;
        if (isNaN(val))
            return false;
        resultSchema[fieldName] = val;
    }
    else if (type === FieldTypeEnum.NumberPositive || type === FieldTypeEnum.NumberPositiveOptional) {
        if (typeof (val) !== "number")
            return false;
        if (isNaN(val))
            return false;
        if (val <= 0)
            return false;
        resultSchema[fieldName] = val;
    }
    else if (type === FieldTypeEnum.NumberNotNegative || type === FieldTypeEnum.NumberNotNegativeOptional) {
        if (typeof (val) !== "number")
            return false;
        if (isNaN(val))
            return false;
        if (val < 0)
            return false;
        resultSchema[fieldName] = val;
    }
    else if (type === FieldTypeEnum.BigInt || type === FieldTypeEnum.BigIntOptional) {
        const result = parseBigInt(val);
        if (result == null)
            return false;
        resultSchema[fieldName] = result;
    }
    else if (type === FieldTypeEnum.BigIntPositive || type === FieldTypeEnum.BigIntPositiveOptional) {
        const result = parseBigInt(val);
        if (result == null)
            return false;
        if (result <= 0n)
            return false;
        resultSchema[fieldName] = result;
    }
    else if (type === FieldTypeEnum.BigIntNotNegative || type === FieldTypeEnum.BigIntNotNegativeOptional) {
        const result = parseBigInt(val);
        if (result == null)
            return false;
        if (result < 0n)
            return false;
        resultSchema[fieldName] = result;
    }
    else if (type === FieldTypeEnum.String || type === FieldTypeEnum.StringOptional) {
        if (typeof (val) !== "string")
            return false;
        resultSchema[fieldName] = val;
    }
    else {
        //Probably another request schema
        const result = verifySchema(val, type);
        if (result == null)
            return false;
        resultSchema[fieldName] = result;
    }
    return true;
}
exports.verifySchemaField = verifySchemaField;
function verifySchema(req, schema) {
    if (req == null)
        return null;
    const resultSchema = {};
    for (let fieldName in schema) {
        if (!verifySchemaField(req[fieldName], schema[fieldName], fieldName, resultSchema))
            return null;
    }
    return resultSchema;
}
exports.verifySchema = verifySchema;
