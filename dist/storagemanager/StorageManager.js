"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageManager = void 0;
const fs = require("fs/promises");
class StorageManager {
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
    async saveData(hash, object) {
        try {
            await fs.mkdir(this.directory);
        }
        catch (e) { }
        this.data[hash] = object;
        const cpy = object.serialize();
        await fs.writeFile(this.directory + "/" + hash + ".json", JSON.stringify(cpy));
    }
    async removeData(hash) {
        const paymentHash = hash;
        try {
            if (this.data[paymentHash] != null)
                delete this.data[paymentHash];
            await fs.rm(this.directory + "/" + paymentHash + ".json");
        }
        catch (e) {
            console.error(e);
        }
    }
    async loadData(type) {
        let files;
        try {
            files = await fs.readdir(this.directory);
        }
        catch (e) {
            console.error(e);
            return [];
        }
        const arr = [];
        for (let file of files) {
            const paymentHash = file.split(".")[0];
            const result = await fs.readFile(this.directory + "/" + file);
            const obj = JSON.parse(result.toString());
            const parsed = new type(obj);
            arr.push(parsed);
            this.data[paymentHash] = parsed;
        }
        return arr;
    }
}
exports.StorageManager = StorageManager;
