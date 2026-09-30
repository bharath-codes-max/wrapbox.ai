/* Plain English → a draft rule.
 *
 * Deterministic on purpose: the same sentence always produces the same draft, and no model is
 * involved here or at runtime. This only DRAFTS — a person reads the rule, edits it, replays it
 * against past traffic and publishes it. The engine stays a pure function of (action, contract).
 */

import type { CategoryId } from "../data/agents";
import { effectInfo, type Rule, type Tier } from "../data/contract";

export interface Chip {
  label: string;
  value: string;
}
export interface Requirement {
  text: string;
  field?: string | null;
  represented: boolean;
}
export interface Draft {
  rule: Rule | null;
  /** Every requirement found in the sentence and whether it reached the rule. */
  requirements?: Requirement[];
  /** What the sentence was understood to mean. */
  understood: Chip[];
  /** Recognised, but the engine has no field for it — said out loud instead of silently dropped. */
  unsupported: string[];
  /** Needed to make a valid rule and still missing. */
  missing: string[];
}

type Decision = Rule["decision"];

/* ---------------- amounts ---------------- */

const NUM = String.raw`(?:\d[\d,]*(?:\.\d+)?)`;
const n = (raw: string) => Number(raw.replace(/,/g, ""));

/** "₹3,00,000" · "$5,000" · "5k" · "2 lakh" · "1 crore" · "25%" */
export function parseAmount(text: string): { value: number; unit: "USD" | "INR" | "%" } | null {
  const t = text.toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = t.match(new RegExp(`(${NUM})\\s*(?:%|percent)`)))) return { value: n(m[1]), unit: "%" };
  if ((m = t.match(new RegExp(`(?:₹|rs\\.?|inr)\\s*(${NUM})\\s*(cr|crore|l|lakh|lac|k)?`)))) return { value: scale(n(m[1]), m[2]), unit: "INR" };
  if ((m = t.match(new RegExp(`(${NUM})\\s*(crore|lakh|lac)`)))) return { value: scale(n(m[1]), m[2]), unit: "INR" };
  if ((m = t.match(new RegExp(`(?:\\$|usd|dollars?)\\s*(${NUM})\\s*(k|m)?`)))) return { value: scale(n(m[1]), m[2]), unit: "USD" };
  if ((m = t.match(new RegExp(`(${NUM})\\s*(k|m)\\b`)))) return { value: scale(n(m[1]), m[2]), unit: "USD" };
  if ((m = t.match(new RegExp(`\\b(${NUM})\\b`)))) return { value: n(m[1]), unit: "USD" };
  return null;
}
const scale = (v: number, suffix?: string) => {
  switch ((suffix ?? "").toLowerCase()) {
    case "k":
      return v * 1_000;
    case "m":
      return v * 1_000_000;
    case "l":
    case "lakh":
    case "lac":
      return v * 100_000;
    case "cr":
    case "crore":
      return v * 10_000_000;
    default:
      return v;
  }
};
export const fmtAmount = (v: number, unit: "USD" | "INR" | "%") => (unit === "%" ? `${v}%` : unit === "INR" ? `₹${v.toLocaleString("en-IN")}` : `$${v.toLocaleString("en-US")}`);

/* ---------------- vocabulary ---------------- */

