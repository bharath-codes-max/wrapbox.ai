# Wrapbox Intent-Contract Enforcement — architecture audit and gap analysis

**Date:** 2026-09-24 · **Scope:** `api/compile-intent.ts`, `src/lib/intent/*`, `runtime/src/*`, `packages/policy-core`, `control-plane/src/routes/*`, `macos/*` · **Status:** analysis only, no code changed.

**Method.** Every claim below was checked against the code at the cited line by me and by an independent verifier pass (five subsystem readers → per-claim adversarial verification → official-docs research). Findings that did not survive verification are listed in Appendix C so nothing is silently dropped. Reference-architecture facts carry the URL that was actually read.

---

## 0. One-paragraph verdict

Wrapbox already has the *right skeleton*: a normalized clause model, a capability registry that derives ENFORCED / DEGRADED / UNDERSTOOD_ONLY / PENDING mechanically, a runtime self-description, a parser registry that fails closed on formats it cannot read, a transform layer that refuses to forward when it cannot mask, and signed, chained evidence. What it does **not** have is a *data-type registry*: the meaning of "protected data" is spread across five closed lists that must be edited in lock-step (the LLM prompt, `CLASS_BRIDGE`, `classFamily()`, `RUNTIME_CONTENT_KINDS`/`SECRET_PATTERNS`/`PII_PATTERNS`, and `TokenKind`). Detection thresholds live inside detectors, not in policy. Destinations resolve to a closed vendor catalogue, so "any external AI" under-covers for protections. And a protected concept the runtime cannot detect is reported honestly in the UI but, at runtime, falls through to the contract's catch-all ALLOW — the one behaviour the target architecture forbids. Two transport-level bypasses compound this: a hidden never-decrypt host list that happens to cover `copilot.microsoft.com`, and WebSocket upgrades that are joined uninspected. The fix is not a rewrite: keep the policy core, the daemon, the Network Extension and the evidence chain; introduce a Policy IR + Data Type Registry + Destination Registry as the *single* source of vocabulary, move thresholds into the IR, add an activation invariant that no protection can be silently unenforced, and put heavy extraction/NER/OCR behind an isolated inspection service.

---

## 1. What Wrapbox already supports (verified)

| Area | What exists | Where |
|---|---|---|
| Intent → clauses | LLM segmenter (OpenAI, JSON mode) emits `definition` / `invariant` / `clause` statements; deterministic fallback segmenter when no key | `api/compile-intent.ts:26-142`, `src/lib/intent/author.ts:36-59` |
| Deterministic validation | Closed vocabularies for verbs, resource types, decisions; alias tables; negation resolved into decision; thresholds → match predicates; catch-all recognised by shape; dedup with provenance; approver gate blocks activation | `src/lib/intent/validate.ts` (905 lines), `schema.ts:59-95` |
| Authority lattice | `ALLOW < CONSTRAIN < REVIEW < BLOCK`; priority = severity tier (100/200/300/400) + specificity, so a BLOCK can never be shadowed by an ALLOW | `validate.ts:888-905` |
| Capability registry | Per-clause requirements (`observe.*`, `content.<family>`, `transform.<handler>`, `review.hold`, `identity.*`) derived from the clause; status derived by `deriveStatus()` with no per-concept branches; `effectiveDecision ≤ declared` | `src/lib/intent/capabilities.ts:100-300` |
| Runtime self-description | `wrapboxd capabilities` assembles observes / classifiers / parsers / handlers / identity signals from the real modules; a mirror + drift-guard on the compiler side | `runtime/src/capabilities.ts`, `src/lib/intent/runtime.ts`, `regression/runtime.capabilities.json` |
| Detector registry (compiler side) | `ContentDetector` interface with classes, MIME types, `local` flag; families: pii, secret, source_code, credential_file, financial, phi, legal, confidential | `src/lib/intent/detectors.ts` |
| Runtime detectors | 12 prefix-anchored secret regexes with validate hooks; 4 PII patterns (email, phone, Aadhaar, card+Luhn); source-code heuristic score; credential-file names; multi-signal framework (≥2 signal groups) for financial/PHI/legal/confidential with confidence | `runtime/src/classify.ts:137-152, 213-244, 172-190`, `classifiers.ts` |
| Parser registry | text, json, csv/tsv, yaml, xml, html, multipart, docx, xlsx (bounded zip reader, ratio/entry/depth limits); pdf declared non-inspectable; pptx/zip → opaque; format sniffed by magic for PDF/ZIP, JSON by parsing, CSV by delimiter agreement | `runtime/src/parsers.ts:244-300`, `structured.ts:45-70` |
| Fail-closed inspection gate | Uninspectable body → engine is asked the worst case (all kinds present); if any protection would fire → BLOCK | `runtime/src/proxy.ts:263-283` |
| Transform | `reversible_tokenize` and `redact` over CSV/TSV/JSON/text; per-column and per-class; token-lookalike neutralisation; response de-tokenisation; refuses to forward on any failure | `runtime/src/transform.ts`, `mitm.ts:320-349` |
| Policy core | First-match by priority, `block` on no match, string/regex/numeric ops, `constrain` carries its constraint | `packages/policy-core/src/index.ts:181-206` |
| Evidence | Ed25519-signed, hash-chained receipts; `constrain` distinct from `allow`; CP re-verifies chain; labels and counts only, never values | `runtime/src/receipts.ts`, `control-plane/src/routes/evidence.ts` |
| Enforcement path | macOS Network Extension routes TCP/443 to the daemon; QUIC dropped; daemon terminates TLS with the Wrapbox CA; loop-guard by audit token | `macos/*` (Network MVP, complete) |
| Suite status (run 2026-09-24, unchanged code) | compiler regression: all categories pass (302 cases); `properties.ts`: **PASS 5916 / FAIL 0**; `runtime/src/selfcheck.ts`: **PASS 59 / FAIL 0**; macOS suites: all pass. Note: green suites and the gaps in §3 coexist because the suites encode today's thresholds and catalogues as *expected* behaviour | — |
| Tests | 302-case regression corpus (surface → expected clauses/status/predicates); `properties.ts` asserts 10 laws / 14 checks (no fake enforcement, CONSTRAIN never→ALLOW, monotonicity, drift guards, …); `runtime/src/selfcheck.ts` is a zero-framework parser→detector→transform suite (59 checks, run via `npx tsx`, not wired into a `package.json` test script); macOS unit suites | `src/lib/intent/regression/*`, `runtime/src/selfcheck.ts`, `macos/Tests` |

---

## 2. Every hard-coded assumption found

Numbered for cross-reference. "Vocabulary" = a closed list that decides meaning.

