"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerParamEncoder = void 0;
const ParamEncoder_1 = require("../ParamEncoder");
const LegacyParamEncoder_1 = require("../LegacyParamEncoder");
class ServerParamEncoder {
    constructor(response, statusCode, request) {
        const legacy = !request.headers['accept'].includes("application/x-multiple-json");
        let requestEnd = false;
        let responseShouldEnd = false;
        request.on("end", () => {
            requestEnd = true;
            if (responseShouldEnd && requestEnd)
                response.end();
        });
        const onEnd = () => {
            responseShouldEnd = true;
            if (responseShouldEnd && requestEnd)
                return new Promise(resolve => response.end(() => resolve()));
            return Promise.resolve();
        };
        const onWrite = (data) => {
            if (responseShouldEnd)
                return Promise.resolve();
            if (firstWrite) {
                response.writeHead(statusCode);
                firstWrite = false;
            }
            return new Promise((resolve, reject) => response.write(data, (error) => {
                if (error != null) {
                    reject(error);
                    return;
                }
                resolve();
            }));
        };
        let firstWrite = false;
        if (legacy) {
            response.header("Content-Type", "application/json");
            this.paramWriter = new LegacyParamEncoder_1.LegacyParamEncoder(onWrite, onEnd);
        }
        else {
            response.header("Content-Type", "application/x-multiple-json");
            this.paramWriter = new ParamEncoder_1.ParamEncoder(onWrite, onEnd);
        }
        this.response = response;
        this.controller = new AbortController();
        this.response.on("close", () => this.controller.abort(new Error("Response stream closed!")));
        this.response.on("error", (err) => this.controller.abort(err));
    }
    writeParams(params) {
        return this.paramWriter.writeParams(params);
    }
    end() {
        return this.paramWriter.end();
    }
    async writeParamsAndEnd(params) {
        await this.writeParams(params);
        await this.end();
    }
    getAbortSignal() {
        return this.controller.signal;
    }
}
exports.ServerParamEncoder = ServerParamEncoder;
