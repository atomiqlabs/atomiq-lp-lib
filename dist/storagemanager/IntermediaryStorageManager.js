"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntermediaryStorageManager = void 0;
const fs = require("fs/promises");
const BN = require("bn.js");
class IntermediaryStorageManager {
    constructor(directory) {
        this.data = {};
        this.directory = directory;
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield fs.mkdir(this.directory);
            }
            catch (e) { }
        });
    }
    query(params) {
        return Promise.resolve(Object.keys(this.data).map((val) => this.data[val]).filter((val) => {
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
        }));
    }
    getData(paymentHash, sequence) {
        return Promise.resolve(this.data[paymentHash + "_" + (sequence || new BN(0)).toString("hex", 8)]);
    }
    saveData(hash, sequence, object) {
        return __awaiter(this, void 0, void 0, function* () {
            const _sequence = (sequence || new BN(0)).toString("hex", 8);
            try {
                yield fs.mkdir(this.directory);
            }
            catch (e) { }
            this.data[hash + "_" + _sequence] = object;
            const cpy = object.serialize();
            yield fs.writeFile(this.directory + "/" + hash + "_" + _sequence + ".json", JSON.stringify(cpy));
        });
    }
    removeData(hash, sequence) {
        return __awaiter(this, void 0, void 0, function* () {
            const identifier = hash + "_" + (sequence || new BN(0)).toString("hex", 8);
            try {
                if (this.data[identifier] != null)
                    delete this.data[identifier];
                yield fs.rm(this.directory + "/" + identifier + ".json");
            }
            catch (e) {
                console.error(e);
            }
        });
    }
    loadData(type) {
        return __awaiter(this, void 0, void 0, function* () {
            this.type = type;
            let files;
            try {
                files = yield fs.readdir(this.directory);
            }
            catch (e) {
                console.error(e);
                return;
            }
            for (let file of files) {
                const indentifier = file.split(".")[0];
                const result = yield fs.readFile(this.directory + "/" + file);
                const obj = JSON.parse(result.toString());
                const parsed = new type(obj);
                this.data[indentifier] = parsed;
            }
        });
    }
}
exports.IntermediaryStorageManager = IntermediaryStorageManager;
