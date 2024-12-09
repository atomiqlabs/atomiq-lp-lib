import { StorageObject } from "@atomiqlabs/base";
import { IIntermediaryStorage, StorageQueryParam } from "../storage/IIntermediaryStorage";
import * as BN from "bn.js";
export declare class IntermediaryStorageManager<T extends StorageObject> implements IIntermediaryStorage<T> {
    private readonly directory;
    private type;
    private data;
    constructor(directory: string);
    init(): Promise<void>;
    query(params: StorageQueryParam[]): Promise<T[]>;
    getData(paymentHash: string, sequence: BN | null): Promise<T>;
    saveData(hash: string, sequence: BN | null, object: T): Promise<void>;
    removeData(hash: string, sequence: BN | null): Promise<void>;
    loadData(type: new (data: any) => T): Promise<void>;
}