interface EffectMatch {
  test: RegExp;
  effect: string[];
  when?: Partial<Rule["when"]>;
  label: string;
}
const EFFECT_RULES: EffectMatch[] = [
  { test: /\bforce[- ]push|--force\b/, effect: ["git.push"], when: { command: ["* --force *", "* --force", "* -f *"] }, label: "force-push" },
  { test: /\b(push|merge|commit)\b[^.]*\b(main|master|protected|trunk)\b|\b(main|master)\b[^.]*\b(push|merge)\b/, effect: ["git.push", "git.merge"], when: { branch: ["main", "master"] }, label: "push or merge to main" },

  { test: /\b(delet(e|ing)|destroy(ing)?|drop(ping)?|tear(ing)? down|scal(e|ing) down)\b[^.]*\b(deployment|namespace|cluster|pod|server|infra|infrastructure|production|prod)\b|\bkubectl delete\b|\bterraform destroy\b/, effect: ["shell.exec"], when: { command: ["kubectl delete * -n prod*", "kubectl delete * --namespace prod*", "terraform destroy*"] }, label: "delete production infrastructure" },
  { test: /\b(schema|migration|migrate|alter table|create table)\b/, effect: ["database.migrate"], label: "change a database schema" },
  { test: /\b(email|phone|pii|personal data|customer data|aadhaar|pan)\b/, effect: ["database.read"], when: { columns: ["email", "phone", "pan", "aadhaar"] }, label: "read customer personal data" },
  { test: /\b(delete|update|drop|truncate)\b[^.]*\b(rows?|records?|table|orders?|customers?|database|db)\b|\bdestructive sql\b/, effect: ["database.write"], label: "change or delete database rows" },
  { test: /\brefunds?\b/, effect: ["payments.refund"], label: "refund a payment" },
  { test: /\b(claims?|payouts?)\b/, effect: ["claims.payout"], label: "pay out a claim" },
  { test: /\bdiscounts?\b/, effect: ["crm.apply_discount"], label: "give a discount" },
  { test: /\b(checkout|submit (a )?payment|pay (a )?(invoice|bill))\b/, effect: ["payment.submit"], label: "submit a payment in a browser" },
  { test: /\b(send(ing)?|upload(ing)?|post(ing)?|shar(e|ing)|exfiltrat|curl|webhook)\b[^.]*\b(external|unknown|outside|third[- ]party|internet|domain|site|url|anywhere)\b/, effect: ["network.egress"], when: { destinationNotIn: ["api.github.com", "registry.npmjs.org", "pypi.org", "api.wrapbox.ai"] }, label: "send data to an outside domain" },
  { test: /\.env\b|\bsecrets?\b|\bcredentials?\b|password file|private key|\bapi keys?\b|id_rsa|\.pem\b/, effect: ["filesystem.read"], when: { path: ["**/.env*", "**/*.pem", "**/id_rsa*"] }, label: "read a secret file" },
  { test: /\b(purchase|buy|order)\b/, effect: ["purchase.order"], label: "place a delegated order" },
  { test: /\b(run|execute)\b[^.]*\bcommand|\bshell\b|\bterminal\b/, effect: ["shell.exec"], label: "run a command" },
  { test: /\b(read|open)\b[^.]*\bfile\b/, effect: ["filesystem.read"], label: "read a file" },
];

const APPROVERS: [RegExp, string][] = [
  [/finance (head|controller|lead)|cfo|controller/, "finance-controller"],
  [/payments? (manager|lead|head)/, "payments-manager"],
  [/claims? (manager|lead|head)/, "claims-manager"],
  [/vp of sales|vp sales|sales vp/, "vp-sales"],
  [/sales (manager|lead|head)/, "sales-manager"],
  [/on[- ]?call|sre|platform (team|engineer)|infra team/, "oncall-sre"],
  [/security (team|lead)|ciso|admin|owner|founder/, "admin"],
];

const UNSUPPORTED: [RegExp, string][] = [
  [/\b(after|before)\s*\d{1,2}\s*(am|pm|:\d{2})|outside (business|working|office) hours|\bweekends?\b|\bnights?\b/, "time-of-day windows (for example “after 9pm”)"],
  [/\bmore than \d+ (times|requests|calls)|rate[- ]limit|per (hour|minute|day)\b/, "rate limits (how often something may happen)"],
  [/\bonly\s+(?!the\b)[A-Z][a-z]+\s+(can|may|should)\b/, "one named person as the approver — use a group instead"],
  [/\bip address|\bgeo|\bcountry\b|\bvpn\b/, "network location conditions"],
  [/\b(budget|spend)\b[^.]*\b(per|a)\s*(day|week|month)\b/, "spending budgets measured over time"],
];

/* ---------------- the parser ---------------- */

