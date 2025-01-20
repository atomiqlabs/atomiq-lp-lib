/// <reference types="node" />
import { RequestSchema, RequestSchemaResult } from "./SchemaVerifier";
import { IParamReader } from "./IParamReader";
export declare class ParamDecoder implements IParamReader {
    frameHeader: Buffer;
    frameData: Buffer[];
    frameDataLength: number;
    closed: boolean;
    params: {
        [key: string]: {
            promise: Promise<any>;
            resolve: (data: any) => void;
            reject: (err: any) => void;
            value: any;
        };
    };
    constructor();
    private onFrameRead;
    onData(data: Buffer): void;
    onEnd(): void;
    onError(e: any): void;
    getParam(key: string): Promise<any>;
    getParams<T extends RequestSchema>(schema: T): Promise<RequestSchemaResult<T>>;
    getExistingParamsOrNull<T extends RequestSchema>(schema: T): RequestSchemaResult<T>;
}
