import { Request, Response } from "express";
export declare class RequestTimeoutError extends Error {
    constructor();
}
export declare class RequestParsingError extends Error {
    constructor();
}
export declare const serverParamDecoder: (timeoutMillis: number) => (req: Request, res: Response, next: () => void) => void;
