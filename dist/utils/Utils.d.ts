import { Request, Response } from "express";
import { ServerParamEncoder } from "./paramcoders/server/ServerParamEncoder";
import * as BN from "bn.js";
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
export declare function getLogger(prefix: string): {
    debug: (msg: any, ...args: any[]) => void;
    info: (msg: any, ...args: any[]) => void;
    warn: (msg: any, ...args: any[]) => void;
    error: (msg: any, ...args: any[]) => void;
};
export declare const HEX_REGEX: RegExp;
export declare function serializeBN(bn: BN | null): string | null;
export declare function deserializeBN(str: string | null): BN | null;
