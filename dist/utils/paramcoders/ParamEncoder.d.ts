/// <reference types="node" />
import { IParamWriter } from "./IParamWriter";
export declare class ParamEncoder implements IParamWriter {
    private readonly writeFN;
    private readonly endFN;
    constructor(write: (data: Buffer) => Promise<void>, end: () => Promise<void>);
    writeParams(data: any): Promise<void>;
    end(): Promise<void>;
}
