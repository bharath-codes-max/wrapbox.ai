/* Test a single rule.
 *
 * Everything here is derived from the rule itself: the inputs shown are the ones the rule's effect
 * actually uses, the agent list is limited to the categories the rule applies to, and the verdict
 * comes from the same engine that runs in production (checkRule + evaluate). There is no separate
 * demo logic that could disagree with the YAML.
 */

import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { AGENTS, CATEGORIES, agentById, type CategoryId } from "../data/agents";
import { effectInfo, type Rule } from "../data/contract";
import { checkRule, evaluate, globMatch, type Act, type Ctx, type Env } from "../lib/engine";
import { DecisionPill, cn } from "./ui";

const ENVS: Env[] = ["production", "staging", "development"];
const catName = (c: CategoryId) => CATEGORIES.find((x) => x.id === c)?.name ?? c;

/** Which inputs an effect can actually use — never show a field the rule can't match on. */
export function inputsFor(effect: string): ("path" | "command" | "branch" | "columns" | "destination" | "amount" | "sql" | "env")[] {
  switch (effect) {
    case "filesystem.read":
    case "filesystem.write":
      return ["path", "env"];
    case "shell.exec":
      return ["command", "env"];
    case "git.push":
      return ["branch", "command"];
    case "git.merge":
      return ["branch"];
    case "database.read":
      return ["columns", "sql", "env"];
    case "database.write":
    case "database.migrate":
      return ["sql", "env"];
    case "network.egress":
      return ["destination", "env"];
    case "payments.refund":
    case "claims.payout":
    case "crm.apply_discount":
    case "payment.submit":
    case "purchase.order":
      return ["amount"];
    default:
      return ["env"];
  }
}

/* Turn a glob from the rule into a concrete example. A trailing * can simply be dropped (it also
   matches nothing), but an inner * must become a real token or the required literal spacing breaks. */
