/**
 * Semantic extraction: a plain-English intent contract → typed surface clauses.
 *
 *   English → LLM structured extraction → SurfaceClause[] → deterministic
 *   validator → canonical normalization → destination/resource resolution →
 *   plane binding → runtime capability check → compiled rule → enforcement
 *
 * The model's job is UNDERSTANDING: segment the paragraph into atomic
 * statements, resolve negation and exceptions, recognise definitions of
 * destination groups, recognise runtime safety invariants, keep named
 * destinations exact, and label everything with typed fields. It emits
 * strict JSON against the schema below.
 *
 * The model's output is NEVER trusted for enforcement. Every field goes
 * through the deterministic validator (src/lib/intent/validate.ts), which owns
 * the controlled vocabulary, the negation guard, precedence, the honesty rules
 * and the runtime capability check. A model that over-reaches produces a
 * rejected or downgraded clause — it can never manufacture authority.
 *
 * SECRET HANDLING: OPENAI_API_KEY is read here, server-side, and never
 * returned, logged, or echoed. The browser only ever sees surface clauses.
 */

import { extractionJsonSchema, SurfaceIRSchema, type SurfaceClause as IRClause } from "@wrapbox/registry";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const TIMEOUT_MS = 45_000;

/**
 * Structured Outputs: the model is bound to the Surface IR JSON Schema
 * (generated from the registry's Zod schema, every key required,
 * additionalProperties:false). Valid JSON proves the SHAPE only; the
 * validator re-checks every meaning against the registries.
 */
const RESPONSE_FORMAT = { type: "json_schema", json_schema: { name: "wrapbox_surface_ir", strict: true, schema: extractionJsonSchema() } } as const;

/**
 * The Surface IR clause → the validator's SurfaceClause. A pure reshaping:
 * nothing is inferred here, and unknown data-type phrases travel verbatim so
 * the validator can resolve them against the Data Type Registry (or flag a
 * CUSTOM candidate) — never dropped, never guessed.
 */
function toSurfaceClause(c: IRClause): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: c.kind, text: c.text, confidence: c.confidence };
  if (c.kind === "definition") {
    out.definition = { group: c.definitionGroup ?? "", ...(c.definitionLabel ? { label: c.definitionLabel } : {}), members: c.definitionMembers ?? [] };
    return out;
  }
  if (c.kind === "invariant") { if (c.invariant) out.invariant = c.invariant; return out; }
  const subj: Record<string, string[]> = {};
  if (c.subjectKind === "agent_class") subj.agentClass = c.subjectRefs ?? ["any"];
  else if (c.subjectKind === "group") subj.group = c.subjectRefs ?? [];
  else if (c.subjectKind === "user") subj.user = c.subjectRefs ?? [];
  else if (c.subjectKind === "device" || c.subjectKind === "workload") subj.agentId = c.subjectRefs ?? [];
  if (Object.keys(subj).length) out.subject = subj;
  if (c.action) out.action = c.action;
  const res: Record<string, unknown> = {};
  if (c.resourceKind) res.kind = c.resourceKind;
  if (c.resourceRefs?.length) res.ref = c.resourceRefs;
  if (c.resourcePaths?.length) res.paths = c.resourcePaths;
  if (c.resourceExcludePaths?.length) res.excludePaths = c.resourceExcludePaths;
  if (Object.keys(res).length) out.resource = res;
  const d = c.destination;
  if (d && (d.services?.length || d.group || d.class || d.hosts?.length || d.notInServices?.length || d.notInGroup || d.notInClass || d.trust)) {
    const dest: Record<string, unknown> = {};
    if (d.services?.length) dest.service = d.services;
    // A group named BOTH positively and as the complement ("anywhere other than
    // the approved services") is the complement only — keeping both would make
    // the rule match nothing, i.e. silently never fire.
    if (d.group && d.group !== d.notInGroup) dest.group = d.group;
    if (d.class) dest.classes = [d.class];
    if (d.hosts?.length) dest.host = d.hosts;
    if (d.notInServices?.length || d.notInGroup || d.notInClass) {
      dest.notIn = { ...(d.notInGroup ? { group: d.notInGroup } : {}), ...(d.notInServices?.length ? { service: d.notInServices } : {}), ...(d.notInClass ? { classes: [d.notInClass] } : {}) };
    }
    if (d.trust) dest.trust = d.trust;
    out.destination = dest;
  }
  if (c.data?.length) {
    const fields = [...new Set(c.data.flatMap((x) => x.fields ?? []))];
    const minCounts = c.data.map((x) => x.minCount).filter((n): n is number => typeof n === "number" && n >= 1);
    const confs = c.data.map((x) => x.minConfidence).filter((x): x is "low" | "medium" | "high" => !!x);
    const scope = c.data.some((x) => x.scope === "bulk") ? "bulk" : c.data.some((x) => x.scope === "any") ? "any" : null;
    const owner = c.data.map((x) => x.owner).find((x): x is string => !!x) ?? null;
    out.data = { classes: c.data.map((x) => x.name), ...(fields.length ? { fields } : {}),
      minCount: minCounts.length ? Math.max(...minCounts) : null, minConfidence: confs[0] ?? null, scope, owner };
  }
  if (c.environments?.length) out.scope = { environment: c.environments };
  if (c.threshold && (c.threshold.field || c.threshold.op || typeof c.threshold.value === "number")) {
    out.threshold = { ...(c.threshold.field ? { field: c.threshold.field } : {}), ...(c.threshold.op ? { op: c.threshold.op } : {}), ...(typeof c.threshold.value === "number" ? { value: c.threshold.value } : {}), ...(c.threshold.unit ? { unit: c.threshold.unit } : {}) };
  }
  if (c.decision) out.decision = c.decision;
  if (c.transforms?.length) {
    out.constraint = c.transforms.map((t) => {
      let params: Record<string, unknown> = {};
      if (t.params) { try { params = JSON.parse(t.params); } catch { params = {}; } }
      return { handler: "data.transform", params: { handler: t.handler, mode: t.handler === "REDACT" ? "redact" : "reversible_tokenization", ...(t.targets?.length ? { classes: t.targets } : {}), ...(Object.keys(params).length ? { params } : {}) } };
    });
  }
  if (c.approvers?.length) out.approvers = c.approvers;
  if (c.exceptions?.length) out.exceptions = c.exceptions;
  if (c.catchAll) out.catchAll = true;
  if (c.onUnsupported) out.onUnsupported = c.onUnsupported;
  return out;
}

