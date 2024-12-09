/// <reference types="node" />
import { IParamWriter } from "./IParamWriter";
export declare class LegacyParamEncoder implements IParamWriter {
    private readonly writeFN;
    private readonly endFN;
    private obj;
    constructor(write: (data: Buffer) => Promise<void>, end: () => Promise<void>);
    writeParams(data: any): Promise<void>;
    end(): Promise<void>;
}
