"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParamEncoder = void 0;
class ParamEncoder {
    constructor(write, end) {
        this.writeFN = write;
        this.endFN = end;
    }
    writeParams(data) {
        const serialized = Buffer.from(JSON.stringify(data));
        const frameLengthBuffer = Buffer.alloc(4);
        frameLengthBuffer.writeUint32LE(serialized.length);
        return this.writeFN(Buffer.concat([
            frameLengthBuffer,
            serialized
        ]));
    }
    end() {
        return this.endFN();
    }
}
exports.ParamEncoder = ParamEncoder;
