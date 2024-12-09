import { Response, Request } from "express";
export declare class ServerParamEncoder {
    private response;
    private controller;
    private paramWriter;
    constructor(response: Response, statusCode: number, request: Request);
    writeParams(params: any): Promise<void>;
    end(): Promise<void>;
    writeParamsAndEnd(params: any): Promise<void>;
    getAbortSignal(): AbortSignal;
}
