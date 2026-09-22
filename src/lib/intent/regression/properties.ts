/**
 * Property + invariant tests for the Intent compiler (§23).
 *
 * These assert LAWS that must hold for EVERY contract, not specific sentences:
 * monotonicity of authority, no-fake-enforcement, and the honesty of the
 * capability system. Written with a deterministic generator (no new dependency
 * — the recommended future upgrade is fast-check; the enumeration here covers
 * the same laws immediately and lean). Run: npx tsx …/properties.ts
 */

import { readFileSync } from "node:fs";
import { validateSurface, type SurfaceClause } from "../validate";
import { compileToRule, compileContract } from "../compile";
import { requirements, deriveStatus, type Status } from "../capabilities";
import { networkCapabilities, futurePlaneCapabilities, NETWORK_RUNTIME } from "../runtime";
import { detectableFamilies } from "../detectors";
import type { IntentClause, Decision } from "../schema";

let pass = 0, fail = 0;
const fails: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++; else { fail++; fails.push(`${name}${detail ? " — " + detail : ""}`); }
}

/* A small generator space: every combination of these facets. */
const SUBJECTS: SurfaceClause["subject"][] = [undefined, { agentClass: ["browser"] }, { group: ["employees"] }, { user: ["a@b.com"] }];
const ACTIONS = ["read", "upload", "delete", "query", "charge", "invoke", "configure"];
const RESOURCES = ["file", "table", "endpoint", "iam role", "payment", "mcp tool", "repo"];
const DESTS: (SurfaceClause["destination"] | undefined)[] = [undefined, { service: ["ChatGPT"] }, { category: "external ai", trust: "external" }, { group: "undefined_grp" }];
const DATAS: (SurfaceClause["data"] | undefined)[] = [undefined, { classes: ["EMAIL"] }, { classes: ["SECRET"] }, { classes: ["FINANCIAL"] }, { classes: ["EMAIL", "SECRET"] }];
const DECISIONS = ["allow", "constrain", "review", "block"];

function* space(): Generator<SurfaceClause> {
  let i = 0;
  for (const subject of SUBJECTS)
    for (const action of ACTIONS)
      for (const kind of RESOURCES)
        for (const destination of DESTS)
          for (const data of DATAS)
            for (const decision of DECISIONS) {
              i++;
              if (i % 7 !== 0) continue;  // sample every 7th → ~a few thousand
              const c: SurfaceClause = { text: `gen-${i}`, action, resource: { kind }, decision };
              if (subject) c.subject = subject;
              if (destination) c.destination = destination;
              if (data) c.data = data;
              if (decision === "constrain") c.constraint = [{ handler: "data.transform", params: data?.classes ? { classes: data.classes } : {} }];
              if (decision === "review") c.approvers = ["secops"];
              yield c;
            }
}

const RANK: Record<string, number> = { ALLOW: 0, CONSTRAIN: 1, REVIEW: 2, BLOCK: 3 };

for (const surface of space()) {
  const v = validateSurface([surface]);
  const c = v.clauses[0];
  if (!c) continue;
  const b = c.binding;

  // LAW 1 — no fake enforcement: an ENFORCED clause must compile to a runnable
  // rule with a real predicate (or be the catch-all), and every predicate field
  // must be one the runtime actually observes.
  if (b.status === "enforced") {
    const out = compileToRule(c);
    check("enforced-compiles", out.runnable, c.source?.text);
    if (out.runnable && out.rule.condition) {
      const conds = Array.isArray(out.rule.condition) ? out.rule.condition : [out.rule.condition];
      check("enforced-fields-observed", conds.every((p) => NETWORK_RUNTIME.fields.has(p.field)), JSON.stringify(conds));
    }
  }

  // LAW 2 — CONSTRAIN never silently becomes ALLOW: if the effective decision
  // differs from CONSTRAIN it may only be BLOCK (fail closed), never ALLOW.
  if (c.decision === "CONSTRAIN" && b.effectiveDecision !== "CONSTRAIN") {
    check("constrain-never-allow", b.effectiveDecision === "BLOCK", `${c.source?.text} → ${b.effectiveDecision}`);
  }

  // LAW 3 — effective decision never widens: it can only move toward BLOCK.
  check("effective-le-declared", RANK[b.effectiveDecision] >= RANK[c.decision] || b.effectiveDecision === c.decision, `${c.decision}→${b.effectiveDecision}`);

  // LAW 4 — a compiled rule's effect is the EFFECTIVE decision, not the aspirational one.
  const out = compileToRule(c);
  if (out.runnable) {
    const eff = b.effectiveDecision.toLowerCase();
    check("compiled-effect-honest", out.rule.effect === eff || (out.rule.effect === "block" && b.effectiveDecision === "CONSTRAIN"), `${out.rule.effect} vs ${eff}`);
  }

  // LAW 5 — understood_only / pending NEVER compile to a runnable rule (nothing
  // unenforced may leak a predicate into the daemon).
  if (b.status === "understood_only" || b.status === "pending") {
    check("unenforced-does-not-compile", !compileToRule(c).runnable, `${b.status}: ${c.source?.text}`);
  }
}

