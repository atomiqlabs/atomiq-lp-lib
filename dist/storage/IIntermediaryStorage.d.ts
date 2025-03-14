import { StorageObject } from "@atomiqlabs/base";
export type StorageQueryParam = {
    key: string;
    value?: any;
    values?: any[];
};
export interface IIntermediaryStorage<T extends StorageObject> {
    init(): Promise<void>;
    query(params: StorageQueryParam[]): Promise<{
        hash: string;
        sequence: bigint;
        obj: T;
    }[]>;
    getData(hash: string, sequence: bigint | null): Promise<T>;
    saveData(hash: string, sequence: bigint | null, object: T): Promise<void>;
    removeData(hash: string, sequence: bigint | null): Promise<void>;
    loadData(type: new (data: any) => T): Promise<void>;
}
