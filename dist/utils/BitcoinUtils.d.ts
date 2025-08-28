import { TransactionInput } from "@scure/btc-signer/psbt";
import { BitcoinRpc, BtcTx } from "@atomiqlabs/base";
import { IBitcoinWallet } from "../wallets/IBitcoinWallet";
export declare function isLegacyInput(input: TransactionInput): boolean;
export declare function checkTransactionReplaced(txId: string, txRaw: string, bitcoin: IBitcoinWallet): Promise<BtcTx>;
export declare function checkTransactionReplacedRpc(txId: string, txRaw: string, bitcoin: BitcoinRpc<any>): Promise<BtcTx>;
