import { TransactionInput } from "@scure/btc-signer/psbt";
import { BitcoinRpc, BtcTx } from "@atomiqlabs/base";
export declare function isLegacyInput(input: TransactionInput): boolean;
export declare function checkTransactionReplaced(txId: string, txRaw: string, bitcoin: BitcoinRpc<any>): Promise<BtcTx>;
