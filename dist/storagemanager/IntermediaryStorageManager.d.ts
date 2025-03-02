import { StorageObject } from "@atomiqlabs/base";
import { IIntermediaryStorage, StorageQueryParam } from "../storage/IIntermediaryStorage";
export declare class IntermediaryStorageManager<T extends StorageObject> implements IIntermediaryStorage<T> {
    private readonly directory;
    private type;
    private data;
    constructor(directory: string);
    init(): Promise<void>;
    query(params: StorageQueryParam[]): Promise<{
        hash: string;
        sequence: bigint;
        obj: T;
    }[]>;
    getData(paymentHash: string, sequence: bigint | null): Promise<T>;
    saveData(hash: string, sequence: bigint | null, object: T): Promise<void>;
    removeData(hash: string, sequence: bigint | null): Promise<void>;
    loadData(type: new (data: any) => T): Promise<void>;
}
