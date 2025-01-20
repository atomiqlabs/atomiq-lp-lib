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
    writeParamsAndEnd(params) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.writeParams(params);
            yield this.end();
        });
    }
    getAbortSignal() {
        return this.controller.signal;
    }
}
exports.ServerParamEncoder = ServerParamEncoder;
