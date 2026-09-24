export * from "./datatypes.js";
export * from "./destinations.js";
export * from "./transforms.js";
export * from "./detectors.js";
export * from "./extractors.js";
export * from "./ir.js";
export * from "./capabilities.js";
export * from "./compile.js";
export * from "./evidence.js";
export declare const REGISTRY_VERSIONS: {
    readonly dataTypes: "1.0.0";
    readonly destinations: "1.0.0";
    readonly detectors: "1.0.0";
    readonly transforms: "1.0.0";
    readonly extractors: "1.0.0";
};
export declare function registryPins(): {
    dataTypes: string;
    destinations: string;
    detectors: "1.0.0";
    transforms: "1.0.0";
    extractors: "1.0.0";
};
