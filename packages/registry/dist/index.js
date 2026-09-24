export * from "./datatypes.js";
export * from "./destinations.js";
export * from "./transforms.js";
export * from "./detectors.js";
export * from "./extractors.js";
export * from "./ir.js";
export * from "./capabilities.js";
export * from "./compile.js";
export * from "./evidence.js";
import { dataTypes } from "./datatypes.js";
import { destinations } from "./destinations.js";
import { detectorRegistry } from "./detectors.js";
import { extractorRegistry } from "./extractors.js";
export const REGISTRY_VERSIONS = {
    dataTypes: "1.0.0",
    destinations: "1.0.0",
    detectors: "1.0.0",
    transforms: "1.0.0",
    extractors: "1.0.0",
};
export function registryPins() {
    return {
        dataTypes: dataTypes().version,
        destinations: destinations().version,
        detectors: REGISTRY_VERSIONS.detectors,
        transforms: REGISTRY_VERSIONS.transforms,
        extractors: REGISTRY_VERSIONS.extractors,
    };
}
// Ensure the default registries are constructed once at import.
void detectorRegistry();
void extractorRegistry();
