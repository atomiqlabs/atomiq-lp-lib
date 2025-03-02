"use strict";
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
    async end() {
        await this.writeFN(Buffer.from(JSON.stringify(this.obj)));
        await this.endFN();
    }
}
exports.LegacyParamEncoder = LegacyParamEncoder;
