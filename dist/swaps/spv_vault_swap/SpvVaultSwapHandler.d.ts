import { SwapBaseConfig } from "../SwapHandler";
export type SpvVaultSwapHandlerConfig = SwapBaseConfig & {
    vaultsCheckInterval: number;
    gasTokenMax: bigint;
};
export type SpvVaultSwapRequestType = {
    address: string;
    amount: bigint;
    token: string;
    gasAmount: bigint;
    gasToken: string;
    exactOut?: boolean;
};
export type SpvVaultPostQuote = {
    quoteId: string;
    psbtHex: string;
};
