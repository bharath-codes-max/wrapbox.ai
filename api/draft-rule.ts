/* Server-side rule drafter.
 *
 * Runs on Vercel as a Node serverless function, so OPENAI_API_KEY stays on the server: it is
 * never sent to the browser, never bundled, never logged, never written into a rule or YAML.
 *
 * The model only DRAFTS. It proposes a rule, this function validates that draft against the
 * Wrapbox rule schema, and a person still reviews it in the builder and publishes it. Runtime
 * ALLOW / CONSTRAIN / REVIEW / BLOCK decisions never involve a model.
 *
 * GET  → { configured, model }        status only, no secret
 * POST → { rule, understood, unsupported, missing, source }
 */

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

/* The vocabulary the engine understands. Kept in step with src/data/contract.ts. */
const EFFECTS = [
  { id: "filesystem.read", label: "Read a file", fields: ["path", "env"] },
  { id: "filesystem.write", label: "Write or delete a file", fields: ["path", "env"] },
  { id: "shell.exec", label: "Run a command", fields: ["command", "env"] },
  { id: "git.push", label: "Push to a branch", fields: ["branch", "command"], constrain: "force-with-lease" },
  { id: "git.merge", label: "Merge into a branch", fields: ["branch"] },
  { id: "database.read", label: "Read from a database", fields: ["columns", "env"], constrain: "mask" },
  { id: "database.write", label: "Change rows", fields: ["env"] },
  { id: "database.migrate", label: "Change a schema", fields: ["env"] },
  { id: "payments.refund", label: "Refund a payment", fields: ["amount"], unit: "USD" },
  { id: "claims.payout", label: "Pay out a claim", fields: ["amount"], unit: "INR" },
  { id: "crm.apply_discount", label: "Give a discount", fields: ["amount"], unit: "%" },
  { id: "payment.submit", label: "Submit a payment in a browser", fields: ["amount"], unit: "USD" },
  { id: "network.egress", label: "Send data to a domain", fields: ["destination"] },
  { id: "purchase.order", label: "Place a delegated order", fields: [] },
] as const;
const EFFECT_IDS = EFFECTS.map((e) => e.id);
const DECISIONS = ["ALLOW", "CONSTRAIN", "REVIEW", "BLOCK"];
const ENVS = ["production", "staging", "development"];
const SUBJECTS = ["ide", "cli", "cloud", "custom", "mcp", "saas", "browser", "a2a"];
const GROUPS = ["oncall-sre", "payments-manager", "claims-manager", "sales-manager", "vp-sales", "finance-controller", "security", "admin"];

