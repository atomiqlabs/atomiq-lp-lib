export interface IBtcFeeEstimator {
    estimateFee(): Promise<number | null>;
}
