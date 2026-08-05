
export function parseBigInt(str: string | number): bigint | null {
    if(str==null) return null;
    if(typeof(str)!=="string" && typeof(str)!=="number") return null;
    try {
        return BigInt(str);
    } catch (e) {
        return null;
    }
}

export enum FieldTypeEnum {
    String=0,
    Boolean=1,
    Number=2,
    BigInt=3,
    Any=4,
    BigIntPositive=5,
    BigIntNotNegative=6,
    NumberPositive=7,
    NumberNotNegative=8,

    StringOptional=100,
    BooleanOptional=101,
    NumberOptional=102,
    BigIntOptional=103,
    AnyOptional=104,
    BigIntPositiveOptional=105,
    BigIntNotNegativeOptional=106,
    NumberPositiveOptional=107,
    NumberNotNegativeOptional=108,
}

export type FieldType<T extends FieldTypeEnum | RequestSchema | ((val: any) => (string | boolean | number | bigint | any))> =
    T extends FieldTypeEnum.String ? string :
    T extends FieldTypeEnum.Boolean ? boolean :
    T extends FieldTypeEnum.Number ? number :
    T extends FieldTypeEnum.NumberPositive ? number :
    T extends FieldTypeEnum.NumberNotNegative ? number :
    T extends FieldTypeEnum.BigInt ? bigint :
    T extends FieldTypeEnum.Any ? any :
    T extends FieldTypeEnum.BigIntPositive ? bigint :
    T extends FieldTypeEnum.BigIntNotNegative ? bigint :
    T extends FieldTypeEnum.StringOptional ? string :
    T extends FieldTypeEnum.BooleanOptional ? boolean :
    T extends FieldTypeEnum.NumberOptional ? number :
    T extends FieldTypeEnum.NumberPositiveOptional ? number :
    T extends FieldTypeEnum.NumberNotNegativeOptional ? number :
    T extends FieldTypeEnum.BigIntOptional ? bigint :
    T extends FieldTypeEnum.AnyOptional ? any :
    T extends FieldTypeEnum.BigIntPositiveOptional ? bigint :
    T extends FieldTypeEnum.BigIntNotNegativeOptional ? bigint :
    T extends RequestSchema ? RequestSchemaResult<T> :
    T extends ((val: any) => string) ? string :
    T extends ((val: any) => boolean) ? boolean :
    T extends ((val: any) => number) ? number :
    T extends ((val: any) => bigint) ? bigint :
    T extends ((val: any) => any) ? any :
        never;

export type RequestSchemaResult<T extends RequestSchema> = {
    [key in keyof T]: FieldType<T[key]>
}

export type RequestSchema = {
    [fieldName: string]: FieldTypeEnum | RequestSchema | ((val: any) => any)
}

export function verifySchemaField(
    val: any,
    type: FieldTypeEnum | RequestSchema | ((val: any) => any),
    fieldName: string,
    resultSchema: any
): boolean {
    if(typeof(type)==="function") {
        const result = type(val);
        if(result==null) return false;
        resultSchema[fieldName] = result;
        return true;
    }

    if(val==null && (type as number)>=100) {
        resultSchema[fieldName] = null;
        return true;
    }

    if(type===FieldTypeEnum.Any || type===FieldTypeEnum.AnyOptional) {
        resultSchema[fieldName] = val;
    } else if(type===FieldTypeEnum.Boolean || type===FieldTypeEnum.BooleanOptional) {
        if(typeof(val)!=="boolean") return false;
        resultSchema[fieldName] = val;
    } else if(type===FieldTypeEnum.Number || type===FieldTypeEnum.NumberOptional) {
        if(typeof(val)!=="number") return false;
        if(isNaN(val as number)) return false;
        resultSchema[fieldName] = val;
    } else if(type===FieldTypeEnum.NumberPositive || type===FieldTypeEnum.NumberPositiveOptional) {
        if(typeof(val)!=="number") return false;
        if(isNaN(val as number)) return false;
        if(val<=0) return false;
        resultSchema[fieldName] = val;
    } else if(type===FieldTypeEnum.NumberNotNegative || type===FieldTypeEnum.NumberNotNegativeOptional) {
        if(typeof(val)!=="number") return false;
        if(isNaN(val as number)) return false;
        if(val<0) return false;
        resultSchema[fieldName] = val;
    } else if(type===FieldTypeEnum.BigInt || type===FieldTypeEnum.BigIntOptional) {
        const result = parseBigInt(val);
        if(result==null) return false;
        resultSchema[fieldName] = result;
    } else if(type===FieldTypeEnum.BigIntPositive || type===FieldTypeEnum.BigIntPositiveOptional) {
        const result = parseBigInt(val);
        if(result==null) return false;
        if(result<=0n) return false;
        resultSchema[fieldName] = result;
    } else if(type===FieldTypeEnum.BigIntNotNegative || type===FieldTypeEnum.BigIntNotNegativeOptional) {
        const result = parseBigInt(val);
        if(result==null) return false;
        if(result<0n) return false;
        resultSchema[fieldName] = result;
    } else if(type===FieldTypeEnum.String || type===FieldTypeEnum.StringOptional) {
        if(typeof(val)!=="string") return false;
        resultSchema[fieldName] = val;
    } else {
        //Probably another request schema
        const result = verifySchema(val, type as RequestSchema);
        if(result==null) return false;
        resultSchema[fieldName] = result;
    }
    return true;
}

export function verifySchema<T extends RequestSchema>(req: any, schema: T): RequestSchemaResult<T> {
    if(req==null) return null;
    const resultSchema: any = {};
    for(let fieldName in schema) {
        if(!verifySchemaField(req[fieldName], schema[fieldName], fieldName, resultSchema)) return null;
    }
    return resultSchema;
}