const SYSTEM = `You turn a company admin's policy sentence into ONE draft authorization rule for Wrapbox, a runtime permit layer for AI agents.

Work through the WHOLE text clause by clause. Enterprise policies run to several paragraphs and every paragraph usually carries a different construct. Losing a clause is the worst failure mode — map each one onto the closest field below.

Effects (pick exactly one):
${EFFECTS.map((e) => `- ${e.id} — ${e.label}${"unit" in e && e.unit ? ` (amount in ${e.unit})` : ""}`).join("\n")}

HOW TO MAP CLAUSES
- "only if / only when / provided that / must have / must match / must hold" → requires (context that must be proven).
- "must never / may not / is forbidden to" applied to CONTENT the action carries (SQL, a command) → forbid (short lowercase fragments such as "drop table", "truncate", "disable row level security").
- "if X then require approval from …", thresholds on counts, or categories of data/schema → escalations, one entry per branch, each with its own approvers and quorum.
- "single-use / one-time / valid for N seconds / bound to …" → permit (ttl_seconds, single_use, bind).
- "if anything is missing / unverifiable / stale / cannot be proven → block", or "default: BLOCK" → fail_closed: true.
- money or percentage thresholds → tiers (not escalations).

CONTEXT KEY VOCABULARY (reuse these names; invent new dotted keys only when nothing fits)
pr.approvals, pr.number, sha.reviewed, sha.deployment, sha.deployment_matches_reviewed,
ci.required_checks_passed, security.checks_passed,
parent.holds_production_authority, parent.id, delegation.explicit, delegation.privilege_escalation,
agent.id, repo, env, db.id, artifact.hash, sql.hash, sql.matches_reviewed_artifact,
tables.count, tables.sensitive, tables.set, approvals.set, policy.version.

WORKED EXAMPLE (a different policy — follow its SHAPE, never copy its content)
Sentence: "A cloud agent may deploy to staging only when the build passed and the release was signed off by one reviewer. It must never run rm -rf or curl piped to a shell. If it touches more than 5 services, require the release manager; if it touches a billing service, require the release manager and the finance controller. Give it a one-time permit good for 30 seconds tied to the repo and build id. If anything cannot be verified, block."
Produces: effect shell.exec; subject ["cloud"]; env ["staging"];
requires [{key: build.passed, op: is, value: true}, {key: release.approvals, op: gte, value: 1}];
forbid ["rm -rf", "curl | sh"];
escalations [{when:[{key: services.count, op: gt, value: 5}], decision: REVIEW, approvers: "release-manager", quorum: 1},
             {when:[{key: services.billing, op: is, value: true}], decision: REVIEW, approvers: "release-manager,finance-controller", quorum: 2}];
permit {ttl_seconds: 30, single_use: true, bind: ["repo", "build.id"]};
fail_closed true.

OTHER FIELDS
- decision: ALLOW, CONSTRAIN, REVIEW or BLOCK. Use tiers instead when the threshold is money or a percentage.
- CONSTRAIN is only valid for database.read (constrain "mask") and git.push (constrain "force-with-lease"); otherwise use REVIEW.
- approver groups: ${GROUPS.join(", ")}. Combine with commas when a clause names several. Use "admin" only if genuinely unclear.
- quorum: the number of people that clause requires.
- env only when the text names production, staging or development. subject only when it names a kind of agent (coding agents → ide, cli, cloud).
- understood: short label/value pairs for a non-technical reader, one per clause you mapped.
- unsupported: only things this schema genuinely cannot express — time-of-day windows, rate limits, per-person approvers, geography, spend budgets over time, or re-evaluation/invalidation timing beyond the permit fields.
- missing: what the text still needs before it can become a rule.
- requirements: every distinct requirement in the text, in the author's own words, with representable=true and the field it mapped to whenever you did map it.
- Never invent a threshold, approver or decision the text does not state.
- title: a short sentence-case title. why: the reason an employee sees when stopped.`;

const OPS = ["is", "not", "gte", "lte", "gt", "lt", "in", "not_in"];
const COND = {
  type: "object",
  additionalProperties: false,
  required: ["key", "op", "value"],
  properties: {
    key: { type: "string", description: "dotted context key, e.g. pr.approvals, ci.required_checks_passed, tables.count, tables.sensitive" },
    op: { type: "string", enum: OPS },
    value: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "array", items: { type: "string" } }] },
  },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["effect", "path", "command", "branch", "env", "columns", "destination_not_in", "credentials", "subject", "decision", "tiers", "unit", "approvers", "quorum", "constrain", "title", "why", "understood", "unsupported", "missing", "requirements", "requires", "forbid", "escalations", "permit", "fail_closed"],
  properties: {
    effect: { type: ["string", "null"], enum: [...EFFECT_IDS, null] },
    path: { type: "array", items: { type: "string" } },
    command: { type: "array", items: { type: "string" } },
    branch: { type: "array", items: { type: "string" } },
    env: { type: "array", items: { type: "string", enum: ENVS } },
    columns: { type: "array", items: { type: "string" } },
    destination_not_in: { type: "array", items: { type: "string" } },
    credentials: { type: ["boolean", "null"] },
    subject: { type: "array", items: { type: "string", enum: SUBJECTS } },
    decision: { type: ["string", "null"], enum: [...DECISIONS, null] },
    tiers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["max", "decision", "approvers", "quorum"],
        properties: {
          max: { type: ["number", "null"] },
          decision: { type: "string", enum: DECISIONS },
          approvers: { type: ["string", "null"] },
          quorum: { type: ["number", "null"] },
        },
      },
    },
    unit: { type: ["string", "null"], enum: ["USD", "INR", "%", null] },
    approvers: { type: ["string", "null"] },
    quorum: { type: ["number", "null"] },
    constrain: { type: ["string", "null"], enum: ["mask", "force-with-lease", null] },
    title: { type: "string" },
    why: { type: "string" },
    understood: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } } },
    },
    unsupported: { type: "array", items: { type: "string" } },
    missing: { type: "array", items: { type: "string" } },
    requires: { type: "array", items: COND },
    forbid: { type: "array", items: { type: "string" } },
    escalations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["when", "decision", "approvers", "quorum", "why"],
        properties: { when: { type: "array", items: COND }, decision: { type: "string", enum: DECISIONS }, approvers: { type: ["string", "null"] }, quorum: { type: ["number", "null"] }, why: { type: ["string", "null"] } },
      },
    },
    permit: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["ttl_seconds", "single_use", "bind"],
      properties: { ttl_seconds: { type: "number" }, single_use: { type: ["boolean", "null"] }, bind: { type: "array", items: { type: "string" } } },
    },
    fail_closed: { type: ["boolean", "null"] },
    requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "representable", "field"],
        properties: { text: { type: "string" }, representable: { type: "boolean" }, field: { type: ["string", "null"] } },
      },
    },
  },
};

