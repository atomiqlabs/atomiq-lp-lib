"use strict";
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
        const infoHandler = async (req, res) => {
            const reqParams = { ...req.body, ...req.query };
            if (reqParams.nonce == null ||
                typeof (reqParams.nonce) !== "string" ||
                reqParams.nonce.length > 64 ||
                !HEX_REGEX.test(reqParams.nonce)) {
                res.status(400).json({
                    msg: "Invalid request body (nonce)"
                });
                return;
            }
            const env = {
                nonce: reqParams.nonce,
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
                    signature: await singleChain.swapContract.getDataSignature(singleChain.signer, envelopeBuffer)
                };
            }
            const response = {
                envelope,
                chains
            };
            res.status(200).json(response);
        };
        restServer.use(this.path + "/info", express.json());
        restServer.post(this.path + "/info", infoHandler);
        restServer.get(this.path + "/info", infoHandler);
    }
}
exports.InfoHandler = InfoHandler;