const fromGlob = (g: string, kind: "path" | "text") => {
  if (kind === "path") {
    let p = g.replace(/\*\*\//g, "src/").replace(/\/\*\*/g, "/001_users.sql");
    p = p.replace(/\.env\*/, ".env.production").replace(/\*/g, "file");
    return p.startsWith("/") || p.startsWith("src/") ? p : `src/${p}`;
  }
  const token = /--force/.test(g) ? "origin feat/ledger" : "deployment payments-api";
  return g
    .replace(/\*\s*$/, "")
    .replace(/\*/g, token)
    .replace(/\s+/g, " ")
    .trim();
};

/** Build a sample that the rule's own matcher accepts — verified with the engine, not assumed. */
const sampleFor = (globs: string[] | undefined, kind: "path" | "text", fallback: string) => {
  for (const g of globs ?? []) {
    const s = fromGlob(g, kind);
    if (globMatch(g, s, kind)) return s;
  }
  return globs?.length ? fromGlob(globs[0], kind) : fallback;
};

/** A starting action that satisfies the rule, so the tester opens on a matching case. */
export function seedAct(r: Rule): Act {
  const effect = r.when.effect[0];
  const a: Act = { effect };
  const inputs = inputsFor(effect);
  if (inputs.includes("path")) a.path = sampleFor(r.when.path, "path", "src/app/config.ts");
  if (inputs.includes("command")) a.command = sampleFor(r.when.command, "text", "npm test");
  if (inputs.includes("branch")) a.branch = r.when.branch?.[0]?.replace(/\*/g, "x") ?? "feat/ledger";
  if (inputs.includes("columns")) a.columns = r.when.columns ?? ["email"];
  if (inputs.includes("destination")) a.destination = "paste.example.com";
  if (r.when.credentials) a.credentials = true;
  if (inputs.includes("sql")) {
    a.sql = effect === "database.read" ? `SELECT ${(r.when.columns ?? ["email"]).join(", ")} FROM customers LIMIT 50` : effect === "database.migrate" ? "ALTER TABLE invoices ADD COLUMN cycle text" : "DELETE FROM orders WHERE created_at < '2024-01-01'";
  }
  if (inputs.includes("amount")) {
    const first = r.tiers?.[0]?.max;
    const v = typeof first === "number" ? Math.max(1, Math.floor(first / 2)) : 100;
    a.amount = v;
    if (r.unit === "USD" || !r.unit) a.amountUsd = v;
    if (effect === "purchase.order") a.budget = typeof first === "number" ? first : 10000;
  }
  a.env = (r.when.env?.[0] as Env) ?? "development";
  const ctx = seedCtx(r);
  if (Object.keys(ctx).length) a.ctx = ctx;
  return a;
}

/** Every context key this rule looks at — requirements, escalation conditions, permit bindings. */
export function ctxKeys(r: Rule): { key: string; kind: "bool" | "number" | "text" }[] {
  const out = new Map<string, "bool" | "number" | "text">();
  const add = (key: string, kind: "bool" | "number" | "text") => out.has(key) || out.set(key, kind);
  for (const c of r.when.requires ?? []) add(c.key, typeof c.value === "boolean" ? "bool" : typeof c.value === "number" ? "number" : "text");
  for (const e of r.escalations ?? []) for (const c of e.when) add(c.key, typeof c.value === "boolean" ? "bool" : typeof c.value === "number" ? "number" : "text");
  if (r.permit) {
    add("permit.age_seconds", "number");
    if (r.permit.singleUse) add("permit.consumed", "bool");
    add("permit.bindings_changed", "text");
    for (const b of r.permit.bind ?? []) add(b, "text");
  }
  return [...out].map(([key, kind]) => ({ key, kind }));
}

/** Context that satisfies the rule: requirements met, escalations not triggered, permit fresh. */
export function seedCtx(r: Rule): Ctx {
  const ctx: Ctx = {};
  for (const c of r.when.requires ?? []) {
    if (typeof c.value === "boolean") ctx[c.key] = c.value;
    else if (typeof c.value === "number") ctx[c.key] = c.op === "gte" || c.op === "gt" ? Number(c.value) + (c.op === "gt" ? 1 : 0) : Number(c.value);
    else if (Array.isArray(c.value)) ctx[c.key] = c.op === "not_in" ? "none" : String(c.value[0]);
    else ctx[c.key] = String(c.value);
  }
  for (const e of r.escalations ?? [])
    for (const c of e.when) {
      if (c.key in ctx) continue;
      if (typeof c.value === "number") ctx[c.key] = c.op === "gt" ? Number(c.value) : c.op === "gte" ? Number(c.value) - 1 : Number(c.value);
      else if (Array.isArray(c.value) || c.op === "in") ctx[c.key] = "none";
      else if (typeof c.value === "boolean") ctx[c.key] = !c.value;
      else ctx[c.key] = "none";
    }
  if (r.permit) {
    ctx["permit.age_seconds"] = 5;
    if (r.permit.singleUse) ctx["permit.consumed"] = false;
    ctx["permit.bindings_changed"] = "none";
    for (const b of r.permit.bind ?? []) ctx[b] = "proven";
  }
  return ctx;
}

/** An agent whose category the rule applies to, so the default case matches. */
export function seedAgent(r: Rule): string {
  const subject = r.when.subject;
  if (subject?.length) {
    const a = AGENTS.find((x) => subject.includes(x.category));
    if (a) return a.id;
  }
  const e = r.when.effect[0];
  const byEffect = e.startsWith("payments") ? "stripe-mcp" : e === "claims.payout" ? "langgraph" : e === "crm.apply_discount" ? "agentforce" : e === "payment.submit" ? "browser-use" : e === "purchase.order" ? "openai-handoffs" : e.startsWith("database") ? "postgres-mcp" : "claude-code";
  return AGENTS.some((x) => x.id === byEffect) ? byEffect : AGENTS[0].id;
}

const inputCls = "w-full h-9 rounded-lg border border-line bg-surface px-2.5 font-mono text-[12px] outline-none focus:border-fg-3";

export function RuleTester({ rule }: { rule: Rule }) {
  const effect = rule.when.effect[0];
  const info = effectInfo(effect);
  const inputs = inputsFor(effect);
  // Re-seed whenever the effect or its conditions change, so stale inputs can never linger.
  const seedKey = JSON.stringify({ e: effect, w: rule.when, t: rule.tiers?.map((t) => t.max), u: rule.unit });
  const [act, setAct] = useState<Act>(() => seedAct(rule));
  const [agentId, setAgentId] = useState(() => seedAgent(rule));
  useEffect(() => {
    setAct(seedAct(rule));
    setAgentId(seedAgent(rule));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const agent = agentById(agentId);
  const set = (p: Partial<Act>) => setAct((a) => ({ ...a, ...p }));

  const { checks, verdict, applies } = useMemo(() => {
    const one: Rule = { ...rule, id: rule.id || "this-rule", mode: undefined };
    const { checks } = checkRule(one, act, agent.category);
    const v = evaluate(act, [one], agent.category);
    // The rule applies whenever the evaluator reached a decision through it — including a refusal
    // caused by unproven context or forbidden content.
    return { checks, verdict: v, applies: v.rule !== "default" };
  }, [rule, act, agent.category]);
  const matched = applies;

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[11.5px] font-medium text-fg-2 mb-1">Agent</div>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-surface px-2 text-[12.5px]">
          {AGENTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {catName(a.category)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {inputs.includes("path") && (
          <Labeled label="File path">
            <input className={inputCls} value={act.path ?? ""} onChange={(e) => set({ path: e.target.value })} />
          </Labeled>
        )}
        {inputs.includes("command") && (
          <Labeled label="Command">
            <input className={inputCls} value={act.command ?? ""} onChange={(e) => set({ command: e.target.value })} />
          </Labeled>
        )}
        {inputs.includes("branch") && (
          <Labeled label="Branch">
            <input className={inputCls} value={act.branch ?? ""} onChange={(e) => set({ branch: e.target.value })} />
          </Labeled>
        )}
        {inputs.includes("columns") && (
          <Labeled label="Columns read (comma separated)">
            <input className={inputCls} value={(act.columns ?? []).join(", ")} onChange={(e) => set({ columns: e.target.value.split(",").map((c) => c.trim()).filter(Boolean) })} />
          </Labeled>
        )}
        {inputs.includes("destination") && (
          <>
            <Labeled label="Destination domain">
              <input className={inputCls} value={act.destination ?? ""} onChange={(e) => set({ destination: e.target.value })} />
            </Labeled>
            <Labeled label="Payload">
              <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[12px]">
                <input type="checkbox" checked={!!act.credentials} onChange={(e) => set({ credentials: e.target.checked })} />
                carries credentials
              </label>
            </Labeled>
          </>
        )}
        {inputs.includes("sql") && (
          <Labeled label="SQL" wide>
            <input
              className={inputCls}
              value={act.sql ?? ""}
              onChange={(e) => {
                const sql = e.target.value;
                const cols = (sql.match(/select\s+(.*?)\s+from/i)?.[1] ?? "").split(",").map((c) => c.trim().split(/\s+/)[0].replace(/.*\./, "").toLowerCase()).filter(Boolean);
                set({ sql, ...(effect === "database.read" ? { columns: cols } : {}) });
              }}
            />
          </Labeled>
        )}
        {inputs.includes("amount") && (
          <Labeled label={`Amount${info?.unit ? ` (${info.unit})` : ""}`}>
            <input
              type="number"
              className={inputCls}
              value={act.amount ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value) || 0;
                set({ amount: v, ...(info?.unit === "USD" || !info?.unit ? { amountUsd: v } : {}) });
              }}
            />
          </Labeled>
        )}
        {effect === "purchase.order" && (
          <Labeled label="Budget its parent delegated (USD)">
            <input type="number" className={inputCls} value={act.budget ?? 0} onChange={(e) => set({ budget: Number(e.target.value) || 0 })} />
          </Labeled>
        )}
        {inputs.includes("env") && (
          <Labeled label="Environment">
            <select value={act.env ?? "development"} onChange={(e) => set({ env: e.target.value as Env })} className="h-9 w-full rounded-lg border border-line bg-surface px-2 text-[12.5px]">
              {ENVS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </Labeled>
        )}
      </div>

      {!!ctxKeys(rule).length && (
        <div>
          <div className="text-[11.5px] font-medium text-fg-2 mb-1.5">Context the action presents</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {ctxKeys(rule).map(({ key, kind }) => {
              const val = act.ctx?.[key];
              const setCtx = (v: string | number | boolean) => setAct((a) => ({ ...a, ctx: { ...(a.ctx ?? {}), [key]: v } }));
              return (
                <label key={key} className="block">
                  <span className="font-mono text-[10.5px] text-fg-3">{key}</span>
                  {kind === "bool" ? (
                    <select value={String(val ?? "")} onChange={(e) => setCtx(e.target.value === "true")} className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2 font-mono text-[12px]">
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : kind === "number" ? (
                    <input type="number" className={cn(inputCls, "mt-1")} value={Number(val ?? 0)} onChange={(e) => setCtx(Number(e.target.value) || 0)} />
                  ) : (
                    <input className={cn(inputCls, "mt-1")} value={String(val ?? "")} onChange={(e) => setCtx(e.target.value)} />
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-lg bg-surface-2 p-3">
        <div className="space-y-1">
          {checks.map((c) => (
            <div key={c.field} className={cn("flex items-start gap-1.5 font-mono text-[11.5px]", c.ok ? "text-fg-2" : "text-block")}>
              {c.ok ? <Check className="mt-0.5 size-3 shrink-0 text-allow" strokeWidth={3} /> : <X className="mt-0.5 size-3 shrink-0" strokeWidth={3} />}
              <span>{c.detail}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-[12.5px]">
          {matched ? (
            <>
              <span className="text-fg-3">→</span>
              <DecisionPill d={verdict.decision} size="sm" />
              {verdict.approvers && (
                <span className="font-mono text-[11.5px] text-fg-2">
                  {verdict.approvers}
                  {verdict.quorum && verdict.quorum > 1 ? ` · ${verdict.quorum} people` : ""}
                </span>
              )}
              {verdict.constrain && <span className="font-mono text-[11.5px] text-fg-2">rewrite: {verdict.constrain}</span>}
              <span className="text-fg-3">{verdict.reason}</span>
            </>
          ) : (
            <span className="font-semibold text-fg-2">→ DOESN'T MATCH — this action falls through to the rest of the contract</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Labeled({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={cn("block", wide && "sm:col-span-2")}>
      <span className="text-[11.5px] font-medium text-fg-2">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}