const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const arr = (x: unknown) => (Array.isArray(x) ? x.map(String).filter(Boolean) : undefined);
const clean = <T,>(x: T[] | undefined) => (x && x.length ? x : undefined);

/** Validate the model's draft against the Wrapbox rule schema. Anything off-schema is dropped or rejected. */
function toRule(d: Record<string, unknown>, existingIds: string[]) {
  const effect = str(d.effect);
  if (!effect || !EFFECT_IDS.includes(effect as (typeof EFFECT_IDS)[number])) return { rule: null, reason: "no usable effect" };
  const info = EFFECTS.find((e) => e.id === effect)!;
  const fields: readonly string[] = info.fields;

  let decision = str(d.decision);
  if (decision && !DECISIONS.includes(decision)) decision = undefined;

  const rawTiers = Array.isArray(d.tiers) ? (d.tiers as Record<string, unknown>[]) : [];
  let tiers = rawTiers
    .filter((t) => DECISIONS.includes(String(t.decision)))
    .map((t) => ({
      max: t.max === null || t.max === undefined ? null : Number(t.max),
      decision: String(t.decision) as "ALLOW" | "CONSTRAIN" | "REVIEW" | "BLOCK",
      approvers: str(t.approvers),
      quorum: t.quorum ? Number(t.quorum) : undefined,
    }));
  // tiers only make sense for amount effects, must be ordered, and end with an open band
  if (!fields.includes("amount")) tiers = [];
  if (tiers.length) {
    const bounded = tiers.filter((t) => t.max !== null).sort((a, b) => (a.max as number) - (b.max as number));
    const open = tiers.find((t) => t.max === null) ?? { max: null, decision: "REVIEW" as const, approvers: "admin", quorum: undefined };
    tiers = [...bounded, open];
    if (tiers.some((t) => t.max !== null && !Number.isFinite(t.max))) return { rule: null, reason: "a tier limit was not a number" };
  }

  let constrain = str(d.constrain);
  if (constrain && constrain !== (info as { constrain?: string }).constrain) constrain = undefined;
  if (decision === "CONSTRAIN" && !constrain) decision = "REVIEW";

  let approvers = str(d.approvers);
  if (approvers && !GROUPS.includes(approvers)) approvers = approvers.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 40) || "admin";
  if (decision === "REVIEW" && !approvers) approvers = "admin";

  // The engine checks these on any effect, so keep every one the model returned rather than
  // filtering by the effect's UI fields (that silently dropped conditions).
  const when: Record<string, unknown> = { effect: [effect] };
  when.path = clean(arr(d.path));
  when.command = clean(arr(d.command));
  when.branch = clean(arr(d.branch));
  when.columns = clean(arr(d.columns));
  when.destinationNotIn = clean(arr(d.destination_not_in));
  when.env = clean(arr(d.env)?.filter((e) => ENVS.includes(e)));
  if (d.credentials === true) when.credentials = true;
  const subject = clean(arr(d.subject)?.filter((s) => SUBJECTS.includes(s)));
  if (subject) when.subject = subject;
  for (const k of Object.keys(when)) if (when[k] === undefined) delete when[k];

  const conds = (v: unknown) => {
    const out = (Array.isArray(v) ? v : [])
      .map((x) => {
        const c = (x ?? {}) as Record<string, unknown>;
        const key = str(c.key);
        const op = str(c.op);
        if (!key || !op || !OPS.includes(op)) return null;
        const raw = c.value;
        const value = Array.isArray(raw) ? raw.map(String) : typeof raw === "number" || typeof raw === "boolean" ? raw : String(raw ?? "");
        return { key, op, value };
      })
      .filter(Boolean);
    return out.length ? out : undefined;
  };
  const requires = conds(d.requires);
  if (requires) when.requires = requires;
  const forbid = clean(arr(d.forbid));
  const escalations = (Array.isArray(d.escalations) ? d.escalations : [])
    .map((x) => {
      const e = (x ?? {}) as Record<string, unknown>;
      const w = conds(e.when);
      const dec = str(e.decision);
      if (!w || !dec || !DECISIONS.includes(dec)) return null;
      return { when: w, decision: dec, approvers: str(e.approvers), quorum: e.quorum ? Number(e.quorum) : undefined, why: str(e.why) };
    })
    .filter(Boolean);
  const pm = (d.permit ?? null) as Record<string, unknown> | null;
  const permit = pm && pm.ttl_seconds ? { ttlSeconds: Number(pm.ttl_seconds), singleUse: pm.single_use === true ? true : undefined, bind: clean(arr(pm.bind)) } : undefined;

  // A rule is complete when it carries a decision, tiers, or the conditional machinery of a
  // default-deny policy (fail-closed context, prohibitions, or escalation branches).
  const failClosed = d.fail_closed === true;
  const conditional = failClosed || !!forbid || escalations.length > 0 || !!requires;
  if (!decision && !tiers.length) {
    if (!conditional) return { rule: null, reason: "no decision" };
    // "default: BLOCK" with conditional branches → ALLOW the shape, let the branches and the
    // fail-closed context do the refusing; a bare fail-closed rule defaults to BLOCK.
    decision = escalations.length || forbid ? "ALLOW" : "BLOCK";
  }

  const base = tiers.length ? `${effect}.tiers` : `${effect}.${(decision ?? "rule").toLowerCase()}`;
  let id = base;
  for (let i = 2; existingIds.includes(id); i++) id = `${base}.${i}`;

  const title = (str(d.title) ?? info.label).slice(0, 90);
  const rule = {
    id,
    title,
    why: (str(d.why) ?? title).slice(0, 200),
    when,
    ...(tiers.length ? { tiers, unit: (info as { unit?: string }).unit } : { decision }),
    ...(approvers && !tiers.length ? { approvers } : {}),
    ...(d.quorum && !tiers.length ? { quorum: Number(d.quorum) } : {}),
    ...(constrain ? { constrain } : {}),
    ...(forbid ? { forbid } : {}),
    ...(escalations.length ? { escalations } : {}),
    ...(permit ? { permit } : {}),
    ...(failClosed ? { failClosed: true } : {}),
    scope: /payment|claim|discount|purchase/.test(effect) ? "business" : /git|filesystem|shell/.test(effect) ? "coding" : "all",
    custom: true,
  };
  return { rule, reason: "" };
}

