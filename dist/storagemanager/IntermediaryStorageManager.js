"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntermediaryStorageManager = void 0;
const fs = require("fs/promises");
class IntermediaryStorageManager {
    constructor(directory) {
        this.data = {};
        this.directory = directory;
    }
    async init() {
        try {
            await fs.mkdir(this.directory);
        }
        catch (e) { }
    }
    query(params) {
        return Promise.resolve(Object.keys(this.data).filter((key) => {
            const val = this.data[key];
            for (let param of params) {
                if (param.value != null) {
                    if (typeof param.value === "object") {
                        if (param.value.eq != null && !param.value.eq(val[param.key]))
                            return false;
                        if (param.value.equals != null && !param.value.equals(val[param.key]))
                            return false;
                    }
                    else {
                        if (param.value !== val[param.key])
                            return false;
                    }
                }
                else if (param.values != null) {
                    let hasSome = false;
                    for (let expectedValue of param.values) {
                        if (typeof expectedValue === "object") {
                            if (expectedValue.eq != null && !expectedValue.eq(val[param.key]))
                                hasSome = true;
                            if (expectedValue.equals != null && !expectedValue.equals(val[param.key]))
                                hasSome = true;
                        }
                        else {
                            if (expectedValue === val[param.key])
                                hasSome = true;
                        }
                    }
                    if (!hasSome)
                        return false;
                }
            }
            return true;
        }).map(key => {
            const [hash, sequenceStr] = key.split("_");
            const sequence = BigInt("0x" + sequenceStr);
            return {
                obj: this.data[key],
                hash,
                sequence
            };
        }));
    }
    getData(paymentHash, sequence) {
        return Promise.resolve(this.data[paymentHash + "_" + (sequence || 0n).toString(16).padStart(16, "0")]);
    }
    async saveData(hash, sequence, object) {
        const _sequence = (sequence || 0n).toString(16).padStart(16, "0");
        try {
            await fs.mkdir(this.directory);
        }
        catch (e) { }
        this.data[hash + "_" + _sequence] = object;
        const cpy = object.serialize();
        await fs.writeFile(this.directory + "/" + hash + "_" + _sequence + ".json", JSON.stringify(cpy));
    }
    async removeData(hash, sequence) {
        const identifier = hash + "_" + (sequence || 0n).toString(16).padStart(16, "0");
        try {
            if (this.data[identifier] != null)
                delete this.data[identifier];
            await fs.rm(this.directory + "/" + identifier + ".json");
        }
        catch (e) {
            console.error(e);
        }
    }
    async loadData(type) {
        this.type = type;
        let files;
        try {
            files = await fs.readdir(this.directory);
        }
        catch (e) {
            console.error(e);
            return;
        }
        for (let file of files) {
            const indentifier = file.split(".")[0];
            const result = await fs.readFile(this.directory + "/" + file);
            const obj = JSON.parse(result.toString());
            const parsed = new type(obj);
            this.data[indentifier] = parsed;
        }
    }
}
exports.IntermediaryStorageManager = IntermediaryStorageManager;