// LAW 6 — MONOTONICITY: adding a stricter (higher-severity) clause to a contract
// never removes or weakens an existing clause's rule. Compile a base contract,
// then the base + a BLOCK, and assert every base rule still present, unchanged.
{
  const base: SurfaceClause[] = [
    { kind: "definition", text: "d", definition: { group: "ai", members: ["ChatGPT"] } },
    { text: "emails tokenized", action: "disclose", resource: { kind: "endpoint" }, destination: { group: "ai" }, data: { classes: ["EMAIL"] }, decision: "constrain", constraint: [{ handler: "data.transform", params: { classes: ["EMAIL"] } }] },
    { text: "allow all", catchAll: true, action: "connect", resource: { kind: "endpoint" }, decision: "allow" },
  ];
  const stricter: SurfaceClause[] = [...base, { text: "secrets blocked", action: "disclose", resource: { kind: "endpoint" }, destination: { group: "ai" }, data: { classes: ["SECRET"] }, decision: "block" }];
  const r1 = compileContract(validateSurface(base).clauses).rules.map((r) => JSON.stringify({ e: r.effect, c: r.condition }));
  const r2 = compileContract(validateSurface(stricter).clauses).rules.map((r) => JSON.stringify({ e: r.effect, c: r.condition }));
  check("monotonicity-adds-only", r1.every((x) => r2.includes(x)) && r2.length === r1.length + 1, `base ${r1.length} → strict ${r2.length}`);
}

// LAW 7 — a renamed file cannot defeat a content policy: a SECRET rule pins on
// content_kinds, never on the filename, so its predicate has no filename term.
{
  const v = validateSurface([{ text: "no secrets to ai", action: "disclose", resource: { kind: "file", paths: ["*.yaml"] }, destination: { category: "external ai" }, data: { classes: ["SECRET"] }, decision: "block" }]);
  const out = compileToRule(v.clauses[0]);
  const conds = out.runnable && out.rule.condition ? (Array.isArray(out.rule.condition) ? out.rule.condition : [out.rule.condition]) : [];
  check("content-rule-ignores-filename", conds.some((p) => p.field === "tool_input.content_kinds") && !conds.some((p) => p.field === "tool_input.filenames"), JSON.stringify(conds));
}

// LAW 8 — unknown handler → pending, never enforced/executed.
{
  const v = validateSurface([{ text: "weird", action: "disclose", resource: { kind: "endpoint" }, destination: { service: ["ChatGPT"] }, decision: "constrain", constraint: [{ handler: "image.redact_faces", params: {} }] }]);
  check("unknown-handler-pending", v.clauses[0].binding.status === "pending", v.clauses[0].binding.status);
}

// LAW 9 — an unknown capability is NEVER ENFORCED. deriveStatus over a random
// requirement no plane provides must be pending.
{
  const fakeClause = { subject: { any: true }, action: { verbs: ["read"] as any }, resource: { type: "any" as any }, data: { classes: ["QUANTUMFOO"] }, decision: "BLOCK" as Decision, binding: {} as any, authority: "ceiling" as const, origin: "contract" as const, id: "x", priority: 1 } as IntentClause;
  const verdict = deriveStatus(requirements(fakeClause), [networkCapabilities(), ...futurePlaneCapabilities()]);
  check("unknown-capability-not-enforced", verdict.status !== "enforced", verdict.status as Status);
}

// LAW 10 — DRIFT GUARD against the RUNTIME SELF-DESCRIPTION (§7). The runtime is
// the source of truth: `wrapboxd capabilities` emits what the daemon really
// observes/classifies, snapshotted to runtime.capabilities.json. The compiler's
// mirror MUST match it — otherwise the compiler could call a class ENFORCED that
// the daemon cannot detect. Regenerate the snapshot when the runtime changes.
{
  type Desc = { plane: string; observes: string[]; classifiers: { family: string; local: boolean }[]; handlers: string[] };
  const snap = JSON.parse(readFileSync(new URL("./runtime.capabilities.json", import.meta.url), "utf8")) as Desc[];
  const net = snap.find((d) => d.plane === "network")!;

  // Content families: the compiler's detector registry must equal the runtime's
  // locally-deployed classifier families exactly.
  const runtimeFamilies = [...new Set(net.classifiers.filter((c) => c.local).map((c) => c.family))].sort();
  const compilerFamilies = [...detectableFamilies()].sort();
  check("classifier-mirror-matches-runtime", JSON.stringify(compilerFamilies) === JSON.stringify(runtimeFamilies), `compiler ${compilerFamilies} vs runtime ${runtimeFamilies}`);

  // NETWORK_RUNTIME.contentKinds is the compiler's coarse-vocabulary mirror; it
  // must not drift from the runtime's classifier families either.
  const compilerContentKinds = [...NETWORK_RUNTIME.contentKinds].sort();
  check("contentkinds-mirror-matches-runtime", JSON.stringify(compilerContentKinds) === JSON.stringify(runtimeFamilies), `contentKinds ${compilerContentKinds} vs runtime ${runtimeFamilies}`);

  // Observed fields the compiler pins predicates on must all be fields the
  // runtime actually populates (compiler ⊆ runtime observes).
  const runtimeObserves = new Set(net.observes);
  const unbacked = [...NETWORK_RUNTIME.fields].filter((f) => !runtimeObserves.has(f));
  check("observed-fields-backed-by-runtime", unbacked.length === 0, `compiler fields not in runtime self-description: ${unbacked}`);

  // The one transform handler the compiler treats as executable must be one the
  // runtime reports it executes.
  check("handler-mirror-matches-runtime", net.handlers.includes("data.transform"), `runtime handlers: ${net.handlers}`);
}

console.log(`\nPROPERTY TESTS — PASS ${pass} / FAIL ${fail}`);
for (const f of fails.slice(0, 30)) console.log("  ✗ " + f);
if (fail > 0) process.exitCode = 1;
