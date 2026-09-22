/**
 * Intent-compiler regression suite.
 *
 *   npx tsx src/lib/intent/regression/run.ts            # human report
 *   npx tsx src/lib/intent/regression/run.ts --json     # machine-readable report on stdout
 *
 * Every case in corpus.json is a surface extraction (what the LLM emits) plus
 * the guarantees the compiler must honour for it. The runner pushes the surface
 * through the SAME pipeline the product uses — validateSurface() → priority sort
 * → compileContract() — and checks each documented guarantee. It is a REPORT:
 * it always exits 0, never mutates the corpus, and never "fixes" a case.
 *
 * Assertion schema (per case `expect`):
 *   clauseCount        verdict.clauses.length
 *   rejectedCount      verdict.rejected.length
 *   activationBlocked  verdict.activationBlocked
 *   invariants         set-equal to verdict.invariants
 *   groups             set-equal by id; each group's members set-equal
 *   orderedDecisions   clause decisions, in priority-DESC order, exactly
 *   compiledCount      compileContract(sorted).rules.length
 *   clauses[i]         per-index assertions against sorted[i]:
 *     decision, action (action.verbs[0] | "any"), resourceType, status,
 *     plane (null allowed), effectiveDecision, sourcesCount
 *     destHostsInclude    every host ∈ resolveDestination(clause).hosts
 *     destHostsExclude    no host ∈ resolveDestination(clause).hosts
 *     destNotHostsInclude every host ∈ resolveDestination(clause).notHosts
 *     predicateFields     every field named in binding.match
 *     predicateFieldsAbsent no field named in binding.match
 *     unenforcedFacets    every facet ∈ binding.unenforcedFacets
 *   mustNot[]          anyClauseWithDecision{decision, action?}, positiveHostsContain{host},
 *                      catchAllPresent, statusIs{clauseIndex, status}
 *
 * Node has no localStorage; destinations.ts already guards for that. No polyfills.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSurface, type SurfaceClause } from "../validate";
import { compileContract } from "../compile";
import { resolveDestination } from "../resolve";
import type { IntentClause } from "../schema";

/* ------------------------------------------------------------------ *
 * Corpus shape
 * ------------------------------------------------------------------ */

interface ClauseExpect {
  decision?: string;
  action?: string;
  resourceType?: string;
  status?: string;
  plane?: string | null;
  effectiveDecision?: string;
  sourcesCount?: number;
  destHostsInclude?: string[];
  destHostsExclude?: string[];
  destNotHostsInclude?: string[];
  predicateFields?: string[];
  predicateFieldsAbsent?: string[];
  unenforcedFacets?: string[];
}

type MustNot =
  | { kind: "anyClauseWithDecision"; decision: string; action?: string }
  | { kind: "positiveHostsContain"; host: string }
  | { kind: "catchAllPresent" }
  | { kind: "statusIs"; clauseIndex: number; status: string };

interface Expect {
  clauseCount?: number;
  rejectedCount?: number;
  activationBlocked?: boolean;
  invariants?: string[];
  groups?: { id: string; members: string[] }[];
  orderedDecisions?: string[];
  compiledCount?: number;
  clauses?: ClauseExpect[];
  mustNot?: MustNot[];
}

interface Case {
  id: string;
  category: string;
  text: string;
  note?: string;
  surface: SurfaceClause[];
  expect: Expect;
}