export function describeToRule(input: string, existingIds: string[] = []): Draft {
  const raw = input.trim();
  const t = raw.toLowerCase().replace(/\s+/g, " ");
  const understood: Chip[] = [];
  const unsupported: string[] = [];
  const missing: string[] = [];
  if (!t) return { rule: null, understood, unsupported, missing: ["what the agent is doing", "what should happen"] };

  for (const [re, msg] of UNSUPPORTED) if (re.test(raw)) unsupported.push(msg);

  /* what is being done */
  const hit = EFFECT_RULES.find((e) => e.test.test(t));
  const carriesCreds = /\b(api keys?|tokens?|secrets?|credentials?|passwords?)\b/.test(t);
  if (!hit) missing.push("what the agent is doing (refund, push to main, read a secret…)");
  const effect = hit?.effect ?? [];
  if (hit) understood.push({ label: "Action", value: hit.label });

  /* where */
  const env: string[] | undefined = /\bprod(uction)?\b|\blive\b/.test(t) ? ["production"] : /\bstaging\b/.test(t) ? ["staging"] : /\b(dev|development|laptop|sandbox)\b/.test(t) ? ["development"] : undefined;
  if (env) understood.push({ label: "Environment", value: env[0] });

  /* which agents */
  let subject: CategoryId[] | undefined;
  if (/\bcoding agents?\b|\bdevelopers? agents?\b/.test(t)) subject = ["ide", "cli", "cloud"];
  else if (/\bbrowser agents?\b/.test(t)) subject = ["browser"];
  else if (/\bmcp\b/.test(t)) subject = ["mcp"];
  else if (/\bour own agents?\b|\bcustom agents?\b/.test(t)) subject = ["custom"];
  if (subject) understood.push({ label: "Agents", value: subject.join(", ") });

  /* what should happen */
  const wantsBlock = /\b(never|block|blocked|forbid|refuse|not allowed|don'?t allow|do not allow|must not|cannot|can'?t|stop)\b/.test(t);
  const wantsReview =
    /\b(approve[sd]?|approval|sign[- ]?off|signs? off|review|permission|escalate|ask (a|the)|human)\b/.test(t) ||
    /\b(needs?|requires?|without|only with)\b[^.]*\b(engineer|manager|head|lead|approver|on[- ]?call|sre|controller|cfo|vp|admin|owner|security)\b/.test(t);
  const wantsMask = /\b(mask|hide|redact|anonymi|obfuscate)\b/.test(t);
  const wantsSafe = /\bforce[- ]with[- ]lease|\bsafer\b|\brewrite\b/.test(t);
  const wantsAllow = /\b(allow|automatic|automatically|without approval|no approval|fine|ok|permitted)\b/.test(t);
  let decision: Decision = wantsBlock ? "BLOCK" : wantsReview ? "REVIEW" : wantsMask || wantsSafe ? "CONSTRAIN" : wantsAllow ? "ALLOW" : undefined;

  /* who approves */
  let approvers: string | undefined;
  for (const [re, g] of APPROVERS)
    if (re.test(t)) {
      approvers = g;
      break;
    }
  const quorum = /\btwo\b|\b2\b\s*(managers?|approvers?|people)|\bboth\b|\bdual\b|\bfour[- ]eyes\b/.test(t) ? 2 : undefined;

  /* money */
  const info = hit ? effectInfo(hit.effect[0]) : undefined;
  const over = t.match(/\b(?:over|above|more than|greater than|exceeds?|beyond)\b([^.;]*)/);
  const under = t.match(/\b(?:under|below|up to|less than|within|at most)\b([^.;]*)/);
  const overAmt = over ? parseAmount(over[1]) : null;
  const underAmt = under ? parseAmount(under[1]) : null;
  const money = overAmt ?? underAmt;
  let tiers: Tier[] | undefined;
  let unit: Rule["unit"] | undefined;

  if (money && info?.unit) {
    unit = info.unit;
    if (money.unit !== info.unit) understood.push({ label: "Note", value: `amount read as ${fmtAmount(money.value, money.unit)}, stored in ${info.unit}` });
    const high: Decision = wantsBlock && wantsReview ? "BLOCK" : (decision ?? "REVIEW");
    if (overAmt) {
      // "over X → needs approval / blocked", everything under stays automatic
      tiers = [
        { max: overAmt.value, decision: "ALLOW" },
        { max: null, decision: high === "ALLOW" ? "REVIEW" : high, approvers: high === "REVIEW" ? (approvers ?? "admin") : undefined, quorum: high === "REVIEW" ? quorum : undefined },
      ];
      understood.push({ label: "Limit", value: `up to ${fmtAmount(overAmt.value, info.unit)} automatic, above needs ${high === "BLOCK" ? "blocking" : "approval"}` });
    } else if (underAmt) {
      tiers = [
        { max: underAmt.value, decision: "ALLOW" },
        { max: null, decision: decision === "BLOCK" ? "BLOCK" : "REVIEW", approvers: decision === "BLOCK" ? undefined : (approvers ?? "admin"), quorum },
      ];
      understood.push({ label: "Limit", value: `up to ${fmtAmount(underAmt.value, info.unit)} automatic` });
    }
    decision = undefined; // tiers carry the decisions
  }

  if (!tiers && !decision) missing.push("what should happen (allow, mask, needs approval, block)");
  if (decision === "REVIEW" && !approvers) approvers = "admin";
  if (approvers && (decision === "REVIEW" || tiers)) understood.push({ label: "Approver", value: quorum === 2 ? `${approvers} · two people` : approvers });
  if (decision) understood.push({ label: "Decision", value: decision });

  if (!hit || (!decision && !tiers)) return { rule: null, understood, unsupported, missing };

  /* constrain needs a rewrite the engine actually knows how to do */
  let constrain: Rule["constrain"] | undefined;
  if (decision === "CONSTRAIN") {
    constrain = info?.constrain;
    if (!constrain) {
      decision = "REVIEW";
      approvers = approvers ?? "admin";
      unsupported.push(`there is no safe rewrite for “${hit.label}”, so this asks a human instead`);
    } else understood.push({ label: "Rewrite", value: constrain === "mask" ? "hide personal columns, cap rows" : "force-with-lease" });
  }

  const base = hit.effect[0].replace(/\..*/, "");
  const wanted = tiers ? `${hit.effect[0]}.tiers` : `${hit.effect[0]}.${(decision ?? "rule").toLowerCase()}`;
  let id = wanted;
  for (let i = 2; existingIds.includes(id); i++) id = `${wanted}.${i}`;

  const rule: Rule = {
    id,
    title: titleOf(raw),
    why: raw,
    when: { effect, ...(hit.when ?? {}), ...(effect[0] === "network.egress" && carriesCreds ? { credentials: true } : {}), ...(env ? { env } : {}), ...(subject ? { subject } : {}) },
    ...(tiers ? { tiers, unit } : { decision }),
    ...(approvers && !tiers ? { approvers } : {}),
    ...(quorum && !tiers ? { quorum } : {}),
    ...(constrain ? { constrain } : {}),
    scope: /payment|claim|discount|purchase/.test(base) ? "business" : subject || /git|filesystem|shell/.test(base) ? "coding" : "all",
    custom: true,
  };
  const requirements: Requirement[] = [
    ...understood.filter((u) => u.label !== "Note").map((u) => ({ text: `${u.label}: ${u.value}`, field: u.label.toLowerCase(), represented: true })),
    ...unsupported.map((u) => ({ text: u, field: null, represented: false })),
  ];
  return { rule, understood, unsupported, missing, requirements };
}

/** A short sentence-case title from the sentence the person typed. */
function titleOf(raw: string) {
  const first = raw.split(/[.;\n]/)[0].trim().replace(/\s+/g, " ");
  const s = first.charAt(0).toUpperCase() + first.slice(1);
  return s.length > 72 ? s.slice(0, 69).trimEnd() + "…" : s;
}

/** Examples that parse cleanly — shown as one-click starters. */
export const DESCRIBE_EXAMPLES = [
  "Refunds over $500 need the payments manager",
  "Agents must never push or merge to main",
  "Never let an agent read .env files or private keys",
  "Claims payouts above ₹2,00,000 need two claims managers",
  "Mask customer email and phone when an agent reads the database",
  "Deleting production infrastructure needs the on-call engineer",
  "Discounts over 25% need the VP of sales",
  "Schema changes in production are blocked for coding agents",
];