| # | Assumption | Where | Why it matters |
|---|---|---|---|
| H1 | Data classes are enumerated **in the LLM prompt text**, not in a schema | `api/compile-intent.ts:82-84, 136-144` | A new class (e.g. `EMPLOYEE_ID`) is only ever a free string; nothing constrains or registers it |
| H2 | OpenAI call uses `response_format: {type:"json_object"}` (JSON mode), not Structured Outputs `json_schema` + `strict:true` | `api/compile-intent.ts:190` | Shape errors are caught post-hoc; enums (verbs, decisions) are not enforced by the model API |
| H3 | `CLASS_BRIDGE`: 54 synonyms (23 pii, 21 secret, 4 source_code, 6 credential_file) → 4 coarse kinds | `src/lib/intent/runtime.ts:100-117` | Sub-types collapse: `card`, `ssn`, `account_number`, `dob` all become `pii`; a rule cannot say "cards but not emails" |
| H4 | `classFamily()` EXT table of ~20 enterprise families; `KNOWN_FAMILIES` set | `capabilities.ts:169-178, 215-219` | Second copy of the taxonomy; an unknown class becomes its own (normalised) family string |
| H5 | Only the `pii` family is "maskable" (`anyMaskable = bridgeClass(c) === "pii"`), after the plane-implements-handler check | `resolve.ts:288-301` | Transform support is inferred from family, not from a transform registry |
| H6 | `RUNTIME_CONTENT_KINDS` fixed at 4 + registered families; `TokenKind` fixed at 11; `KNOWN_KINDS` list in transform | `classify.ts:35-38`, `tokenize.ts:35-47`, `transform.ts:39` | Third and fourth copies of the taxonomy; a new type needs edits in ≥3 runtime files |
| H7 | `SECRET_PATTERNS`: 11 regexes (private_key, aws_access_key, github_token, slack_token, openai_key, anthropic_key, google_api_key, stripe_key, jwt, bearer_token, assigned_secret); no entropy detector anywhere in `runtime/src` (a comment explains why one was avoided) | `classify.ts:137-152` | Azure/GCP/Twilio/SendGrid/DB connection strings/PuTTY keys/etc. are invisible |
| H8 | PII thresholds inside detectors, counted over *distinct normalised* values: emails `min:5`, phones `min:5`, Aadhaar `min:3`, cards `min:1` (Luhn) | `classify.ts:213-242, 347-350` | Policy cannot say "any single customer email"; 1–4 emails are never a finding |
| H9 | Source code = weighted keyword signals with threshold 5; a filename matching `CODE_EXTENSIONS` (which includes `json/yaml/yml/toml`) adds +4, so one more weight-1 signal (even a `#` comment line) tips a config file into `source_code` | `classify.ts:172-190, 332-337` | Config files read as "source code"; short snippets/renamed files can miss |
| H10 | Format detection trusts `content-type`/extension for html/xml/yaml; magic only for PDF/ZIP | `parsers.ts:274-296` | Fine for detection (fallback is text scan) but a lie for *transform* (text transform applied to HTML) |
| H11 | Parser formats closed: no pptx, pdf, rtf, odt, eml/msg, images, generic archives (tar/7z/rar), nested archive depth only for Office | `parsers.ts:244-260` | Everything else is UNINSPECTABLE → blocked only where a protection *could* apply |
| H12 | `DESTINATION` categories closed: `external_ai` (9 ids), `model_provider`, `saas`; 14 seeded services; `bing.com` inside "Microsoft Copilot" | `destinations.ts:41-71` | "Any external AI" = 9 vendors; `bing.com` (a search engine) inherits Copilot permissions |
| H13 | Admin-added services/groups persist in **browser `localStorage`** (`wbx-destination-registry`); contract groups live in a module variable per session; the seed stays in code | `destinations.ts:86-121` | Not tenant-shared, not on the control plane, differs per admin browser |
| H14 | Compiled predicates use `contains` on a comma-joined array (`String(["pii","secret"])`) | `policy-core/index.ts:110-118`, `resolve.ts:230` | Substring semantics: a future kind `ip` matches a body containing only `pii` |
| H15 | Priority tiers fixed 100/200/300/400 + specificity ≤99 | `validate.ts:888-905` | By design (authority lattice) — but there is no way to express an admin-authorised *exception* below a protection |
| H16 | `MAX_INSPECT_BYTES = 64 MiB`, `MAX_SCAN_BYTES = 4 MiB`, archive limits constants | `mitm.ts:41`, `classify.ts:24`, `parsers.ts:60-72` | Reasonable, but not tenant-configurable and not in the capability description |
| H17 | Token vault persisted as **plaintext JSONL** (0600) at `token-vault.jsonl`; each flush rewrites the whole file | `tokenize.ts:73, 120-132` | The values the feature exists to protect sit unencrypted on disk |
| H18 | `canAllowOrdinaryTraffic()` refuses *system-proxy takeover* (`--protect-network` mode only; the 127.0.0.1:4180 proxy keeps running) unless a broad ALLOW/CONSTRAIN exists | `runtime/src/policy.ts:103-111`, `commands/daemon.ts:193` | Pushes every contract toward a catch-all ALLOW (usability guard, but it institutionalises the fail-open default) |
| H19 | Subject identity: only `identity.device` / `identity.workload` proven; user/group never | `runtime/src/capabilities.ts:93-96` | Every "employees may…" clause is DEGRADED to whole-device |
| H20 | Network plane captures TCP/443 only (daemon's own egress bypassed for loop prevention; UDP/443 dropped; everything else bypassed) | `macos/Shared/FlowPolicy.swift:32-61` | HTTPS on non-443 ports and plain HTTP are unobserved; the compiler's "enforced" does not know this |
| H21 | Evidence receipt carries `reason` text + `tool_input_sha256` (an opaque digest over the ToolCall); no detector ids/versions/confidence/counts as fields | `receipts.ts:13-48, 96-140` | Auditors cannot reconstruct *which detector at which version* made the call |
| H22 | Invariants recognised: 3 (`fail_closed_transform`, `fail_closed_no_rule`, `fail_closed_uninspected`); the contract sentence mapped only to `fail_closed_transform` | `schema.ts:285-294`, LLM output | The "cannot be safely inspected" half of the admin's sentence was not captured as `fail_closed_uninspected` (the runtime gate happens to implement it anyway) |
| H23 | `DEFAULT_NO_INSPECT`: a built-in list of hosts the daemon never decrypts (banks, payment, `health.`, payroll/HR, **`microsoft.com`**, `apple.com`, OCSP/CRL, localhost); for these the decision is host-only (`network.connect`) | `runtime/src/mitm.ts:44-70`, `proxy.ts:108-150, 665` | Right for pinning/privacy, but it is a *policy* list hidden in code and unknown to the coverage system |

---

## 3. Current silent-allow / fail-open gaps

Severity: **C** = protected data leaves unchanged while the UI says enforced; **H** = protected data leaves while the UI says understood/degraded; **M** = over-blocking or evidence weakness.

| # | Gap | Sev | Evidence | Reproduced |
|---|---|---|---|---|
| G1 | **Sub-threshold PII is invisible.** A CONSTRAIN "customer email/phone must be tokenized" is ENFORCED, yet 1–4 distinct emails/phones produce no `pii` kind (a Luhn-valid card or 3 Aadhaar numbers would) → catch-all ALLOW forwards them unchanged | **C** | H8; `proxy.ts:236-262` evaluates on `content_kinds`; dry-run: 1 email+phone → ALLOW, 5 → CONSTRAIN | yes (2026-09-24 dry-run) |
| G2 | **Uncatalogued AI service escapes protections.** BLOCK "credentials to any external AI" resolves `external_ai` to 9 vendors; a new AI host is not in the set → catch-all ALLOW | **C** | `resolve-dest.ts:80-84` (category over-covers only when a complement is stated) | reasoning + regex inspection |
| G3 | **Understood-only protection + catch-all ALLOW = silent allow.** Any clause whose data class has no detector (trade secrets, M&A, employee IDs, "Highly Confidential" label…) emits no rule (`compileToRule` → `runnable:false`, `compileContract` only lists it under `skipped`); traffic carrying that data matches the catch-all. `activationBlocked` is set only by `block_activation` issues (approver missing), never by this combination | **H** | `compile.ts:116-120, 194-207`; `validate.ts:598-599, 746` | yes (structure) |
| G4 | **Unknown secret formats.** Anything outside 12 patterns (Azure SAS, GCP service-account JSON, DB connection strings, PuTTY/PKCS#8 without BEGIN marker, base64/hex-encoded, URL-embedded credentials) is not `secret` → ALLOW | **C** | H7 | yes: AWS docs-example key suppressed by design; connection string not matched |
| G5 | **`trust:"external"` alone resolves to nothing** → understood_only → no rule → catch-all ALLOW | **H** | `resolve-dest.ts:36` (stated) but no hosts produced | structure |
| G6 | **Non-443 / plain-HTTP egress is unobserved** by the NE; compiler still says ENFORCED for network clauses | **H** | H20 | by design of FlowPolicy |
| G7 | **`bing.com` in the approved group**: source code / financial data may be uploaded to Bing search under "Microsoft Copilot" | M | H12 | structure |
| G8 | **Substring `contains` on joined kinds** — latent false positive/negative when a kind is a substring of another | M | H14 | structure |
| G9 | **Catch-all ALLOW is unconditional on destination** — "ordinary information may be transmitted normally" compiled to `condition: null` at priority 10, i.e. ALLOW to *every* host. Faithful to the sentence, but the "non-sensitive" qualifier is realised only as "nothing we can detect" | **H** | compile output (rule 4) | yes |
| G10 | **Vault plaintext at rest** | M | H17 | yes |
| G11 | **Evidence cannot prove detector provenance** (no detector id/version/confidence/count fields; `constrain` report only in `reason`) | M | H21 | yes |
| G12 | **Config vs code confusion**: a `config.yaml` upload with a single `#` comment line scores 4+1 = 5 → `source_code` → REVIEW to non-approved hosts | M (over-block) | H9 | verified by reading the scoring |
| G13 | **LLM extraction is JSON-mode, unschema'd**; the validator catches shape errors, but semantic mapping errors (e.g. "any external AI" → `service` list) are only caught by the 302-case corpus | M | H2 | yes |
| G14 | **Copilot is never inspected.** `copilot.microsoft.com` matches `/(^|\.)microsoft\.com$/` in `DEFAULT_NO_INSPECT`, so every upload to Microsoft Copilot — one of the three approved services in this contract — gets only the host-level `network.connect` decision; content rules cannot match, the catch-all ALLOW does, and the TLS tunnel is joined opaque. Credentials, PII and source code to Copilot leave unchanged while every clause reports ENFORCED | **C** | `mitm.ts:62, 69-70`; `proxy.ts:108-150` (`tool_input: {host, port, agent}` only), `proxy.ts:665-671`; verified: `shouldInspect("copilot.microsoft.com") === false` (`copilot.cloud.microsoft` is inspected) | yes (2026-09-24) |
| G15 | **WebSocket upgrades bypass content inspection.** `handleUpgrade` decides on host/path with an empty classification marked `inspectable: true` (and `uninspected: true`, which only changes the reason text), so the fail-closed gate does not run; after an ALLOW the client and upstream streams are piped with no frame inspection | **H** | `mitm.ts:533-565`; `proxy.ts:275` gate keys on `classification.inspectable` | yes (structure) |

**What is *not* a gap (verified fail-closed):** PDF/pptx/zip/oversize/undecodable bodies are blocked wherever any protection could apply (`proxy.ts:275-284` re-evaluates with every kind, every finding label and `has_file_upload:true`; dry-run: uninspectable → chatgpt.com BLOCK, → httpbin.org BLOCK via the source-code REVIEW); CONSTRAIN with no constraint or a failed transform → block page, never forwarded (`mitm.ts:325-339`); a CONSTRAIN naming only unknown classes → `ok:false` → BLOCK (`transform.ts:52-55, 279-287`); no matching rule → BLOCK (`policy-core:202-206`); rules without a priority are dropped rather than matched.

---

## 4. Proposed canonical data taxonomy (Data Type Registry)

### 4.1 Principles

1. **One registry, one id space.** Every surface — LLM schema, validator, compiler, runtime detectors, transforms, evidence, UI — refers to data by a registry id. No file may carry its own list of classes.
2. **Hierarchical ids** (`FAMILY.SUBFAMILY.TYPE`), so a clause can name any level: `PII` (any), `PII.CONTACT` (email/phone/address), `PII.CONTACT.EMAIL`. Matching is by prefix.
3. **A type is a *claim about data*, not a detector.** Detectors register against types; a type with zero detectors is legal and is what makes UNDERSTOOD_ONLY mechanical.
4. **Tenant namespace is first-class**: `CUSTOM.<tenant>.<TYPE>` entries are created by the admin (EDM schema, regex, dictionary, label, trained class) and are indistinguishable to the compiler from built-ins.
5. **Provenance is orthogonal to type**: "customer" / "employee" / "patient" is a *scope* attribute (`owner`) satisfied by EDM/label/context detectors, never inferred from the type.

### 4.2 The registry entry (schema)

```ts
interface DataType {
  id: string;                       // "PII.CONTACT.EMAIL"
  parent?: string;                  // "PII.CONTACT"
  label: string; aliases: string[]; // for the LLM/validator alias table (generated FROM the registry)
  regulatory?: string[];            // ["GDPR","CCPA"] — evidence + reporting only
  detectors: Array<{ id: string; minVersion?: string; emits: { confidence: "low"|"medium"|"high"; count: boolean } }>;
  formats: string[];                // content units this type is meaningful in: "text","table","structured","image","code","any"
  transforms: Record<TransformId, "supported"|"unsafe"|"not_applicable">;  // per-handler support — detectable ≠ transformable
  actions: Array<"ALLOW"|"CONSTRAIN"|"REVIEW"|"BLOCK">;                  // e.g. CREDENTIAL.* forbids CONSTRAIN (never tokenize a secret)
  locality: "device"|"tenant_service"|"external_optin";                  // where detection may run (privacy boundary, §N)
  tenantConfig?: { required: boolean; kind: "edm_index"|"dictionary"|"regex"|"label_map"|"model"|"none"; };
  defaults: { minCount: number; minConfidence: "low"|"medium"|"high"; bulkCount?: number };  // policy defaults, overridable per clause
  evidence: { record: Array<"label"|"count"|"confidence"|"detector"|"detector_version"|"unit_path"|"field_names">; neverRecord: ["value"] };
  status: "stable"|"beta"|"declared";   // declared = no detector yet (UNDERSTOOD_ONLY by construction)
}
```

### 4.3 The taxonomy (initial catalogue)

| Family | Types (initial) | Primary detector family | Transformable? |
|---|---|---|---|
| `PII.CONTACT` | `EMAIL`, `PHONE`, `ADDRESS.POSTAL`, `NAME.PERSON` | pattern (email/phone), NER (name/address) | tokenize/redact/mask |
| `PII.IDENTITY` | `DOB`, `AGE`, `GENDER`, `NATIONALITY`, `PHOTO` | pattern, NER, OCR | tokenize/redact/generalize/date_shift |
| `PII.ONLINE` | `IP_ADDRESS`, `MAC`, `DEVICE_ID`, `COOKIE`, `USERNAME` | pattern | redact/hash |
| `PII.BULK` | (scope type) ≥N distinct PII values of any subtype in one unit | derived (count) | n/a — this is where today's `min:5` lives |
| `GOV_ID` | `US.SSN`, `US.ITIN`, `US.PASSPORT`, `US.DRIVERS_LICENSE`, `IN.AADHAAR`, `IN.PAN`, `UK.NINO`, `UK.NHS`, `EU.*`, `CA.SIN`, `AU.TFN` … | pattern + checksum + context | tokenize/redact/mask |
| `PCI` | `PAN` (Luhn + IIN), `CVV`, `TRACK_DATA`, `EXPIRY_WITH_PAN` | pattern+checksum+proximity | mask (last4)/tokenize; **never** allow CVV |
| `FINANCIAL` | `ACCOUNT.IBAN`, `ACCOUNT.US_ABA`, `ACCOUNT.SWIFT_BIC`, `STATEMENT`, `REVENUE`, `PRICING`, `FORECAST`, `TAX_ID` | pattern+checksum, structure, semantic | tokenize (accounts) / redact / LIMIT |
| `PHI` | `MRN`, `NPI`, `ICD10`, `CPT`, `DIAGNOSIS`, `MEDICATION`, `CLINICAL_NOTE`, `INSURANCE_ID`, `HIPAA.IDENTIFIER_SET` | pattern, dictionary, NER, semantic | tokenize/redact/date_shift |
| `CREDENTIAL` | `PRIVATE_KEY.PEM`, `PRIVATE_KEY.OPENSSH`, `PRIVATE_KEY.PGP`, `PRIVATE_KEY.PKCS12`, `API_KEY.<provider>`, `TOKEN.JWT`, `TOKEN.OAUTH`, `TOKEN.BEARER`, `PASSWORD.ASSIGNMENT`, `CONNECTION_STRING.<db>`, `CLOUD.SERVICE_ACCOUNT_JSON`, `GENERIC.HIGH_ENTROPY`, `CREDENTIAL_FILE.<name>` | provider signatures, entropy+context, file-name | **BLOCK only** (transform = not_applicable) |
| `SOURCE_CODE` | `LANG.<lang>`, `SNIPPET`, `PROPRIETARY` (provenance), `IAC` (terraform/k8s), `BUILD_CONFIG` | syntax-aware (tree-sitter), heuristics | REVIEW/BLOCK; LIMIT (line cap) |
| `HR` | `EMPLOYEE_ID` (custom), `SALARY`, `PERFORMANCE_REVIEW`, `DISCIPLINARY`, `BACKGROUND_CHECK`, `TERMINATION` | EDM, semantic, dictionary | redact/generalize |
| `LEGAL` | `PRIVILEGED`, `CONTRACT`, `NDA`, `LITIGATION_HOLD`, `REGULATORY_FILING` | context markers, semantic, fingerprint | REVIEW/BLOCK |
| `COMPANY_IP` | `TRADE_SECRET`, `ROADMAP`, `M_AND_A`, `BOARD_MATERIAL`, `DESIGN_DOC`, `CODENAME` (custom dictionary) | fingerprint, semantic, dictionary, label | REVIEW/BLOCK |
| `CUSTOMER` | `LIST`, `CONTRACT`, `ID` (custom EDM), `SUPPORT_TICKET` | EDM, fingerprint, semantic | tokenize/redact |
| `GEO` | `COORDINATES`, `PRECISE_LOCATION`, `ADDRESS_BULK` | pattern, structure | generalize |
| `LABEL` | `MIP.<label-guid>`, `MIP.NAME.<Highly Confidential>`, `GOOGLE_DRIVE.<label>`, `AIP.RMS_PROTECTED`, `CUSTOM_HEADER.<x-classification>` | metadata connectors | n/a (label drives decision) |
| `SEMANTIC` | `BOARD_MATERIAL`, `M_AND_A`, `LEGAL_PRIVILEGE`, `PRODUCT_ROADMAP`, `TRADE_SECRET`, `PERFORMANCE_REVIEW`, `CLINICAL_DOCUMENT`, `CUSTOMER_CONTRACT`, `TENANT.<class>` | local classifier (ONNX) / tenant-trained | REVIEW/BLOCK |
| `CUSTOM.<tenant>` | `EMPLOYEE_ID`, `CUSTOMER_ID`, `PATIENT_ID`, `ACCOUNT_NO`, `CODENAME`, `CLIENT_NAME`, … | EDM index, regex, dictionary | as configured |
| `UNINSPECTABLE` | `ENCRYPTED`, `PASSWORD_PROTECTED`, `UNSUPPORTED_FORMAT`, `OVERSIZE`, `DEPTH_EXCEEDED`, `PARSER_FAILURE`, `TIMEOUT`, `DECOMPRESSION_REFUSED` | extraction layer (§D) | n/a — a *state*, evaluable in policy |

Mapping today's world: `pii` → `PII.*` (with `PII.BULK` carrying the ≥5 semantics); `secret` → `CREDENTIAL.*`; `credential_file` → `CREDENTIAL.CREDENTIAL_FILE`; `source_code` → `SOURCE_CODE.*`; `financial/phi/legal/confidential` → their families, with the existing multi-signal detectors registered as `SEMANTIC`-grade (medium confidence) detectors for them.

---

## 5. Proposed registries: IR, detectors, transforms, parsers, destinations, capabilities

### 5.1 Policy IR (A)

Strict, versioned, produced by *Structured Outputs + Zod*, then re-validated deterministically. Data classes and destinations are **references**, never logic.

```ts
interface PolicyIR { v: 1; contract: ContractMeta; pins: RegistryPins; definitions: Definitions; invariants: Invariant[]; clauses: ClauseIR[] }

interface RegistryPins { dataTypes: string; destinations: string; detectors: string; transforms: string; parsers: string }  // versions the IR was compiled against

interface ClauseIR {
  id: string; source: { text: string; span?: [number, number] }; confidence: number;
  subject: { kind: "any"|"group"|"user"|"agent_class"|"device"|"workload"; refs?: string[] };   // IdP refs, verified or DEGRADED
  action: "read"|"write"|"delete"|"execute"|"query"|"push"|"merge"|"invoke"|"disclose"|"transact"|"configure"|"connect"|"list";
  resource: { type: ResourceType; refs?: string[]; paths?: { include?: string[]; exclude?: string[] } };
  data?: DataRef[];                 // OR-set unless `all:true`
  destination?: DestRef;
  scope?: { environments?: string[]; instances?: string[]; owner?: "customer"|"employee"|"patient"|string };
  conditions?: { thresholds?: Threshold[]; time?: TimeWindow; count?: { per: "request"|"session"|"hour"|"day"; max: number } };
  decision: "ALLOW"|"CONSTRAIN"|"REVIEW"|"BLOCK";
  transforms?: TransformRef[];      // required iff CONSTRAIN
  review?: { approvers: string[]; quorum?: number; permit?: { ttlSeconds: number; singleUse?: boolean } ; failClosed: true };
  onUnsupported: "hold_activation"|"block"|"review"|"accept_risk";   // what happens when a required capability is missing (default: hold_activation for protections, block for CONSTRAIN)
}

interface DataRef {
  type: string;                     // registry id or prefix, or "CUSTOM.<tenant>.<TYPE>", or a DataGroup id
  match?: { minCount?: number; minConfidence?: "low"|"medium"|"high"; scope?: "any"|"bulk"; requireProvenance?: boolean };
}
interface DestRef {
  class?: Array<"APPROVED_AI"|"KNOWN_AI_UNAPPROVED"|"INTERNAL"|"APPROVED_SAAS"|"PARTNER"|"GENERIC_EXTERNAL"|"UNKNOWN_EXTERNAL"|"ANY_EXTERNAL">;
  services?: string[]; groups?: string[]; hosts?: string[];
  notIn?: { services?: string[]; groups?: string[]; hosts?: string[]; class?: string[] };
}
interface TransformRef { handler: TransformId; targets: "matched"|{ types?: string[]; fields?: string[] }; params?: Record<string, unknown> }
```

Why each field: `match.minCount/minConfidence` moves thresholds *out of detectors* (fixes G1); `DestRef.class` lets protections say `ANY_EXTERNAL` (fixes G2/G5); `onUnsupported` makes the unsupported-capability behaviour explicit per clause (fixes G3); `pins` make evidence reproducible (fixes G11); `transforms[].targets` separates detection from transformation (§M).

**Model contract.** The extraction schema is *generated from the registries* (enums for verbs, decisions, destination classes; `data[].type` is a string validated post-hoc against the registry with alias resolution; unknown → `CUSTOM` candidate flagged `pending` for the admin to bind). Structured Outputs guarantees the JSON shape; the 302-case corpus plus new semantic-mapping cases guard the *meaning* (H2/G13).

### 5.2 Detector registry (E)

```ts
interface Detector {
  id: string; version: string; family: "pattern"|"checksum"|"ner"|"secret"|"edm"|"regex_custom"|"dictionary"|"fingerprint"|"code"|"ocr"|"semantic"|"label"|"tenant";
  emits: Array<{ type: string; confidence: "low"|"medium"|"high" }>;   // registry types this detector can produce
  inputs: Array<"text"|"table"|"structured"|"image"|"code"|"metadata">;  // content-unit kinds it consumes
  locality: "device"|"tenant_service"|"external_optin"; cost: "cheap"|"moderate"|"heavy";
  tenantConfig?: string;            // e.g. "edm_index:customer_ids"
  detect(unit: ContentUnit, ctx: DetectCtx): Finding[];   // Finding = { type, count, confidence, spans?: Span[] (device-only, never persisted), fieldNames?: string[] }
}
```

Rules: detectors emit **every** hit with a count and confidence; **no detector owns a policy threshold** — `PII.CONTACT.EMAIL` emits count=1 for one email; the clause's `match.minCount` (default from the registry entry) decides. Today's `min:5` becomes the registry default for `PII.BULK` (and the *fallback* default for bare `PII` when the clause says nothing), while "customer email" → `PII.CONTACT.EMAIL` with `minCount: 1` from the sentence ("any customer email"). This is generic: the same mechanism gives `GOV_ID.US.SSN` `minCount:1` and `PII.ONLINE.IP_ADDRESS` `minCount:20` without special cases.

Families evaluated separately in §E of the detailed assessment (below, §7).

### 5.3 Transform registry (M)

```ts
interface Transform { id: "REDACT"|"MASK"|"REVERSIBLE_TOKENIZE"|"HASH"|"DROP_FIELD"|"GENERALIZE"|"DATE_SHIFT"|"FORMAT_PRESERVING"|"LIMIT"|"REWRITE";
  supports: Array<{ type: string; formats: string[]; reversible: boolean; safety: "safe"|"lossy"|"unsafe" }>;
  apply(unit: ContentUnit, targets: Finding[], params): TransformResult;   // ok:false ⇒ caller BLOCKs (existing invariant)
}
```

Support matrix is *declared per type × format* (e.g. `REVERSIBLE_TOKENIZE` supports `PII.CONTACT.EMAIL` in text/table/structured; `MASK` supports `PCI.PAN` (last4); `LIMIT` supports `SOURCE_CODE.*` (max lines) and `PII.BULK` (max rows); nothing supports `CREDENTIAL.*`). Coverage derivation asks the *transform* registry, not the family (fixes H5). Vault: AES-256-GCM, key in the macOS Keychain (data-protection class), per-tenant key wrap, TTL, audit of de-tokenisation; FF1 only if a customer needs format-preserving tokens (NIST SP 800-38G rev1 — see research).

### 5.4 Parser / extraction registry (D)

Two tiers, one interface:

```ts
interface Extractor { id: string; tier: "in_process"|"sidecar"; formatsSniffed: string[]; limits: Limits; extract(bytes, hints): ContentUnit[] | Uninspectable }
interface ContentUnit { id; parent?; depth; format; sniffedBy: "magic"|"tika"|"structure"; text?; table?; structured?; image?; metadata: Record<string,string>; truncated: boolean }
type Uninspectable = { state: "ENCRYPTED"|"PASSWORD_PROTECTED"|"UNSUPPORTED_FORMAT"|"OVERSIZE"|"DEPTH_EXCEEDED"|"PARSER_FAILURE"|"TIMEOUT"|"DECOMPRESSION_REFUSED"|"MALFORMED"; reason: string }
```

- **Tier 0 (in-process, today's code):** text/JSON/CSV/TSV/YAML/XML/HTML/multipart + bounded OOXML. Keep; add magic-based sniffing for all formats (never trust extension: H10).
- **Tier 1 (device helper, optional):** OCR via Apple Vision (Swift helper we already build), tree-sitter (wasm, in-process is fine — it is a parser, not a file-format decoder).
- **Tier 2 (isolated inspection service, tenant-hosted):** Apache Tika 4 server for Office/PDF/RTF/ODF/email/archives/nested archives/images-with-OCR; Presidio for NER; ONNX semantic classifiers. Isolation: separate process/container, no outbound network, CPU/memory/time limits, forked child-process mode so a parser crash is a `PARSER_FAILURE` state, recursion and decompression limits configured, encrypted docs reported explicitly. The daemon never links these in-process.
- Every unit carries `metadata` so **labels** (MIP custom properties, PDF XMP) are available to the `LABEL` detector even when the body is `ENCRYPTED` — a labelled-but-encrypted file is *decidable* (BLOCK/REVIEW by label) rather than merely uninspectable.

### 5.5 Destination registry (L)

Server-side (control plane), tenant-scoped, versioned; the browser `localStorage` copy goes away (H13). Resolution at runtime, not only at compile time: the daemon emits `tool_input.destination_class` and `tool_input.service` per request, so a policy on `ANY_EXTERNAL` or `UNKNOWN_EXTERNAL` matches hosts nobody catalogued.

```
class = INTERNAL            if host ∈ tenant.internalDomains ∪ private ranges ∪ loopback
      = APPROVED_AI         if service ∈ tenant.approved(ai)
      = KNOWN_AI_UNAPPROVED if service ∈ catalogue(ai) ∧ ∉ approved
      = APPROVED_SAAS       if service ∈ tenant.approved(saas)
      = PARTNER             if host ∈ tenant.partnerDomains
      = GENERIC_EXTERNAL    if service ∈ catalogue(other)
      = UNKNOWN_EXTERNAL    otherwise
ANY_EXTERNAL = ¬INTERNAL
```

Catalogue entries carry `kind` (ai, saas, storage, code, chat…), host suffixes, *and* the AI-assistant sub-hosts that matter (e.g. `bing.com` only as `copilot` when path `/chat|/copilot`, otherwise `search`) — resolving H12/G7.

### 5.6 Capability registry and the activation invariant (C)

Keep `requirements()` / `deriveStatus()`; change *what* is required and *what happens when unmet*:

- Requirements become registry-derived: `content.<type>@<minConfidence>`, `parse.<format>` for each format the clause's resource can arrive in, `transform.<handler>.<type>`, `destination.class` or `destination.hosts`, `identity.<subject.kind>`, `review.hold`.
- **Invariant I1 (no silent allow):** at activation, for every clause with `decision ∈ {CONSTRAIN, REVIEW, BLOCK}` whose status is UNDERSTOOD_ONLY/PENDING, the contract cannot activate unless the clause's `onUnsupported` is resolved: `hold_activation` (default) blocks the *whole contract*; `block` compiles a shadow rule that BLOCKs the clause's destination class when `has_file_upload` or `uninspectable` (protecting the likeliest carrier); `review` likewise to REVIEW; `accept_risk` requires an admin identity + reason and is written into the contract's evidence header. The catch-all ALLOW is compiled *only after* every protection has a resolution.
- **Invariant I2 (no fake enforced):** ENFORCED requires every `parse.*`, `content.*`, `transform.*`, `destination.*` requirement to be *provided by the deployed runtime at the pinned versions*, and the network plane to declare its transport coverage (ports/protocols, never-decrypt hosts, WebSocket) so H20/G14/G15 become DEGRADED notes, not silence.
- **Invariant I3 (threshold honesty):** a `content.<type>` requirement is met only if a registered detector emits that type at ≥ the clause's `minConfidence` **and** emits counts, so `minCount` is enforceable (G1).

Evidence records `contract.pins`, `clause.id`, `detector.id@version`, `type`, `count`, `confidence`, `unit path` (e.g. `zip[2]/report.xlsx/sheet1`), `transform.id`, `destination.class`, and the `uninspectable.state` when applicable.

---

## 6. Current vs required architecture

### 6.1 Today

```
English ──► /api/compile-intent (LLM, JSON mode; classes named in the PROMPT)
        ──► validateSurface()      closed verbs/resources/decisions; classes = free strings
        ──► CLASS_BRIDGE / classFamily()   ~45 synonyms → 4 kinds (+4 semantic families)
        ──► requirements() + deriveStatus()   capability registry (mechanical)   ✔
        ──► compileToRule()        host regex + `content_kinds contains <kind>` (+ filenames)
        ──► POST /v1/rules  ──►  wrapboxd pull  ──►  policy-core evaluate() (first match; no-match=BLOCK)
                                                        ▲
   NE (TCP/443) ──► daemon TLS-terminate ──► parsers.ts (Tier 0) ──► classify.ts (12 secret regex, 4 PII w/ min counts, code heuristic)
                                                                   ──► classifiers.ts (financial/phi/legal/confidential)
                                            ──► worst-case gate for UNINSPECTABLE ──► transform.ts (tokenize/redact; csv/json/text)
                                            ──► receipts (signed, chained; reason text)
```

Where the vocabulary lives today (5 copies): prompt text · `CLASS_BRIDGE` · `classFamily()`/`KNOWN_FAMILIES` · `RUNTIME_CONTENT_KINDS` + `SECRET_PATTERNS` + `PII_PATTERNS` · `TokenKind`/`KNOWN_KINDS`.

### 6.2 Required

```
Intent Contract (English)
   │  LLM: Structured Outputs (schema GENERATED from registries) + Zod        ── the model only translates intent
   ▼
Policy IR v1  {subject, action, resource, data[]: DataRef{type, match{minCount,minConfidence}}, destination: DestRef{class…},
               decision, transforms[], review, onUnsupported, pins}
   │  deterministic validator (alias resolution AGAINST the Data Type Registry; unknown → CUSTOM candidate → pending)
   ▼
┌──────────────────── Registries (control plane, tenant-scoped, versioned) ────────────────────┐
│ Data Type Registry ◄── Detector Registry ◄── Transform Registry ◄── Parser/Extractor Registry │
│ Destination Registry (classes, catalogue, tenant approvals, internal domains)                 │
│ Capability Registry = runtime self-description ∩ registries  ⇒ ENFORCED/DEGRADED/UNDERSTOOD/PENDING │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
   │  compile: IR → wire rules  (destination_class, finding_counts.<type> ≥ n, confidence, uninspectable.state)
   │  activation invariant I1: no protection may be silently unenforced (hold / block-carrier / review / accept_risk)
   ▼
wrapboxd (unchanged transport: NE → TLS terminate)
   ├─ Extraction: Tier 0 in-process (text/json/csv/ooxml-lite) │ Tier 1 device helpers (Vision OCR, tree-sitter) │ Tier 2 isolated inspection service (Tika 4, Presidio, ONNX) — tenant-hosted, no egress
   │     → ContentUnit tree (+metadata/labels) or UNINSPECTABLE{state}
   ├─ Detectors (registry-driven): pattern/checksum · secrets (provider rules + entropy) · EDM (hashed index) · dictionaries · fingerprints · code (syntax-aware) · OCR→text · semantic (ONNX) · labels · tenant custom
   │     → Findings{type, count, confidence, detector@version, unitPath}
   ├─ policy-core evaluate() (extended ops: set membership, numeric count compare, prefix match on type ids)
   ├─ Transforms (registry-driven; encrypted vault) ── fail closed on any inability
   └─ Evidence: receipt + {pins, clause, detector@version, type, count, confidence, unitPath, transform, destination_class, uninspectable}
```

Data-flow contract per request: `bytes → units → findings → decision → (transform) → evidence`. Nothing decides on raw bytes; nothing decides on a family name that is not a registry id.

---

## 7. Technology choices, with justification (all facts checked against official sources on 2026-09-24 — Appendix B)

| Decision | Choice | Why | Rejected alternative |
|---|---|---|---|
| Language / core | **Keep TypeScript/Node** for compiler, control plane, daemon, policy core | Everything security-critical already lives here and is tested; the gaps are registries and detectors, not the language | Rewrite in Go/Rust — no concrete gap it closes |
| Intent → IR | **OpenAI Structured Outputs (`json_schema`, `strict:true`) + Zod** (`zodResponseFormat` / `zodTextFormat`, `.parse()`) with the schema *generated from the registries*; keep the deterministic validator as the authority | Shape is enforced by the API (`additionalProperties:false`, all fields required, `anyOf`/recursive supported, explicit `refusal`); meaning is still re-validated. Today's call is JSON-mode (H2) | JSON mode (today); "LLM decides" — never |
| Capability truth | **Existing Capability Registry**, fed by `wrapboxd capabilities` **plus** registry versions | It is already mechanical (`deriveStatus`); it only needs registry-derived requirements and the activation invariant | OPA/Cedar as the capability oracle — they evaluate policies, they do not know what a detector can see |
| Policy core | **Keep `@wrapbox/policy-core`**; add set-membership, numeric count ops on `finding_counts.<type>`, prefix match on type ids, and `destination_class` | The engine's shortcomings are three operators, not the paradigm; it stays auditable in 220 lines. OPA (Apache-2.0, Rego, Wasm via `@open-policy-agent/opa-wasm`) and Cedar (Apache-2.0, `cedar-wasm`, symbolic analysis) solve *policy expression at scale*; our concrete gap is *observation*. Revisit Cedar when tenants author policies over entity hierarchies (users/groups/resources) — its schema validation + symcc would then earn its place | Adopt OPA/Cedar now — no gap closed, one more runtime + language |
| Extraction | **Apache Tika 4.0.0** (Apache-2.0, Java 17, released 2026-08-21) as an **isolated `tika-server`** in forked mode (default since 2.x): `taskTimeoutMillis`, `maxRestarts`, `maxFiles`, `maxForkedStartupMillis`, `forkedJvmArgs`; `/rmeta` for nested documents with `maxEmbeddedResources`, `writeLimit`, `unpackMaxBytes`; encrypted/unsupported → HTTP 422 → `UNINSPECTABLE.ENCRYPTED/UNSUPPORTED`. Official image `apache/tika:<v>` (`-full` variant bundles Tesseract), bound to `127.0.0.1:9998`, no egress | Broadest format surface available under a permissive license; process isolation and restart-on-crash are built in | In-process JS parsers for Office/PDF — supply-chain and crash risk on the hot path (the codebase already refuses this, `parsers.ts:16-21`) |
| PII / NER | **Presidio** (MIT; now at `data-privacy-stack/presidio`) as a tenant-side service (`presidio-analyzer` REST) for NER-grade types (`PII.CONTACT.NAME.PERSON`, `ADDRESS`), *plus* our in-process TS pattern/checksum detectors for everything regex-able | Recognizer-registry design matches ours; spaCy/transformers engines; custom recognizers. Python service, so it belongs in Tier 2, not on every laptop | Port Presidio to TS — no; call a cloud NER — violates §N |
| Secrets | **Gitleaks rule corpus** (MIT; TOML rules with `regex`, `secretGroup`, `entropy`, `keywords`, `allowlists`; 223 rules in the default config; `generic-api-key` at entropy 3.5) compiled into our detector at build time, with provenance; add private-key formats and connection-string rules of our own; **verification off by default** (it sends the secret to the provider) | Mature, provider-aware, permissively licensed; we get keyword-prefilter + regex + entropy semantics without inventing 200 regexes | **TruffleHog is AGPL-3.0** — do not vendor or link; its 800+ detectors and live verification are a reference, not a dependency. detect-secrets (Apache-2.0) is a valid second source for entropy/keyword plugins |
| Source code | **Tree-sitter** (MIT) via `web-tree-sitter` (Wasm, in-process) for a top-N grammar set; language *identification* is ours (shebang, keywords, then try-parse and score error-node ratio) — tree-sitter does not detect language | Content-based, extension-independent, works on snippets embedded in JSON/logs | Extension lists (today) |
| OCR | **Apple Vision `VNRecognizeTextRequest`** on macOS (on-device, macOS 10.15+) via a small Swift helper we already know how to build; **Tesseract 5** (Apache-2.0, 100+ languages) in the Tika `-full` image for Linux/Tier 2 | Local by default; no image leaves the device to decide whether it may leave the device | Cloud OCR — only as `external_optin` |
| Semantic classifiers | **ONNX Runtime** (`onnxruntime-node`, MIT; macOS arm64/x64, Linux, Windows, CPU EP) hosting small text classifiers; tenant-trained classes as ONNX artifacts registered as `SEMANTIC.TENANT.<class>` | Pluggable, local, no ML platform to build; Purview's own model is "pretrained + custom trainable, English-only, not on encrypted items" — same shape | Building a training product now |
| Exact Data Match | **Own EDM service** (TS) modelled on Purview EDM and Google *stored infoTypes*: tenant uploads salted-hash (HMAC-SHA-256, tenant key) index of normalised values per schema column; device holds a Bloom filter + hashed shards; primary element must be detectable by a pattern first, supporting elements within proximity raise confidence | Purview: hashes+salt computed on-prem, up to 100M rows, primary+supporting+proximity; Google: large dictionaries to tens of millions. Same privacy posture, no plaintext reference data | Plaintext dictionaries on devices |
| Labels | **Connector reading MIP metadata**: `MSIP_Label_<GUID>_Enabled/Name/SiteId/Method/SetDate/ContentBits` from OOXML custom properties / `custom.xml` (co-authoring → `LabelInfo` stream per MS-OFFCRYPTO), PDF properties, and the `MSIP_Labels` email header; tenant maps GUID → `LABEL.MIP.<name>` | Documented, stable key names; `Enabled` is exactly what "DLP products typically validate"; works even when the payload is RMS-encrypted (label readable, content not) | MIP SDK for decryption — later, licensing/consent required |
| Reversible tokens | **AES-256-GCM vault** with key in macOS Keychain (data-protection class), per-tenant wrap, TTL + audit; deterministic tokens per (type,value) as today; **FF1 only on request** | Google's `CryptoDeterministicConfig` (AES-SIV) and `CryptoReplaceFfxFpeConfig` are the reference shapes; NIST SP 800-38G is final (with Update 1) but **Rev. 1 is still a draft** (2nd public draft, 2025: FF1 domain size up, FF3 dropped) — FPE is not a default | Plaintext JSONL (today, H17) |
| Destinations | Server-side registry, class taxonomy, runtime resolution (§5.5) | Fixes G2/G5/G7 structurally | localStorage (today) |

---

## 8. MVP now vs later

**MVP (closes every C/H gap, keeps the NE + daemon as they are):**
1. Data Type Registry v1 (`PII.*`, `GOV_ID.*`, `PCI.*`, `CREDENTIAL.*`, `SOURCE_CODE.*`, `FINANCIAL.*`, `PHI.*`, `LEGAL.*`, `COMPANY_IP.*`, `LABEL.*`, `CUSTOM.<tenant>.*`, `UNINSPECTABLE.*`) and Policy IR v1 with Structured Outputs — the LLM schema, validator alias tables, compiler, runtime vocabulary and evidence all read from it.
2. Detector thresholds moved into the IR (`match.minCount/minConfidence`); detectors emit raw counts. This alone fixes G1 for *every* type.
3. Destination Registry on the control plane with classes; runtime emits `destination_class`; protections compile to `ANY_EXTERNAL`/`UNKNOWN_EXTERNAL` — fixes G2/G5/G7.
4. Activation invariant I1 (`onUnsupported`) + coverage that includes transport (ports, never-decrypt hosts, WebSocket) and transforms — fixes G3/G6/G14/G15, H5. Immediate hot-fix candidate independent of the rest: narrow the `microsoft.com` never-decrypt entry so `copilot.microsoft.com` is inspected, and make WebSocket upgrades `UNINSPECTABLE` (fail closed where a protection could apply).
5. Secrets: Gitleaks corpus + entropy + private-key/connection-string rules — fixes G4.
6. Policy-core operators: `in_set`, `count_gte` on `finding_counts.<type>`, prefix match on type ids; exact-token matching on arrays — fixes H14.
7. Evidence v2 fields (pins, detector@version, type, count, confidence, unit path, transform, destination class, uninspectable state) — fixes G11.
8. Vault encryption (Keychain-backed key) — fixes G10.
9. Tika 4 sidecar behind the extractor interface, with `UNINSPECTABLE` states; PDF/PPTX/RTF/ODF/email/nested archives become inspectable instead of blanket-blocked.
10. MIP label connector (metadata only).
11. Test matrix v1 (§10).

**Later:** Presidio NER service; EDM service and Bloom sync; document fingerprints; ONNX semantic classifiers and tenant training; OCR helpers (Vision/Tesseract); FF1; Cedar evaluation for entity-scoped policies; IdP-backed subject identity (external blocker A); Windows/Linux transports.

---

## 9. Migration plan — preserves the working Network Extension and runtime

Nothing in the NE, TLS termination, receipts chain, launchd job or `panic.sh` changes. Every step is additive and flag-gated; the 302-case corpus plus a new equivalence suite guarantees today's contracts compile to the *same* wire rules until a flag flips.

| Step | Change | Compatibility guard |
|---|---|---|
| M0 | Freeze: snapshot current compile output for every corpus case and the live contract → `golden/wire-rules-v1.json` | Any later step must reproduce it bit-for-bit with flags off |
| M1 | Add `registries/` (data types, destinations, transforms, parsers, detectors) as data + loaders; generate `CLASS_BRIDGE`/`classFamily`/`TokenKind` **from** the registry and assert equality with today's tables (drift test) | No behaviour change |
| M2 | Runtime emits *additional* fields (`finding_counts`, `finding_confidence`, `destination_class`, `uninspectable_state`, `detector_versions`) alongside `content_kinds`; receipts v2 carry them | Old rules keep matching on `content_kinds` |
| M3 | Policy-core gains the new ops; old ops unchanged | Old rules evaluate identically (property test: same decision on the golden request corpus) |
| M4 | Compiler v2 behind `WBX_IR_V1=1`: Structured Outputs → IR → validator → wire rules using the new fields; equivalence suite proves v1 == v2 on all cases that have no count/class semantics, and documents the *intended* differences (G1, G2) | Flag off in prod until the suite is green |
| M5 | Destination registry moves server-side; UI reads from CP; `localStorage` import once | Rules unaffected (hosts already compiled) |
| M6 | Activation invariant I1 enabled for new contracts; existing active contracts get a one-time report of understood-only protections | No auto-blocking of existing traffic |
| M7 | Tika sidecar as an optional extractor (`WBX_INSPECTION_SERVICE=http://127.0.0.1:9998`); when absent, behaviour is exactly today's | Fail-closed gate unchanged |
| M8 | Vault re-encryption on first daemon start after upgrade (read plaintext → write encrypted → shred) | Tokens issued earlier keep resolving |
| M9 | Flip `WBX_IR_V1` on for the demo tenant; re-run the whole matrix on the real Mac (NE on) | `panic.sh` unchanged as rollback |

---

## 10. Prioritised implementation plan, with tests

Each item lists the invariant test that gates it. **Security property (must hold at every commit):** *no protection clause activates as ENFORCED if any required parser, detector, destination resolver or transformer is unavailable at the pinned version.*

| P | Work item | Tests that gate it |
|---|---|---|
| 0 | Golden snapshot of current compile + runtime decisions (M0) | `golden.equivalence` — byte-equal wire rules; `golden.decisions` — same effect on a recorded request corpus |
| 1 | Data Type Registry + IR schema + Structured Outputs client + validator alias generation | `registry.single-source`: grep-gate that no `*.ts` outside `registries/` declares a class name; `ir.schema-roundtrip` (IR → JSON → IR); `ir.semantic-mapping`: 302 corpus + 60 new cases (customer email single instance; "any external"; "except"; "without credentials"; unknown class → CUSTOM candidate); refusal path |
| 2 | Threshold semantics in IR; detectors emit counts | `threshold.single-instance`: 1 email → CONSTRAIN when clause says "any customer email"; `threshold.bulk`: 5 emails → `PII.BULK`; `threshold.default`: bare "PII" uses registry default; property: for every type, `minCount` monotone (raising it never adds matches) |
| 3 | Destination registry + classes + runtime resolution | `dest.unknown-ai`: brand-new host → `UNKNOWN_EXTERNAL` → credential BLOCK fires; `dest.internal`; `dest.bing-path`; property: `ANY_EXTERNAL ≡ ¬INTERNAL` |
| 4 | Capability invariants I1–I3 + transport coverage | `activation.no-silent-allow`: a contract with an understood-only protection + catch-all cannot activate without `onUnsupported`; `coverage.transport`: NE declares 443-only → clause DEGRADED with note; `coverage.no-inspect`: a destination on the never-decrypt list → clause DEGRADED ("host-level only"), and the list moves into the Destination Registry as a tenant-visible `inspection: never` attribute; `coverage.websocket`: upgrades either inspected frame-by-frame for approved AI hosts or treated as `UNINSPECTABLE` and fail closed; property: ENFORCED ⇒ all requirements provided at pinned versions |
| 5 | Secrets detector v2 (Gitleaks corpus + entropy + keys/connection strings) | corpus of 223 rule samples (positive/negative from Gitleaks' own tests where available), encoded (base64/hex/URL) variants, docs-example allowlist, false-positive corpus (UUIDs, hashes, commit SHAs) |
| 6 | Policy-core ops + exact array matching | `ops.count_gte`, `ops.in_set`, `ops.prefix`; regression: `contains` on arrays now token-exact (`ip` ≠ `pii`) |
| 7 | Evidence v2 | `evidence.reproducible`: from a receipt + pinned registries, re-derive the decision offline; `evidence.never-values` (property: no receipt field contains any detected value) |
| 8 | Vault encryption | `vault.at-rest`: file is not parseable without the Keychain key; `vault.migrate`; `vault.ttl` |
| 9 | Extractor interface + Tika sidecar + `UNINSPECTABLE` states | matrix (below); `sidecar.isolation`: sidecar has no egress, dies on bomb → `PARSER_FAILURE`; timeouts → `TIMEOUT`; encrypted docx/pdf/zip → `ENCRYPTED`; depth 5 nested zip → `DEPTH_EXCEEDED` |
| 10 | MIP label connector | labelled docx/xlsx/pptx/pdf/eml fixtures → `LABEL.MIP.<name>`; encrypted-but-labelled → decision by label, evidence states `ENCRYPTED` |
| 11 | Tree-sitter code identification | renamed `.txt`, embedded in JSON string, in a log line, in a zip; config files (`.json/.yaml`) **not** code |
| 12 | Test matrix runner (below) on the real Mac with NE on | end-to-end receipts verified by `/v1/evidence/verify` |

### The coverage matrix (O)

Automated runner emits one row per `contract clause × data type × parser × detector × transform × destination class → expected enforcement → evidence assertions`. Fixture axes, all generated (never real data): renamed files (`.txt` holding docx/pdf/code), nested archives (zip-in-zip-in-docx, depth 1–5), mixed-sensitive (PII + secret in one body, the block must win), single-instance PII, 1 000 and 100 000 PII rows (bulk + performance budget), malformed (truncated zip, bad multipart boundary, invalid UTF-8), encrypted/password-protected (docx, pdf, zip), unsupported (`.dwg`, random bytes), images and scanned PDFs (with/without text layer), code renamed as text, encoded secrets (base64/hex/URL-encoded/JWT-in-cookie), unknown external destinations, tenant identifiers via EDM, classifier false positives (invoice-like non-financial text; "patient" in a novel) and false negatives (obfuscated SSN). Every row asserts three things: the *decision*, the *bytes that left* (captured by a local echo server), and the *evidence fields*.

---

## Appendix A — detailed assessment against the brief (A–O)

**A. Intent compiler.** Hard-coded concepts: yes — classes in prompt text (H1), synonym bridge (H3), family table (H4), maskability by family (H5). It *can* emit arbitrary class strings, but they are only "understood"; nothing registers them. Structured Outputs is not used (H2). The IR in §5.1 replaces all four with registry references; the validator's alias tables are generated from the registry, so "valid JSON" and "correct mapping" are two separate gates, as required.

**B. Data Type Registry.** §4. Every entry carries detectors, formats, confidence, transform support per handler, allowed actions, locality, tenant config, evidence metadata and a `declared` status for types with no detector.

**C. Capability Registry.** Already mechanical (`deriveStatus`), but requirements are family-level and the unmet case is only *reported*. §5.6 adds I1 (no silent allow — `onUnsupported`), I2 (no fake enforced — pinned versions, transport coverage) and I3 (threshold honesty). The fail-closed-when-uninspectable rule already exists in `proxy.ts` and stays.

**D. Content extraction.** Today: Tier-0 text/JSON/CSV/YAML/XML/HTML/multipart/DOCX/XLSX with bounded zip; PDF, PPTX, generic archives, images, email, RTF/ODF are UNINSPECTABLE (H11) — honestly, but at the cost of blocking. Format sniffing trusts headers for three formats (H10). §5.4 defines the extractor interface, the `ContentUnit` tree, nine explicit `UNINSPECTABLE` states and Tika 4 as an isolated sidecar with `taskTimeoutMillis`/`maxRestarts`/`maxFiles`/`writeLimit`/`maxEmbeddedResources`/`unpackMaxBytes`, forked-process crash isolation, 422 → explicit state. Nothing runs in-process with `wrapboxd` except Tier 0.

**E. Detector registry.** Family-by-family: *pattern/checksum* — exists (PII, card Luhn, provider secrets); keep, move thresholds out (H8). *NER/contextual* — absent; Presidio service (Tier 2). *Secrets* — 12 regexes, no entropy (H7); Gitleaks corpus + entropy + context. *EDM* — absent; §F. *Custom regex* — absent as a tenant feature; trivial once the registry exists (Macie-style: regex ≤512 chars + keywords + max match distance + ignore words is a good admin UX model). *Dictionaries* — small lists exist inside multi-signal detectors; add tenant dictionaries (Google: "several hundred thousand" regular / tens of millions stored). *Fingerprints* — absent; Purview model: hash of template text, partial match 30–90 %, ~4 MB, ~100/tenant. *Code* — heuristic (H9); tree-sitter. *OCR* — absent; §J. *Semantic* — four multi-signal detectors exist; ONNX layer for the rest. *Labels* — absent; §K. *Tenant custom* — absent; `CUSTOM.<tenant>` in the registry. **The ≥5 threshold does not belong in the detector**: it encodes a *policy* ("bulk export") as a *detection* fact; the IR's `match.minCount` with a registry default reproduces today's behaviour for bare "PII" and lets "any customer email" mean 1, with no EMAIL special case.

**F. Tenant-specific data (EDM).** §7: salted-hash index built on-prem (Purview: hashes computed by the customer, only hashes uploaded, ≤100M rows; primary element must be detectable by a pattern; supporting elements within proximity raise confidence; multi-token matching). Device: Bloom filter for presence, hashed shards for confirmation, normalisation rules per column (case, delimiters). No plaintext reference data anywhere.

**G. Semantic classification.** Pluggable `SEMANTIC.*` detectors over ONNX (local); tenant-trained classes registered as artifacts; confidence is evidence, never authority (already the codebase's rule). Not an ML product: the interface plus two or three shipped models.

**H. Secret detection.** Audit: prefix-anchored, precise, small; no entropy, no provider breadth, no connection strings, no encoded forms. Adopt the Gitleaks rule *format and corpus* (MIT), keep our validate hooks (AWS docs example), add ours for keys/connection strings/service-account JSON, entropy + context for generics, verification opt-in only. TruffleHog is AGPL-3.0 — reference architecture only.

**I. Source code.** Tree-sitter (MIT, Wasm in-process); identification by content; embedded-code extraction from JSON strings, logs and messages; config formats classified as `SOURCE_CODE.BUILD_CONFIG`, not code, unless the contract says otherwise.

**J. OCR / visual.** `image | scanned PDF → OCR (Vision on macOS; Tesseract in Tika -full elsewhere) → ContentUnit(text, source:"ocr", confidence) → same Detector Registry`. Local by default; evidence records `ocr:true`.

**K. Enterprise labels.** Read `MSIP_Label_*` metadata (documented key set) and the `MSIP_Labels` email header; tenant maps GUIDs to `LABEL.MIP.<name>`; a label is a first-class finding that policy can act on before any content inspection — including on RMS-encrypted files.

**L. Destination registry.** §5.5 — seven classes plus `ANY_EXTERNAL`; runtime-side resolution so unknown hosts are still classified.

**M. Transform registry.** §5.3 — ten handlers, per-type/per-format support matrix; "detectable but not transformable" is a first-class coverage state (today it is inferred from the `pii` family, H5).

**N. Runtime privacy boundary.** Confirmed today: no raw payload leaves the device for classification (all detectors `local:true`; the LLM sees only the contract text). Keep; make `locality` a registry attribute so an `external_optin` detector is impossible to enable without tenant configuration and shows in coverage.

**O. Test architecture.** §10.

## Appendix B — sources read (2026-09-24)

- OpenAI Structured Outputs — https://developers.openai.com/api/docs/guides/structured-outputs
- Apache Tika releases/license — https://tika.apache.org/ · tika-server — https://cwiki.apache.org/confluence/display/TIKA/TikaServer · 2.x config — https://cwiki.apache.org/confluence/display/TIKA/TikaServer+in+Tika+2.x · Docker — https://hub.docker.com/r/apache/tika
- Presidio — https://github.com/data-privacy-stack/presidio (moved from microsoft/presidio)
- Gitleaks — https://github.com/gitleaks/gitleaks · default rules — https://raw.githubusercontent.com/gitleaks/gitleaks/master/config/gitleaks.toml
- TruffleHog — https://github.com/trufflesecurity/trufflehog · detect-secrets — https://github.com/Yelp/detect-secrets
- Tree-sitter — https://github.com/tree-sitter/tree-sitter
- ONNX Runtime — https://github.com/microsoft/onnxruntime/blob/main/LICENSE · Node — https://onnxruntime.ai/docs/get-started/with-javascript/node.html
- Tesseract — https://github.com/tesseract-ocr/tesseract · Apple Vision — https://developer.apple.com/documentation/vision/vnrecognizetextrequest
- OPA — https://www.openpolicyagent.org/docs/latest/ · Wasm — https://www.openpolicyagent.org/docs/latest/wasm/ · Cedar — https://github.com/cedar-policy/cedar
- Purview SITs — https://learn.microsoft.com/en-us/purview/sit-sensitive-information-type-learn-about · EDM — https://learn.microsoft.com/en-us/purview/sit-learn-about-exact-data-match-based-sits · fingerprinting — https://learn.microsoft.com/en-us/purview/document-fingerprinting · named entities — https://learn.microsoft.com/en-us/purview/sit-named-entities-learn · trainable classifiers — https://learn.microsoft.com/en-us/purview/trainable-classifiers-learn-about · MIP label metadata — https://learn.microsoft.com/en-us/information-protection/develop/concept-mip-metadata
- Google Sensitive Data Protection — transformations https://docs.cloud.google.com/sensitive-data-protection/docs/transformations-reference · custom infoTypes https://docs.cloud.google.com/sensitive-data-protection/docs/creating-custom-infotypes
- AWS Macie custom data identifiers — https://docs.aws.amazon.com/macie/latest/user/cdis-options.html
- NIST SP 800-38G — https://csrc.nist.gov/pubs/sp/800/38/g/upd1/final · Rev. 1 draft status — https://csrc.nist.gov/news/2025/comment-on-the-2nd-draft-of-sp-800-38g-rev-1

## Appendix C — verification log

- 35 first-hand claims (H1–H22, G1/G2/G3/G5/G9/G12, F1–F7) were handed to seven independent skeptic agents instructed to refute by default. **33 confirmed** (with the line-number and wording corrections now applied above); **2 refuted on detail**: H7 (11 secret patterns, not 12) and F7 (the runtime *does* have a self-check suite, `runtime/src/selfcheck.ts`, 59 checks — the report now says so). No claim was refuted on substance.
- A first, broader multi-agent audit run was abandoned: its readers stalled generating oversized outputs and were repeatedly restarted by the harness. Nothing from it is used here.
- The two capped "blind finder" agents did not complete either; I replaced them with a targeted first-hand check of the transport paths (never-decrypt list, WebSocket, CONNECT-level decision), which produced G14 and G15. Coverage of *unknown unknowns* is therefore weaker than the verified list above — the test matrix in §10 is what closes that permanently.
- All three existing suites were run unchanged on 2026-09-24 and pass (regression 302 cases; properties 5916/0; runtime self-check 59/0).
