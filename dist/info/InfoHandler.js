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
exports.InfoHandler = void 0;
const express = require("express");
const HEX_REGEX = /[0-9a-f]+/i;
/**
 * Handles info requests to POST /info returning information about fees, swap params, etc.
 */
class InfoHandler {
    constructor(chainData, path, swapHandlers) {
        this.chainData = chainData;
        this.path = path;
        this.swapHandlers = swapHandlers;
    }
    /**
     * Adds a listener to POST /info
     *
     * @param restServer
     */
    startRestServer(restServer) {
        restServer.use(this.path + "/info", express.json());
        restServer.post(this.path + "/info", (req, res) => __awaiter(this, void 0, void 0, function* () {
            if (req.body == null ||
                req.body.nonce == null ||
                typeof (req.body.nonce) !== "string" ||
                req.body.nonce.length > 64 ||
                !HEX_REGEX.test(req.body.nonce)) {
                res.status(400).json({
                    msg: "Invalid request body (nonce)"
                });
                return;
            }
            const env = {
                nonce: req.body.nonce,
                services: {}
            };
            for (let swapHandler of this.swapHandlers) {
                env.services[swapHandler.type] = swapHandler.getInfo();
            }
            const envelope = JSON.stringify(env);
            const envelopeBuffer = Buffer.from(envelope);
            const chains = {};
            for (let chainIdentifier in this.chainData.chains) {
                const singleChain = this.chainData.chains[chainIdentifier];
                chains[chainIdentifier] = {
                    address: singleChain.signer.getAddress(),
                    signature: yield singleChain.swapContract.getDataSignature(singleChain.signer, envelopeBuffer)
                };
            }
            const defaults = chains[this.chainData.default];
            const response = {
                envelope,
                address: defaults.address,
                signature: defaults.signature,
                chains
            };
            res.status(200).json(response);
        }));
    }
}
exports.InfoHandler = InfoHandler;
