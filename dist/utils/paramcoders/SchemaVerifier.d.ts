export declare function parseBigInt(str: string | number): bigint | null;
export declare enum FieldTypeEnum {
    String = 0,
    Boolean = 1,
    Number = 2,
    BigInt = 3,
    Any = 4,
    BigIntPositive = 5,
    BigIntNotNegative = 6,
    NumberPositive = 7,
    NumberNotNegative = 8,
    StringOptional = 100,
    BooleanOptional = 101,
    NumberOptional = 102,
    BigIntOptional = 103,
    AnyOptional = 104,
    BigIntPositiveOptional = 105,
    BigIntNotNegativeOptional = 106,
    NumberPositiveOptional = 107,
    NumberNotNegativeOptional = 108
}
export type FieldType<T extends FieldTypeEnum | RequestSchema | ((val: any) => (string | boolean | number | bigint | any))> = T extends FieldTypeEnum.String ? string : T extends FieldTypeEnum.Boolean ? boolean : T extends FieldTypeEnum.Number ? number : T extends FieldTypeEnum.NumberPositive ? number : T extends FieldTypeEnum.NumberNotNegative ? number : T extends FieldTypeEnum.BigInt ? bigint : T extends FieldTypeEnum.Any ? any : T extends FieldTypeEnum.BigIntPositive ? bigint : T extends FieldTypeEnum.BigIntNotNegative ? bigint : T extends FieldTypeEnum.StringOptional ? string : T extends FieldTypeEnum.BooleanOptional ? boolean : T extends FieldTypeEnum.NumberOptional ? number : T extends FieldTypeEnum.NumberPositiveOptional ? number : T extends FieldTypeEnum.NumberNotNegativeOptional ? number : T extends FieldTypeEnum.BigIntOptional ? bigint : T extends FieldTypeEnum.AnyOptional ? any : T extends FieldTypeEnum.BigIntPositiveOptional ? bigint : T extends FieldTypeEnum.BigIntNotNegativeOptional ? bigint : T extends RequestSchema ? RequestSchemaResult<T> : T extends ((val: any) => string) ? string : T extends ((val: any) => boolean) ? boolean : T extends ((val: any) => number) ? number : T extends ((val: any) => bigint) ? bigint : T extends ((val: any) => any) ? any : never;
export type RequestSchemaResult<T extends RequestSchema> = {
    [key in keyof T]: FieldType<T[key]>;
};
export type RequestSchema = {
    [fieldName: string]: FieldTypeEnum | RequestSchema | ((val: any) => any);
};
export declare function verifySchemaField(val: any, type: FieldTypeEnum | RequestSchema | ((val: any) => any), fieldName: string, resultSchema: any): boolean;
export declare function verifySchema<T extends RequestSchema>(req: any, schema: T): RequestSchemaResult<T>;
