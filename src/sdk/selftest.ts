/* Prototype SDK tests — run with: npx vite-node src/sdk/selftest.ts
 * Exercises the real @wrapbox/sdk + @wrapbox/verify lifecycle end to end. */
import { createClient, WrapboxDenied } from "@wrapbox/sdk";
import { verifyPermit } from "@wrapbox/verify";
import { guardFunctionTool } from "@wrapbox/openai";
import { guardNode } from "@wrapbox/langgraph";
import type { Rule } from "../data/contract";

const rules: Rule[] = [
  {
    id: "claims.payout", title: "Claims payout tiers", why: "two-person above ₹2,00,000",
    when: { effect: ["claims.payout"] },
    tiers: [{ max: 200000, decision: "ALLOW" }, { max: null, decision: "REVIEW", approvers: "claims-manager", quorum: 2 }],
    unit: "INR", scope: "all",
  },
  { id: "secrets.read", title: "no secret reads", why: "exfiltration starts with a read", when: { effect: ["filesystem.read"], path: ["**/.env*"] }, decision: "BLOCK", scope: "all" },
  { id: "migrate.ci", title: "migrations need CI", why: "fail closed on unverifiable CI", when: { effect: ["database.migrate"], requires: [{ key: "ci_passed", op: "is", value: true }] }, decision: "ALLOW", failClosed: true, scope: "all" },
];
const client = createClient({ org: "acme", agent: "claims-agent-prod", onBehalfOf: "priya@acme.com", policy: () => rules });

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : " → " + d}`); c ? pass++ : fail++; };

// A · allowed action → ALLOW + permit
const a = await client.guard("claims.payout", { resource: "claim:1", amount: 100000, args: { claimId: "1", amountInr: 100000 } });
ok("A allow small claim issues a permit", a.decision === "ALLOW" && a.allowed && !!a.permit, JSON.stringify(a));

// B · blocked action → BLOCK, no permit
const b = await client.guard("filesystem.read", { path: "/repo/.env.production", args: { path: ".env.production" } });
ok("B block secret read", b.decision === "BLOCK" && !b.allowed && !b.permit, JSON.stringify(b));

// C · ₹3,00,000 over ₹2,00,000 threshold → REVIEW
const c = await client.guard("claims.payout", { resource: "claim:2", amount: 300000, args: { claimId: "2", amountInr: 300000 } });
ok("C large claim → REVIEW · two claims managers", c.decision === "REVIEW" && c.approvers === "claims-manager" && c.quorum === 2 && !c.permit, JSON.stringify(c));

// D · after approval → permit issued
const permit = await client.approve("claims.payout", { resource: "claim:2", args: { claimId: "2", amountInr: 300000 } }, ["meera", "rohan"]);
ok("D approval mints a signed permit", !!permit.signature && permit.approved_by.length === 2, permit.id);

// E · target service verifies a valid permit
const e = await verifyPermit(permit, { claimId: "2", amountInr: 300000 }, { probe: true });
ok("E valid permit verifies", e.ok, JSON.stringify(e.checks));

// F · expired permit rejected
const expired = await client.approve("claims.payout", { resource: "claim:3", args: { claimId: "3", amountInr: 300000 } }, ["meera"], { ttlSeconds: -1 });
const f = await verifyPermit(expired, { claimId: "3", amountInr: 300000 }, { probe: true });
ok("F expired permit rejected", !f.ok && f.checks.some((x) => x.label === "Not expired" && !x.ok), JSON.stringify(f.checks));

// G · single-use permit used twice → second rejected
const su = await client.approve("claims.payout", { resource: "claim:4", args: { claimId: "4", amountInr: 300000 } }, ["meera"]);
const g1 = await verifyPermit(su, { claimId: "4", amountInr: 300000 }); // consumes the nonce
const g2 = await verifyPermit(su, { claimId: "4", amountInr: 300000 }); // replay
ok("G single-use: first ok, replay rejected", g1.ok && !g2.ok && g2.checks.some((x) => x.label === "Nonce unused" && !x.ok), JSON.stringify(g2.checks));

// H · changed binding rejected
const bnd = await client.approve("claims.payout", { resource: "claim:5", args: { claimId: "5", amountInr: 300000 } }, ["meera"]);
const h = await verifyPermit(bnd, { claimId: "5", amountInr: 999999 }, { probe: true });
ok("H changed args rejected", !h.ok && h.checks.some((x) => x.label === "Arguments match" && !x.ok), JSON.stringify(h.checks));

// I · missing context under fail-closed → BLOCK
const i = await client.guard("database.migrate", { args: {} }); // ci_passed missing
ok("I fail-closed on missing context", i.decision === "BLOCK" && !i.allowed, JSON.stringify(i));
const bad = createClient({ org: "acme", agent: "x", policy: () => { throw new Error("no network"); } });
const i2 = await bad.guard("claims.payout", { amount: 100 });
ok("I fail-closed when policy unavailable", i2.decision === "BLOCK" && i2.rule === "policy.unavailable", JSON.stringify(i2));

// J · same client, different frameworks
const tool = guardFunctionTool(client, "claims.payout", async (x: { claimId: string; amountInr: number }) => ({ paid: x.claimId }), (x) => ({ resource: `claim:${x.claimId}`, amount: x.amountInr, args: x }));
const jAllow = await tool({ claimId: "6", amountInr: 100000 });
let denied = false;
try { await tool({ claimId: "7", amountInr: 300000 }); } catch (err) { denied = err instanceof WrapboxDenied; }
const node = await guardNode(client, "claims.payout", { resource: "claim:8", amount: 300000, args: { claimId: "8", amountInr: 300000 } });
ok("J OpenAI adapter: allows small, denies REVIEW", (jAllow as { paid: string }).paid === "6" && denied, JSON.stringify(jAllow));
ok("J LangGraph adapter: interrupts on REVIEW", node.interrupt && !node.proceed, JSON.stringify(node.result));

console.log(`\n${fail ? fail + " FAILED" : "ALL " + pass + " PASSED"}`);
if (fail) throw new Error(`${fail} SDK test(s) failed`);
