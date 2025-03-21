
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

    StringOptional=100,
    BooleanOptional=101,
    NumberOptional=102,
    BigIntOptional=103,
    AnyOptional=104,
}

export type FieldType<T extends FieldTypeEnum | RequestSchema | ((val: any) => (string | boolean | number | bigint | any))> =
    T extends FieldTypeEnum.String ? string :
    T extends FieldTypeEnum.Boolean ? boolean :
    T extends FieldTypeEnum.Number ? number :
    T extends FieldTypeEnum.BigInt ? bigint :
    T extends FieldTypeEnum.Any ? any :
    T extends FieldTypeEnum.StringOptional ? string :
    T extends FieldTypeEnum.BooleanOptional ? boolean :
    T extends FieldTypeEnum.NumberOptional ? number :
    T extends FieldTypeEnum.BigIntOptional ? bigint :
    T extends FieldTypeEnum.AnyOptional ? any :
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

export function verifySchema<T extends RequestSchema>(req: any, schema: T): RequestSchemaResult<T> {
    if(req==null) return null;
    const resultSchema: any = {};
    for(let fieldName in schema) {
        const val: any = req[fieldName];

        const type: FieldTypeEnum | RequestSchema | ((val: any) => boolean) = schema[fieldName];
        if(typeof(type)==="function") {
            const result = type(val);
            if(result==null) return null;
            resultSchema[fieldName] = result;
            continue;
        }

        if(val==null && (type as number)>=100) {
            resultSchema[fieldName] = null;
            continue;
        }

        if(type===FieldTypeEnum.Any || type===FieldTypeEnum.AnyOptional) {
            resultSchema[fieldName] = val;
        } else if(type===FieldTypeEnum.Boolean || type===FieldTypeEnum.BooleanOptional) {
            if(typeof(val)!=="boolean") return null;
            resultSchema[fieldName] = val;
        } else if(type===FieldTypeEnum.Number || type===FieldTypeEnum.NumberOptional) {
            if(typeof(val)!=="number") return null;
            if(isNaN(val as number)) return null;
            resultSchema[fieldName] = val;
        } else if(type===FieldTypeEnum.BigInt || type===FieldTypeEnum.BigIntOptional) {
            const result = parseBigInt(val);
            if(result==null) return null;
            resultSchema[fieldName] = result;
        } else if(type===FieldTypeEnum.String || type===FieldTypeEnum.StringOptional) {
            if(typeof(val)!=="string") return null;
            resultSchema[fieldName] = val;
        } else {
            //Probably another request schema
            const result = verifySchema(val, type as RequestSchema);
            if(result==null) return null;
            resultSchema[fieldName] = result;
        }
    }
    return resultSchema;
}