function systemPrompt(): string {
  return `You are the semantic extraction layer of Wrapbox, a runtime authorization system for AI agents.
Wrapbox governs agent actions across files, repos, databases, APIs, MCP tools, browsers, cloud, SaaS,
messaging and payments. You turn an administrator's English policy into ATOMIC, TYPED statements.
You do NOT decide enforcement; a deterministic validator re-checks everything you emit.

Return ONLY a JSON object matching the Surface IR schema you are bound to: { "clauses": Statement[] }.
EVERY key is present on EVERY statement; use null (or [] / false) for what does not apply.

There are THREE kinds of Statement, discriminated by "kind":

1. "definition" — the admin DEFINES a destination group.
   e.g. "approved web-based AI services, including ChatGPT, Claude, and Microsoft Copilot"
   → kind "definition", definitionGroup "approved_ai", definitionLabel "approved AI services",
     definitionMembers ["ChatGPT","Claude","Microsoft Copilot"]. Emit it ONCE; later clauses that say
     "these approved services" refer to it with destination.group = "approved_ai".

2. "invariant" — a RUNTIME SAFETY RULE, not a permission.
   e.g. "If protected information cannot be safely inspected or transformed before transmission, it must
   be blocked rather than transmitted unchanged." → kind "invariant", invariant "fail_closed_transform"
   (and ALSO a second invariant statement "fail_closed_uninspected" when the sentence mentions inspection).
   Known: fail_closed_transform, fail_closed_no_rule, fail_closed_uninspected. Never turn these into clauses.

3. "clause" — ONE subject acting with ONE action on ONE resource, with ONE decision.
   Split aggressively: "read and edit" is two clauses; an exception ("but not to other destinations") is
   its OWN clause with its own decision.

Clause fields:
  text          exact source fragment                confidence  0–1
  subjectKind   "any"|"group"|"user"|"agent_class"|"device"|"workload";  subjectRefs  e.g. ["employees"], ["browser"]
  action        ONE verb: read, write, delete, execute, query, push, merge, invoke, disclose, transact,
                configure, connect, list.  upload/send/share/transmit/submit/post ⇒ "disclose".
                edit/modify/update/overwrite ⇒ "write" (LOCAL modification only, never an upload).
  resourceKind  file, folder, repo, branch, table, database, sql, api, endpoint, "mcp tool", account,
                "iam role", payment, saas;  resourceRefs / resourcePaths / resourceExcludePaths as stated.
  destination   { services: EXACT names as listed or null, group: defined group id or null,
                  class: ONLY when the admin means every destination of a kind —
                    "ANY_AI" (any/all external AI services), "ANY_EXTERNAL" (anywhere external / outside the
                    company), "INTERNAL", "APPROVED_AI", "KNOWN_AI_UNAPPROVED", "UNKNOWN_EXTERNAL" — else null,
                  hosts, notInServices, notInGroup, notInClass (the COMPLEMENT: "any other external
                  destination" ⇒ notInGroup "<approved group>" ), trust "internal"|"external"|null }
                or null when nothing leaves the machine.
  data          list of protected-information PHRASES, one entry per distinct thing named:
                { name: the admin's words ("customer email addresses", "API keys", "trade secrets",
                        "employee IDs" — keep them, the registry resolves them),
                  minCount: a number ONLY when the sentence states one ("more than 100 records"), else null,
                  minConfidence: null unless stated, scope: "bulk" for lists/exports/databases/"records",
                  "any" for "any single…", else null, fields: column names if named else null,
                  owner: "customer"|"employee"|"patient"|… when the data is qualified that way, else null }
                "business documents, tabular data, HTML, configuration files, structured data" are FILE TYPES —
                put them in resourcePaths as globs (["*.doc*","*.pdf","*.csv","*.xlsx","*.html","*.yaml","*.json"]),
                not in data. "source code" IS data (name "source code").
  dataAll       true only when EVERY listed data item must be present together.
  environments  ["production"] etc. or null.   threshold  {field, op, value, unit} or null ("over $500").
  decision      "allow"|"constrain"|"review"|"block".
  transforms    for CONSTRAIN only: [{ handler: "REVERSIBLE_TOKENIZE"|"REDACT"|"MASK"|"HASH"|"DROP_FIELD"|
                "GENERALIZE"|"DATE_SHIFT"|"FORMAT_PRESERVING"|"LIMIT"|"REWRITE", targets: the data names it
                applies to or null (= all listed data), params: JSON string or null }].
                "tokenized" ⇒ REVERSIBLE_TOKENIZE; "redacted/removed" ⇒ REDACT; "masked" ⇒ MASK;
                "capped/limited to N" ⇒ LIMIT with params {"maxRows":N} or {"maxLines":N}.
  approvers     group names for REVIEW ("SRE", "legal", "the deal team") or null.
  exceptions    qualifiers you could not lower ("without credentials") or null.
  catchAll      true ONLY for the one general default permission ("ordinary information may be transmitted
                normally", "everything else is allowed").
  onUnsupported "block"|"review"|"accept_risk"|"hold_activation" when the text says what should happen if
                Wrapbox cannot enforce a protection; else null.

RULES OF INTERPRETATION — these are what make the extraction trustworthy:

DESTINATIONS — preserve EXACT scope, never widen.
- A named list ("ChatGPT, Claude, and Microsoft Copilot") ⇒ destination.services with those exact
  names. NEVER replace a named list with a class.
- A reference to a defined group ("these approved AI services", "approved services") ⇒
  destination.group with the group's id.
- "any other external destination", "anywhere else", "any destination not in the approved list",
  "unapproved destinations" ⇒ notInGroup "<the approved group>" and trust "external". This is the
  COMPLEMENT and it is a real, enforceable destination.
- Use destination.class ONLY when the admin literally means every destination of a kind:
  "any external AI service", "all external AI" ⇒ class "ANY_AI"; "anywhere external", "outside the company",
  "any other external destination" (with no approved list to complement) ⇒ class "ANY_EXTERNAL".
  "to ChatGPT" is a service, not a class.
- "external" alone (no name, no group) ⇒ trust "external" and class "ANY_EXTERNAL"; if AI is meant, "ANY_AI".

NEGATION — resolve it INTO the decision, and be exact.
- "must never", "do not allow", "cannot", "is not permitted", "prohibited" ⇒ decision "block".
- "may", "can", "allowed", "permitted" ⇒ "allow".
- "requires review/approval before", "must be reviewed", "needs sign-off" ⇒ "review".
- "must be tokenized/masked/redacted before", "cap", "limit to", "only via", "read-only" ⇒
  "constrain" with the appropriate handler (data.transform for tokenize/mask/redact).
- "allow only X" means X ⇒ allow AND everything-else ⇒ NOT allowed; emit the allow clause and,
  if the sentence states or clearly implies the complement's decision, the complement clause.
- Double negation ("must not fail to review") ⇒ resolve to the plain meaning ("review").

EXCEPTIONS — "except", "unless", "but not", "other than", "without":
- Emit the main clause AND a separate clause for the exception with its own decision if the
  text gives one; otherwise put the qualifier in "exceptions" so it is never silently dropped.
- "X without credentials or PII may be sent" ⇒ allow X with exceptions ["without credentials",
  "without customer PII"]. The stricter credential/PII rules will outrank it anyway.

ACTIONS — normalize semantically, using the resource to disambiguate.
- upload / send / share / transmit / submit / post ⇒ "disclose" (outbound; NETWORK).
- edit / modify / update / overwrite / append / add-a-row ⇒ "write" ONLY for modifying a local
  resource in place (ENDPOINT). Never use "write" for an upload.
- run/execute a query on a table/database ⇒ "query". run/execute a script/command/process ⇒ "execute".
- call an API / invoke a tool ⇒ "invoke". grant/revoke/assign access or roles ⇒ "configure".
- charge/pay/refund/transfer money ⇒ "transact".

THRESHOLDS keep their meaning: "payments over $500 are blocked" is a BLOCK with a threshold,
not a constrain. Only an explicit narrowing verb ("cap at $500") is a constrain.

DATA — list EVERY protected thing the admin named as its own entry, in the admin's words:
"API keys, passwords, authentication tokens, private keys, client secrets, and other credentials"
⇒ five or six entries (names "API keys", "passwords", "authentication tokens", "private keys",
"client secrets", "other credentials"). "customer email addresses and phone numbers" ⇒ two entries with
owner "customer". Never invent a class; never merge distinct things into one entry.

CATCH-ALL — "ordinary/normal/non-sensitive information may be transmitted normally", "everything
else is allowed" ⇒ one clause with catchAll:true, decision "allow", no destination, no data. Emit at most one.

SUBJECTS — keep "employees", "engineering", "finance", a named user or device as subject.group /
subject.user. Do not drop them. The validator decides whether the runtime can verify them.

CONFIDENCE — set below 0.7 whenever wording is ambiguous, so it is surfaced rather than hidden.

Never invent a decision. Never soften block→review. Never widen a named list to a category.
Return raw JSON only. No markdown, no prose.`;
}

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */

interface Req { method?: string; body?: unknown; query?: Record<string, string> }
interface Res { status: (c: number) => Res; json: (b: unknown) => void; setHeader?: (k: string, v: string) => void; }

export default async function handler(req: Req, res: Res) {
  if (req.method === "GET") {
    return res.status(200).json({ configured: Boolean(process.env.OPENAI_API_KEY), model: MODEL });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return res.status(200).json({ ok: false, reason: "not_configured", message: "No OPENAI_API_KEY on the server. Describe falls back to the built-in segmenter." });
  }

  const body = (req.body ?? {}) as { intent?: unknown };
  const intent = typeof body.intent === "string" ? body.intent.trim() : "";
  if (!intent) return res.status(400).json({ ok: false, reason: "no_intent", message: "Nothing to compile." });
  if (intent.length > 6000) return res.status(400).json({ ok: false, reason: "too_long", message: "Intent is too long (max 6000 characters)." });

  let content = "";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL, temperature: 0, response_format: RESPONSE_FORMAT,
        messages: [{ role: "system", content: systemPrompt() }, { role: "user", content: intent }],
      }),
    });
    clearTimeout(timer);
    if (!r.ok) return res.status(200).json({ ok: false, reason: "upstream_error", message: `The model service returned ${r.status}. Falling back to the built-in segmenter.` });
    const data = (await r.json()) as { choices?: { message?: { content?: string; refusal?: string | null } }[] };
    const msg = data.choices?.[0]?.message;
    if (msg?.refusal) return res.status(200).json({ ok: false, reason: "refusal", message: "The model declined to interpret this text. Falling back to the built-in segmenter." });
    content = msg?.content ?? "";
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    return res.status(200).json({ ok: false, reason: aborted ? "timeout" : "network_error", message: aborted ? "The model took too long. Falling back to the built-in segmenter." : "Could not reach the model service." });
  }

  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch {
    return res.status(200).json({ ok: false, reason: "bad_json", message: "The model did not return valid JSON." });
  }
  // Strict schema on the way in (Structured Outputs) AND on the way out (Zod):
  // a shape the schema did not promise never reaches the validator.
  const checked = SurfaceIRSchema.safeParse(parsed);
  if (!checked.success) {
    return res.status(200).json({ ok: false, reason: "bad_shape", message: `The model's output did not match the Surface IR schema (${checked.error.issues[0]?.path.join(".") ?? "?"}).` });
  }

  // Reshaped, never interpreted. The client validator is the authority on
  // what is enforceable; this endpoint never decides anything.
  return res.status(200).json({ ok: true, clauses: checked.data.clauses.map(toSurfaceClause), model: MODEL, schema: "surface-ir/1.0.0" });
}
