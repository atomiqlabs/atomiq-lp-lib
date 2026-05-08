import { StorageObject } from "@atomiqlabs/base";
export declare class StickyAddress implements StorageObject {
    address: string;
    constructor(addressOrSerialized: string | any);
    serialize(): any;
}
