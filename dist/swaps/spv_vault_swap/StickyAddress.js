"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StickyAddress = void 0;
class StickyAddress {
    constructor(addressOrSerialized) {
        if (typeof (addressOrSerialized) === "string") {
            this.address = addressOrSerialized;
        }
        else {
            this.address = addressOrSerialized.address;
        }
    }
    serialize() {
        return {
            address: this.address
        };
    }
}
exports.StickyAddress = StickyAddress;
