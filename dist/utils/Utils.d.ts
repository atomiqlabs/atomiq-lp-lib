import { Request, Response } from "express";
import { ServerParamEncoder } from "./paramcoders/server/ServerParamEncoder";
export type DefinedRuntimeError = {
    code: number;
    msg?: string;
    _httpStatus?: number;
    data?: any;
};
export declare function isDefinedRuntimeError(obj: any): obj is DefinedRuntimeError;
export declare function expressHandlerWrapper(func: (req: Request, res: Response) => Promise<void>): ((req: Request, res: Response & {
    responseStream: ServerParamEncoder;
}) => void);
export type LoggerType = {
    debug: (msg: string, ...args: any[]) => void;
    info: (msg: string, ...args: any[]) => void;
    warn: (msg: string, ...args: any[]) => void;
    error: (msg: string, ...args: any[]) => void;
};
export declare function getLogger(prefix: string): LoggerType;
export declare const HEX_REGEX: RegExp;
export declare function serializeBN(bn: bigint | null): string | null;
export declare function deserializeBN(str: string | null): bigint | null;
/**
 * Creates an abort controller that extends the responseStream's abort signal
 *
 * @param responseStream
 */
export declare function getAbortController(responseStream: ServerParamEncoder): AbortController;
