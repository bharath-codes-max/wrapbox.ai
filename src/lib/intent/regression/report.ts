/**
 * Contract report (A–F) over the REAL compiler path.
 *
 * Reads the surface clauses the LIVE /api/compile-intent extractor produced for
 * the verbatim complex contract (saved to /tmp/surface.json), then runs them
 * through the exact production pipeline — validateSurface → capability
 * derivation → resolveBinding → compileContract — and prints:
 *   A normalized atomic clauses (Intent IR)
 *   B concrete destination predicates
 *   C rule priority / overlap resolution
 *   D runtime-observed fields that make each clause enforceable
 *   E final ENFORCED / DEGRADED / UNDERSTOOD_ONLY status
 *   F compiled active rules
 * plus the capability ledger (required / available / missing) per clause.
 *
 * Nothing here decides anything — it only formats what the compiler returns.
 * Run: npx tsx src/lib/intent/regression/report.ts
 */

import { readFileSync } from "node:fs";
import { validateSurface, type SurfaceClause } from "../validate";
import { compileContract } from "../compile";
import { requirements, deriveStatus } from "../capabilities";
import { networkCapabilities, futurePlaneCapabilities } from "../runtime";
import { resolveDestination } from "../resolve-dest";
import type { IntentClause } from "../schema";

const surface = JSON.parse(readFileSync("/tmp/surface.json", "utf8")) as { clauses: SurfaceClause[] };
// The proxy is ON in this environment, so a scoped network rule is route-covered.
const v = validateSurface(surface.clauses);
const clauses = v.clauses;

const planes = [networkCapabilities({ routeEnforced: true }), ...futurePlaneCapabilities()];
const available = new Set<string>();
for (const p of planes) if (p.deployed) for (const c of p.provides) available.add(c);

function facet(c: IntentClause): string {
  const s = c.subject;
  const subj = s.any ? "any agent" : [s.agentClass?.join("/"), s.group?.length ? `group:${s.group.join(",")}` : "", s.user?.length ? `user:${s.user.join(",")}` : ""].filter(Boolean).join(" ") || "any";
  const verb = (c.action.verbs ?? [c.action.verb]).filter(Boolean).join("/");
  const res = c.resource.type + (c.resource.paths?.length ? ` ${c.resource.paths.join(",")}` : "");
  const dst = c.destination ? JSON.stringify(c.destination) : "—";
  const data = c.data?.classes?.length ? c.data.classes.join(",") + (c.data.owner ? ` @${JSON.stringify(c.data.owner)}` : "") : "—";
  return `${subj} · ${verb} · ${res} · →${dst} · data:${data}`;
}

console.log("\n════════════════════════════════════════════════════════════════════");
console.log(` COMPLEX INTENT CONTRACT — ${clauses.length} atomic clauses (LLM-extracted, live)`);
console.log("════════════════════════════════════════════════════════════════════");

for (const c of clauses) {
  const b = c.binding;
  const reqs = requirements(c);
  const verdict = deriveStatus(reqs, planes);
  const dest = resolveDestination(c);
  const req = reqs.map((r) => r.capability);
  const missing = req.filter((cap) => !available.has(cap));

  console.log(`\n─ [${c.id}] ${c.decision}  priority ${c.priority}`);
  console.log(`  src: "${(c.source?.text ?? "").slice(0, 110)}"`);
  console.log(`  A. IR      : ${facet(c)}`);
  console.log(`  B. dest    : hosts=[${dest.hosts.join(", ") || "—"}]  notIn=[${dest.notHosts.join(", ") || "—"}]  unresolved=[${dest.unresolved.join(", ") || "—"}]`);
  console.log(`  D. observed: ${b.match?.length ? b.match.map((p: any) => p.field).join(", ") : "— (no network-observable predicate)"}`);
  console.log(`  cap req    : ${req.join(", ") || "—"}`);
  console.log(`  cap avail  : ${req.filter((cap) => available.has(cap)).join(", ") || "—"}`);
  console.log(`  cap missing: ${missing.join(", ") || "— (none)"}`);
  console.log(`  E. STATUS  : ${b.status.toUpperCase()}   plane=${b.plane ?? "—"}   effective=${b.effectiveDecision}`);
  if (b.unenforcedFacets?.length) console.log(`     unenforced facets: ${b.unenforcedFacets.join(", ")}`);
  if (b.coverageGap) console.log(`     gap: ${b.coverageGap}`);
  console.log(`     why: ${b.rationale}`);
}

/* C + F — compile the whole contract and show priority-ordered active rules. */
const compiled = compileContract(clauses);
console.log("\n════════════════════════════════════════════════════════════════════");
console.log(" C. PRIORITY / OVERLAP RESOLUTION  (first-match-wins, high→low)");
console.log("════════════════════════════════════════════════════════════════════");
const ranked = [...compiled.rules].sort((a, b) => b.priority - a.priority);
for (const r of ranked) {
  console.log(`  p${String(r.priority).padStart(3)}  ${r.effect.toUpperCase().padEnd(9)} ${r.name}`);
}
console.log("  (BLOCK/REVIEW clauses rank above overlapping ALLOW; the catch-all ALLOW sits lowest.)");

console.log("\n════════════════════════════════════════════════════════════════════");
console.log(` F. COMPILED ACTIVE RULES  (${compiled.rules.length} runnable, ${compiled.skipped.length} not shipped to the daemon)`);
console.log("════════════════════════════════════════════════════════════════════");
for (const r of ranked) {
  const cond = r.condition == null ? "∀ (catch-all)" : JSON.stringify(r.condition);
  console.log(`\n  ${r.name}  [p${r.priority}]  → ${r.effect.toUpperCase()}`);
  console.log(`    when: ${cond}`);
  if ((r as any).constraint) console.log(`    constraint: ${JSON.stringify((r as any).constraint)}`);
}
if (compiled.skipped.length) {
  console.log("\n  NOT COMPILED (understood, not yet enforceable — never emitted as allow/block):");
  for (const s of compiled.skipped) console.log(`    · [${s.clause_id}] ${s.name} — ${s.reason}`);
}

/* Roll-up */
const tally: Record<string, number> = {};
for (const c of clauses) tally[c.binding.status] = (tally[c.binding.status] ?? 0) + 1;
console.log("\n──────────────────────────────────────────────────────────────────");
console.log(" STATUS ROLL-UP: " + Object.entries(tally).map(([k, n]) => `${k}=${n}`).join("  "));
console.log("──────────────────────────────────────────────────────────────────\n");
