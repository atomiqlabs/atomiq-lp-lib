import {Express} from "express";
import {MultichainData, SwapHandler, SwapHandlerInfoType, SwapHandlerType} from "../swaps/SwapHandler";
import * as express from "express";

const HEX_REGEX = /[0-9a-f]+/i;

type InfoHandlerResponseEnvelope = {
    nonce: string,
    services: {
        [key in SwapHandlerType]?: SwapHandlerInfoType
    }
};

type InfoHandlerResponse = {
    envelope: string,
    chains: {
        [chainIdentifier: string]: {
            address: string,
            signature: string
        }
    }
}

/**
 * Handles info requests to POST /info returning information about fees, swap params, etc.
 */
export class InfoHandler {

    readonly chainData: MultichainData;
    readonly path: string;

    readonly swapHandlers: SwapHandler[];

    constructor(chainData: MultichainData, path: string, swapHandlers: SwapHandler[]) {
        this.chainData = chainData;
        this.path = path;
        this.swapHandlers = swapHandlers;
    }

    /**
     * Adds a listener to POST /info
     *
     * @param restServer
     */
    startRestServer(restServer: Express) {

        const infoHandler = async (req, res) => {
            const reqParams = {...req.body, ...req.query};

            if (
                reqParams.nonce == null ||
                typeof(reqParams.nonce) !== "string" ||
                reqParams.nonce.length>64 ||
                !HEX_REGEX.test(reqParams.nonce)
            ) {
                res.status(400).json({
                    msg: "Invalid request body (nonce)"
                });
                return;
            }

            const env: InfoHandlerResponseEnvelope = {
                nonce: reqParams.nonce,
                services: {}
            };

            for(let swapHandler of this.swapHandlers) {
                env.services[swapHandler.type] = swapHandler.getInfo();
            }

            const envelope = JSON.stringify(env);
            const envelopeBuffer = Buffer.from(envelope);

            const chains: {
                [chainIdentifier: string]: {
                    address: string,
                    signature: string
                }
            } = {};
            for(let chainIdentifier in this.chainData.chains) {
                const singleChain = this.chainData.chains[chainIdentifier];
                chains[chainIdentifier] = {
                    address: singleChain.signer.getAddress(),
                    signature: await singleChain.swapContract.getDataSignature(singleChain.signer, envelopeBuffer)
                };
            }

            const response: InfoHandlerResponse = {
                envelope,
                chains
            };

            res.status(200).json(response);
        };

        restServer.use(this.path+"/info", express.json());
        restServer.post(this.path+"/info", infoHandler);
        restServer.get(this.path+"/info", infoHandler);

    }


}
