import { Request, Response } from "express";
import { ServerParamEncoder } from "./paramcoders/server/ServerParamEncoder";
import { Transaction } from "@scure/btc-signer";
import { BtcTx } from "@atomiqlabs/base";
export type LoggerType = {
    debug: (msg: string, ...args: any[]) => void;
    info: (msg: string, ...args: any[]) => void;
    warn: (msg: string, ...args: any[]) => void;
    error: (msg: string, ...args: any[]) => void;
};
export declare function getLogger(prefix: string | (() => string)): LoggerType;
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
export declare const HEX_REGEX: RegExp;
export declare function serializeBN(bn: bigint | null): string | null;
export declare function deserializeBN(str: string | null): bigint | null;
export declare function bigIntSorter(a: bigint, b: bigint): -1 | 0 | 1;
/**
 * Creates an abort controller that extends the responseStream's abort signal
 *
 * @param responseStream
 */
export declare function getAbortController(responseStream: ServerParamEncoder): AbortController;
export declare function parsePsbt(btcTx: Transaction): BtcTx;
/**
 * Returns the minimum Bitcoin block window (in blocks) for which a "fast blocks" safety
 * factor is genuinely usable: the probability that N consecutive blocks are produced
 * with an average interval below (blocktime / safetyFactor) is less than `probability`.
 *
 * Model: block arrivals are a Poisson process (i.i.d. exponential intervals), so the
 * production time of N blocks is Erlang/Gamma(shape=N). A Chernoff (Cramer) bound on
 * the lower tail gives the per-block large-deviation rate I(S) = ln(S) + 1/S - 1, i.e.
 *     P(N blocks faster than blocktime/S on average) <= exp(-N * I(S))
 * which this function inverts for N. Conservative: the exact Erlang CDF already
 * satisfies the bound ~25% earlier. Use for the fast-block tail (e.g. incoming LN
 * HTLC expiry racing an escrow claim window).
 *
 * @param {number|bigint} safetyFactor Assumed max block-speed multiplier (must be > 1)
 * @param {number} [probability=0.0001] Tolerated failure probability (default 0.01%)
 * @returns {number} Minimum safe block window in blocks
 */
export declare function getMinSafeBlockWindowFast(safetyFactor: number | bigint, probability?: number): bigint;
/**
 * Slow-tail mirror of getMinSafeBlockWindowFast(): returns the minimum block window
 * (in blocks) for which a "slow blocks" safety factor is genuinely usable: the
 * probability that N consecutive blocks take LONGER than N * blocktime * safetyFactor
 * is less than `probability`. Chernoff bound on the upper Erlang tail gives the rate
 * I(S) = S - 1 - ln(S). Use when converting a wall-clock deadline into a block count
 * (e.g. payout/claim timeouts that must expire before some real-world time even if
 * blocks come slowly).
 *
 * @param {number|bigint} safetyFactor Assumed max block-slowness multiplier (must be > 1)
 * @param {number} [probability=0.0001] Tolerated failure probability (default 0.01%)
 * @returns {number} Minimum safe block window in blocks
 */
export declare function getMinSafeBlockWindowSlow(safetyFactor: bigint | number, probability?: number): bigint;
export declare function bigIntMax(a: bigint, b: bigint): bigint;