export default async function handler(req: { method?: string; body?: unknown }, res: ResponseLike) {
  const key = process.env.OPENAI_API_KEY;

  if (req.method === "GET") return res.status(200).json({ configured: !!key, model: key ? MODEL : null });
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (!key) return res.status(501).json({ error: "not configured", configured: false });

  let body: { sentence?: string; existingIds?: string[]; debug?: boolean } = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : ((req.body ?? {}) as typeof body);
  } catch {
    return res.status(400).json({ error: "bad request body" });
  }
  // Enterprise policy language runs to paragraphs. 500 chars truncated real intents mid-clause and
  // everything after the cut never reached the model.
  const sentence = (body.sentence ?? "").toString().trim().slice(0, 8000);
  const existingIds = Array.isArray(body.existingIds) ? body.existingIds.map(String).slice(0, 200) : [];
  if (sentence.length < 4) return res.status(400).json({ error: "sentence too short" });

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: sentence },
        ],
        response_format: { type: "json_schema", json_schema: { name: "wrapbox_rule_draft", strict: true, schema: SCHEMA } },
      }),
    });
    if (!r.ok) {
      // Never echo the upstream body — it can contain request context. Status only.
      return res.status(502).json({ error: `openai request failed (${r.status})` });
    }
    const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: "empty response from openai" });

    const parsed = JSON.parse(content) as Record<string, unknown>;
    const { rule, reason } = toRule(parsed, existingIds);
    const built = (rule ?? {}) as { when?: Record<string, unknown>; decision?: string; tiers?: unknown[]; approvers?: string; quorum?: number; constrain?: string };
    const landed = (field: string | undefined) => {
      if (!field) return false;
      const f = field.toLowerCase();
      const w = built.when ?? {};
      if (f.includes("effect")) return !!w.effect;
      if (f.includes("path")) return !!w.path;
      if (f.includes("command")) return !!w.command;
      if (f.includes("branch")) return !!w.branch;
      if (f.includes("env")) return !!w.env;
      if (f.includes("column") || f.includes("pii")) return !!w.columns;
      if (f.includes("destination") || f.includes("domain")) return !!w.destinationNotIn;
      if (f.includes("credential")) return !!w.credentials;
      if (f.includes("agent") || f.includes("subject")) return !!w.subject;
      if (f.includes("tier") || f.includes("amount") || f.includes("limit")) return !!built.tiers;
      if (f.includes("approver")) return !!(built.approvers || (built.tiers as { approvers?: string }[] | undefined)?.some((t) => t.approvers));
      if (f.includes("quorum")) return !!built.quorum || !!(built.tiers as { quorum?: number }[] | undefined)?.some((t) => t.quorum);
      if (f.includes("constrain") || f.includes("rewrite") || f.includes("mask")) return !!built.constrain;
      if (f.includes("decision")) return !!built.decision || !!built.tiers;
      return false;
    };
    const reqRaw = Array.isArray(parsed.requirements) ? (parsed.requirements as { text?: unknown; representable?: unknown; field?: unknown }[]) : [];
    const requirements = reqRaw
      .filter((q) => str(q.text))
      .map((q) => {
        const text = String(q.text).slice(0, 200);
        const field = str(q.field);
        const represented = q.representable === true && landed(field);
        return { text, field: field ?? null, represented };
      });
    const understood = Array.isArray(parsed.understood)
      ? (parsed.understood as { label?: unknown; value?: unknown }[]).filter((u) => str(u.label) && str(u.value)).map((u) => ({ label: String(u.label).slice(0, 40), value: String(u.value).slice(0, 120) }))
      : [];
    const unsupported = (arr(parsed.unsupported) ?? []).map((s) => s.slice(0, 160));
    const missing = rule ? (arr(parsed.missing) ?? []) : [...(arr(parsed.missing) ?? []), reason].filter(Boolean);

    const notRepresented = requirements.filter((q) => !q.represented).map((q) => q.text);
    return res.status(200).json({
      rule,
      understood,
      unsupported: [...unsupported, ...notRepresented.filter((t) => !unsupported.includes(t))],
      missing,
      requirements,
      source: "openai",
      model: MODEL,
      // Opt-in: the model's own structured output, to see what it extracted before mapping.
      ...(body.debug ? { raw: { decision: parsed.decision, requires: parsed.requires, forbid: parsed.forbid, escalations: parsed.escalations, permit: parsed.permit, fail_closed: parsed.fail_closed } } : {}),
    });
  } catch (e) {
    return res.status(502).json({ error: "could not reach openai", detail: e instanceof Error ? e.message.slice(0, 120) : undefined });
  }
}

interface ResponseLike {
  status: (code: number) => { json: (body: unknown) => unknown };
}
