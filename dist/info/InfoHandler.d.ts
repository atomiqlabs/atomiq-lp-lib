import { Express } from "express";
import { MultichainData, SwapHandler } from "../swaps/SwapHandler";
/**
 * Handles info requests to POST /info returning information about fees, swap params, etc.
 */
export declare class InfoHandler {
    readonly chainData: MultichainData;
    readonly path: string;
    readonly swapHandlers: SwapHandler[];
    constructor(chainData: MultichainData, path: string, swapHandlers: SwapHandler[]);
    /**
     * Adds a listener to POST /info
     *
     * @param restServer
     */
    startRestServer(restServer: Express): void;
}
