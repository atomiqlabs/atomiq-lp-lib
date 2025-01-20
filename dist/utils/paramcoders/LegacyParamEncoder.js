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
exports.LegacyParamEncoder = void 0;
class LegacyParamEncoder {
    constructor(write, end) {
        this.obj = {};
        this.writeFN = write;
        this.endFN = end;
    }
    writeParams(data) {
        for (let key in data) {
            if (this.obj[key] == null)
                this.obj[key] = data[key];
        }
        return Promise.resolve();
    }
    end() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.writeFN(Buffer.from(JSON.stringify(this.obj)));
            yield this.endFN();
        });
    }
}
exports.LegacyParamEncoder = LegacyParamEncoder;