interface Failure {
  id: string;
  category: string;
  text: string;
  assertion: string;
  expected: unknown;
  actual: unknown;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const here = dirname(fileURLToPath(import.meta.url));
const corpus: Case[] = JSON.parse(readFileSync(join(here, "corpus.json"), "utf8"));

const show = (v: unknown): string => JSON.stringify(v);
const sortedCopy = (a: readonly string[]): string[] => [...a].sort();
const setEq = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && sortedCopy(a).every((x, i) => x === sortedCopy(b)[i]);

function predicateFields(c: IntentClause): string[] {
  const m = c.binding.match;
  if (!m) return [];
  return (Array.isArray(m) ? m : [m]).map((p) => p.field);
}

function actionOf(c: IntentClause): string | undefined {
  return c.action.verbs?.[0] ?? (c.action.any ? "any" : undefined);
}

function isCatchAllShape(c: IntentClause): boolean {
  return Boolean(c.subject.any && c.action.any && c.resource.any);
}

/* ------------------------------------------------------------------ *
 * One case
 * ------------------------------------------------------------------ */

function runCase(tc: Case): Failure[] {
  const fails: Failure[] = [];
  const fail = (assertion: string, expected: unknown, actual: unknown): void => {
    fails.push({ id: tc.id, category: tc.category, text: tc.text, assertion, expected, actual });
  };

  let verdict: ReturnType<typeof validateSurface>;
  try {
    verdict = validateSurface(tc.surface);
  } catch (e) {
    fail("validateSurface throws", "no exception", String(e instanceof Error ? e.message : e));
    return fails;
  }

  // Priority DESC, stable — identical to how the contract is ordered for first-match-wins.
  const sorted = [...verdict.clauses].sort((a, b) => b.priority - a.priority);
  const compiled = compileContract(sorted);
  const ex = tc.expect;

  if (ex.clauseCount !== undefined && verdict.clauses.length !== ex.clauseCount)
    fail("clauseCount", ex.clauseCount, verdict.clauses.length);
  if (ex.rejectedCount !== undefined && verdict.rejected.length !== ex.rejectedCount)
    fail("rejectedCount", ex.rejectedCount, { count: verdict.rejected.length, rejected: verdict.rejected });
  if (ex.activationBlocked !== undefined && verdict.activationBlocked !== ex.activationBlocked)
    fail("activationBlocked", ex.activationBlocked, verdict.activationBlocked);
  if (ex.invariants !== undefined && !setEq(ex.invariants, verdict.invariants))
    fail("invariants", ex.invariants, verdict.invariants);

  if (ex.groups !== undefined) {
    const actualIds = verdict.groups.map((g) => g.id);
    const expectedIds = ex.groups.map((g) => g.id);
    if (!setEq(expectedIds, actualIds)) {
      fail("groups.ids", expectedIds, actualIds);
    } else {
      for (const g of ex.groups) {
        const actual = verdict.groups.find((x) => x.id === g.id)!;
        if (!setEq(g.members, actual.members)) fail(`groups[${g.id}].members`, g.members, actual.members);
      }
    }
  }

  if (ex.orderedDecisions !== undefined) {
    const actual = sorted.map((c) => c.decision);
    if (show(actual) !== show(ex.orderedDecisions)) fail("orderedDecisions", ex.orderedDecisions, actual);
  }

  if (ex.compiledCount !== undefined && compiled.rules.length !== ex.compiledCount)
    fail("compiledCount", ex.compiledCount, { count: compiled.rules.length, skipped: compiled.skipped.map((s) => s.reason) });

  for (const [i, ce] of (ex.clauses ?? []).entries()) {
    const c = sorted[i];
    const at = `clauses[${i}]`;
    if (!c) { fail(`${at}`, "a clause at this index", `only ${sorted.length} clause(s)`); continue; }
    const b = c.binding;

    if (ce.decision !== undefined && c.decision !== ce.decision) fail(`${at}.decision`, ce.decision, c.decision);
    if (ce.action !== undefined && actionOf(c) !== ce.action) fail(`${at}.action`, ce.action, actionOf(c));
    if (ce.resourceType !== undefined && c.resource.type !== ce.resourceType) fail(`${at}.resourceType`, ce.resourceType, c.resource.type);
    if (ce.status !== undefined && b.status !== ce.status) fail(`${at}.status`, ce.status, `${b.status} — ${b.rationale}`);
    if (ce.plane !== undefined && (b.plane ?? null) !== ce.plane) fail(`${at}.plane`, ce.plane, b.plane ?? null);
    if (ce.effectiveDecision !== undefined && b.effectiveDecision !== ce.effectiveDecision) fail(`${at}.effectiveDecision`, ce.effectiveDecision, b.effectiveDecision);
    if (ce.sourcesCount !== undefined) {
      const n = c.sources?.length ?? 0;
      if (n !== ce.sourcesCount) fail(`${at}.sourcesCount`, ce.sourcesCount, { count: n, sources: (c.sources ?? []).map((s) => s.text) });
    }

    const dest = resolveDestination(c);
    if (ce.destHostsInclude) {
      const missing = ce.destHostsInclude.filter((h) => !dest.hosts.includes(h));
      if (missing.length) fail(`${at}.destHostsInclude`, ce.destHostsInclude, { hosts: dest.hosts, missing });
    }
    if (ce.destHostsExclude) {
      const present = ce.destHostsExclude.filter((h) => dest.hosts.includes(h));
      if (present.length) fail(`${at}.destHostsExclude`, ce.destHostsExclude, { hosts: dest.hosts, present });
    }
    if (ce.destNotHostsInclude) {
      const missing = ce.destNotHostsInclude.filter((h) => !dest.notHosts.includes(h));
      if (missing.length) fail(`${at}.destNotHostsInclude`, ce.destNotHostsInclude, { notHosts: dest.notHosts, missing });
    }

    const fields = predicateFields(c);
    if (ce.predicateFields) {
      const missing = ce.predicateFields.filter((f) => !fields.includes(f));
      if (missing.length) fail(`${at}.predicateFields`, ce.predicateFields, { fields, missing });
    }
    if (ce.predicateFieldsAbsent) {
      const present = ce.predicateFieldsAbsent.filter((f) => fields.includes(f));
      if (present.length) fail(`${at}.predicateFieldsAbsent`, ce.predicateFieldsAbsent, { fields, present });
    }

    if (ce.unenforcedFacets) {
      const actual = b.unenforcedFacets ?? [];
      const missing = ce.unenforcedFacets.filter((f) => !actual.includes(f));
      if (missing.length) fail(`${at}.unenforcedFacets`, ce.unenforcedFacets, { unenforcedFacets: actual, missing });
    }
  }

  for (const m of ex.mustNot ?? []) {
    switch (m.kind) {
      case "anyClauseWithDecision": {
        const hit = sorted.filter((c) => c.decision === m.decision && (m.action === undefined || actionOf(c) === m.action));
        if (hit.length) fail(`mustNot.anyClauseWithDecision(${m.decision}${m.action ? `,${m.action}` : ""})`, "none", hit.map((c) => `${c.decision} ${actionOf(c)} ${c.resource.type ?? ""} — “${c.source?.text ?? ""}”`));
        break;
      }
      case "positiveHostsContain": {
        const hit = sorted.filter((c) => resolveDestination(c).hosts.includes(m.host));
        if (hit.length) fail(`mustNot.positiveHostsContain(${m.host})`, "no clause", hit.map((c) => `${c.decision} — “${c.source?.text ?? ""}” hosts=${show(resolveDestination(c).hosts)}`));
        break;
      }
      case "catchAllPresent": {
        const hit = sorted.filter(isCatchAllShape);
        if (hit.length) fail("mustNot.catchAllPresent", "no catch-all clause", hit.map((c) => `${c.decision} — “${c.source?.text ?? ""}”`));
        break;
      }
      case "statusIs": {
        const c = sorted[m.clauseIndex];
        if (c && c.binding.status === m.status) fail(`mustNot.statusIs(${m.clauseIndex},${m.status})`, `not ${m.status}`, `${c.binding.status} — ${c.binding.rationale}`);
        break;
      }
    }
  }

  return fails;
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

const jsonMode = process.argv.includes("--json");
const failures: Failure[] = [];
const byCategory: Record<string, { pass: number; fail: number; total: number }> = {};
let pass = 0;
let fail = 0;

for (const tc of corpus) {
  const f = runCase(tc);
  const cat = (byCategory[tc.category] ??= { pass: 0, fail: 0, total: 0 });
  cat.total += 1;
  if (f.length) { fail += 1; cat.fail += 1; failures.push(...f); }
  else { pass += 1; cat.pass += 1; }
  if (!jsonMode && f.length) {
    const detail = f.map((x) => `${x.assertion}: expected ${show(x.expected)}, actual ${show(x.actual)}`).join(" ; ");
    console.log(`FAIL [${tc.category}] ${tc.id} — “${tc.text}” — ${detail}`);
  }
}

const total = corpus.length;
if (jsonMode) {
  console.log(JSON.stringify({ pass, fail, total, byCategory, failures }, null, 2));
} else {
  console.log(`\nPASS ${pass} / FAIL ${fail} / TOTAL ${total}`);
  for (const [cat, n] of Object.entries(byCategory)) console.log(`  ${cat.padEnd(18)} pass ${n.pass} / fail ${n.fail} / total ${n.total}`);
}
process.exit(0);
