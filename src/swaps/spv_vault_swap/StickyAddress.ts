import {StorageObject} from "@atomiqlabs/base";

export class StickyAddress implements StorageObject {

    address: string;

    constructor(addressOrSerialized: string | any) {
        if(typeof(addressOrSerialized) === "string") {
            this.address = addressOrSerialized;
        } else {
            this.address = addressOrSerialized.address;
        }
    }

    serialize(): any {
        return {
            address: this.address
        }
    }

}