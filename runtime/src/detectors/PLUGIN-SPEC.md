# Runtime plugin contract (detectors and extractors)

Every detector or extractor is a self-contained module that implements an
interface from `@wrapbox/registry` (built at `packages/registry/dist`, linked
into `runtime/node_modules/@wrapbox/registry`). The runtime core discovers
modules through `runtime/src/detectors/index.ts` / `runtime/src/extract/index.ts`
(owned by the core; do not edit them — export from your module and report the
export name).

## Rules

1. **New files only.** A plugin adds files under `runtime/src/detectors/`,
   `runtime/src/extract/`, `runtime/src/tests/`, `runtime/scripts/`, `ops/` or
   `macos/ocr/`. It must not edit any existing file.
2. **Values never leave the detector.** A `Finding` carries a type, a count of
   DISTINCT values, a confidence, the detector id/version and an optional
   label (rule id / label name) — never the matched text. Tests must assert
   this (search the JSON of every Finding for the sample secret and fail if
   present).
3. **No policy thresholds in detectors.** Emit every hit with its count; the
   clause's `match.minCount` decides. (Bulk semantics: also emit `PII.BULK`
   when ≥ `dataTypes().defaults("PII.BULK").bulkCount` distinct PII values.)
4. **Fail closed, never throw.** `detect()` catches everything and returns
   `[]` plus sets `lastError` on the module for the core to surface; an
   extractor returns `{ ok:false, uninspectable:{state, reason} }` — never a
   silently empty unit list.
5. **Local by default.** Nothing calls an external network unless the
   descriptor says `locality: "tenant_service"` AND a tenant-configured URL
   exists in `WRAPBOX_HOME/config.json` (`services.<name>.url`) or an env var
   documented in the module header. Loopback sidecars (Tika on 127.0.0.1) are
   `local: true`.
6. **Availability is honest.** `available()` returns `{ok:false, reason}`
   when a model, index, helper binary, wasm grammar or sidecar is missing.
   The core reports that state in `wrapboxd capabilities`; a clause needing the
   type stays UNDERSTOOD_ONLY. Never pretend.
7. **Deterministic and bounded.** Cap input size (use `MAX_SCAN_BYTES` style
   constants), cap regex work (no catastrophic patterns), and time-box any
   subprocess/sidecar call.
8. **Tests run with** `cd runtime && npx tsx --test src/tests/<name>.test.ts`
   (node:test). Fixtures are generated in the test — no real personal data,
   no real secrets (use obviously fake values with the documented shapes).

## Interfaces (from `@wrapbox/registry`)

```ts
import type { DetectorImpl, DetectInput, Finding, DetectorDescriptor } from "@wrapbox/registry";
import { dataTypes, BUILTIN_DETECTORS } from "@wrapbox/registry";

// DetectInput: { text?, bytes?, format, input: "text"|"table"|"structured"|"image"|"code"|"metadata",
//                filename?, contentType?, table?: {headers, rows}, json?, metadata?: Record<string,string>, unitPath? }
// Finding:     { type, count, confidence: "low"|"medium"|"high", detector, version, label?, fields?, unitPath? }

export const detector: DetectorImpl = {
  descriptor: BUILTIN_DETECTORS.find((d) => d.id === "wrapbox.<id>")!,   // or your own DetectorDescriptor
  available() { return { ok: true }; },
  detect(input: DetectInput): Finding[] { /* … */ return []; },
};
export let lastError: string | null = null;
```

Extractors implement:

```ts
import type { ExtractorDescriptor, ExtractionResult, ContentUnit } from "@wrapbox/registry";
export interface ExtractorImpl {
  descriptor: ExtractorDescriptor;
  available(): Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string };
  /** bytes + hints → units or an explicit UNINSPECTABLE state. Must time-box. */
  extract(bytes: Buffer, hints: { filename?: string; contentType?: string; unitPath?: string; depth?: number }): Promise<ExtractionResult>;
}
```

Type ids must come from the registry (`dataTypes().has(id)`); a module that
needs a new type registers it with `dataTypes().add(...)` or `addCustom(...)`
at import time and documents it.

Report back: the module path, exported names, the descriptor id, what
`available()` depends on, and the test command + result.
