import { ISwapPrice } from "../../prices/ISwapPrice";
export type AmountAssertionsConfig = {
    min: bigint;
    max: bigint;
    baseFee: bigint;
    feePPM: bigint;
};
export declare abstract class AmountAssertions {
    readonly config: AmountAssertionsConfig;
    readonly swapPricing: ISwapPrice;
    constructor(config: AmountAssertionsConfig, swapPricing: ISwapPrice);
    /**
     * Checks whether the bitcoin amount is within specified min/max bounds
     *
     * @param amount
     * @protected
     * @throws {DefinedRuntimeError} will throw an error if the amount is outside minimum/maximum bounds
     */
    protected checkBtcAmountInBounds(amount: bigint): void;
    /**
     * Handles and throws plugin errors
     *
     * @param res Response as returned from the PluginManager.onHandlePost{To,From}BtcQuote
     * @protected
     * @throws {DefinedRuntimeError} will throw an error if the response is an error
     */
    static handlePluginErrorResponses(res: any): void;
}
