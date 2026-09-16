// The Enforcement Playground — a full-screen, three-column exploration of one
// intent contract. Decisions are click-driven only: no scenario autoplays and no
// verdict advances on a timer. The only free-running motion is ambient dressing —
// the heartbeat on the rails, the live enrolment dots, mouse parallax — which
// never touches the engine and stops under prefers-reduced-motion.
//
// Left = ADMIN · deploy + the intent contract · Middle = THE WRAPBOX FABRIC (the
// teaching diagram + the real decision) · Right = WHERE IS THE AGENT? (the explorer).
//
// The surroundings (browser chrome, IDE, SQL editor, refund form, the MDM push)
// are simulated; every VERDICT is the real engine output returned by
// runAction() — this file never authors a decision string.
//
// Presentation is built from the product's own atoms (src/components/ui.tsx) and
// page idioms (fleet / settings / evidence) so this reads as the same product.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import {
  Bot,
  Boxes,
  Check,
  ChevronDown,
  CreditCard,
  Cpu,
  Database,
  GitBranch,
  Hash,
  HelpCircle,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  Moon,
  Repeat,
  RotateCcw,
  Play,
  Send,
  Server,
  ShieldCheck,
  ShieldAlert,
  Signature,
  Sun,
  Upload,
} from "lucide-react";
import {
  AGENT_POOLS,
  INTENT_CONTRACT,
  POLICY_TOGGLES,
  SURFACES,
  activeRules,
  runAction,
  type Plane,
  type RunResult,
  type ScenarioAction,
  type Surface,
  type SurfaceGroup,
} from "../data/playground";
import type { Decision } from "../data/agents";
import type { Rule } from "../data/contract";
import type { Act, Verdict } from "../lib/engine";
import { mintPermit, signApproval, verifyPermit, short, type Check as PermitCheck, type Permit } from "../lib/permit";
import { Checks, PermitTicket } from "../components/permit";
import { switchWorkspace } from "../lib/store";
import { useNavStyle } from "../lib/navstyle";
import { WrapboxWordmark } from "../components/logo";
import { Button, Card, CardHead, Chip, D_DOT, D_VAR, DecisionPill, Dot, Drawer, EvidenceChain, Logo, Segmented, Toggle, cn } from "../components/ui";

/* ============================ stage theme ============================ */
// The stage carries its own light/dark switch (header, Sun/Moon), independent of
// the app setting: the mount effect pins `data-theme` on the root to whichever
// side is chosen, so every token — and the portalled Drawer — resolves with it.
type StageTheme = "light" | "dark";
const THEME_KEY = "wbx-live-theme";

const STAGE: CSSProperties = { fontFamily: "var(--font-sans)", color: "var(--fg)" };
// The ground: a quiet radial wash instead of the flat token, so the white cards
// visibly lift in light and the dark side reads as the app shell's deep field.
const GROUND: Record<StageTheme, string> = {
  light: "radial-gradient(1200px 700px at 50% -8%, #e9eefb 0%, #f2f3f0 45%, #f7f7f5 100%)",
  dark: "radial-gradient(1200px 700px at 50% -8%, #111b36 0%, #0a101f 55%, #080c17 100%)",
};

const D_WORD: Record<Decision, string> = { ALLOW: "Allowed", CONSTRAIN: "Constrained", REVIEW: "Held for review", BLOCK: "Blocked" };
// Compiled-rule chips carry the same semantic color as everywhere else a
// decision shows up — never a flat gray that hides which rules are dangerous.
const D_CHIP_TONE: Record<Decision, "block" | "review" | "constrain" | "allow"> = { BLOCK: "block", REVIEW: "review", CONSTRAIN: "constrain", ALLOW: "allow" };

// The product's motion vocabulary: springs for things that land (Segmented,
// Drawer), a single ease for glides.
const SPRING = { type: "spring", duration: 0.35, bounce: 0.15 } as const;
const EASE = [0.22, 0.61, 0.36, 1] as const;

/* ============================ deploy (new, click-driven) ============================ */
type DeployState = "idle" | "onboarded" | "pushed";

const ORG = { name: "Northwind Financial", sso: "Okta · SAML", region: "us-east-1", mdm: "Jamf Pro" };

/** The four devices in the MDM scope. Simulated fleet; deterministic key ids.
 *  A device is never anonymous: enforcement happens on one machine, belonging to
 *  one person, and the receipt has to be able to name both. */
interface Device {
  host: string;
  os: string;
  logo: "apple" | "ubuntu";
  owner: string;
  role: string;
}
const FLEET: Device[] = [
  { host: "nwf-mbp-0417", os: "macOS 15.3", logo: "apple", owner: "Priya Nair", role: "Senior engineer · Payments" },
  { host: "nwf-mbp-0422", os: "macOS 15.3", logo: "apple", owner: "Daniel Okonkwo", role: "Engineer · Platform" },
  { host: "nwf-lnx-ci-02", os: "Ubuntu 24.04", logo: "ubuntu", owner: "svc-build", role: "Service account · CI runner" },
  { host: "nwf-mbp-0431", os: "macOS 14.7", logo: "apple", owner: "Sofia Ramirez", role: "Analyst · Customer ops" },
];
const DEVICE_BY_HOST = new Map(FLEET.map((d) => [d.host, d]));

/** Which machine each runtime surface lives on. Fixed, not random: the same
 *  surface is always the same person's laptop, the way a real fleet behaves.
 *  Gateway surfaces map to nothing — there is no device in front of them. */
const HOST_OF_SURFACE: Record<string, string> = {
  chrome: "nwf-mbp-0417",
  cursor: "nwf-mbp-0417",
  vscode: "nwf-mbp-0422",
  "claude-cli": "nwf-mbp-0422",
  "unknown-agent": "nwf-lnx-ci-02",
  "claude-desktop": "nwf-mbp-0431",
};
const deviceFor = (surface: Surface | null): Device | null =>
  surface && surface.plane === "runtime" ? DEVICE_BY_HOST.get(HOST_OF_SURFACE[surface.id]) ?? null : null;

/** FNV-1a. Every id on this page is derived, never random. */
function hash32(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Device key id: FNV-1a over the hostname, so the same host always shows the same `dk_…`. */
const keyIdFor = (host: string) => `dk_${hash32(host).toString(16).padStart(8, "0")}`;

/* ============================ the review gate ============================ */
// A REVIEW is not the end of the story: it is a request waiting on named people.
// The roster below is the simulated directory behind each approver group the
// rules name (`verdict.approvers`); the SIGNATURES are real — each approval is
// an ECDSA P-256 signature over the exact action, and the permit that follows
// is minted and verified by the same src/lib/permit.ts the main Approvals page
// uses. Nothing here decides anything: the decision already came from the engine.
interface Approver {
  id: string;
  name: string;
  role: string;
}
const APPROVER_ROSTER: Record<string, Approver[]> = {
  "sre-oncall": [
    { id: "p_dmehta", name: "Devika Mehta", role: "SRE · on-call primary" },
    { id: "p_rokafor", name: "Rita Okafor", role: "SRE · on-call secondary" },
    { id: "p_tlind", name: "Tomas Lindqvist", role: "SRE · platform lead" },
  ],
  "payments-manager": [
    { id: "p_jcardoso", name: "Joana Cardoso", role: "Payments · duty manager" },
    { id: "p_akhan", name: "Ayesha Khan", role: "Payments · risk" },
  ],
  "platform-security": [
    { id: "p_nberg", name: "Nils Berg", role: "Platform security" },
    { id: "p_schen", name: "Sophie Chen", role: "Platform security · AppSec" },
  ],
  "cloud-security": [
    { id: "p_mibrahim", name: "Mo Ibrahim", role: "Cloud security" },
    { id: "p_lvargas", name: "Lucia Vargas", role: "Cloud security · IAM" },
    { id: "p_hpark", name: "Hana Park", role: "Cloud security · lead" },
  ],
  "data-governance": [
    { id: "p_ewoods", name: "Elena Woods", role: "Data governance" },
    { id: "p_rsingh", name: "Raj Singh", role: "Data governance · privacy" },
  ],
};
const rosterFor = (group?: string): Approver[] => (group && APPROVER_ROSTER[group]) || [{ id: "p_admin", name: "Workspace admin", role: group ?? "approver" }];

/** The statement the permit binds to — the exact thing the approvers are signing. */
const statementOf = (act: Act): string =>
  act.sql ?? act.command ?? act.path ?? act.destination ?? (act.amountUsd ?? act.amount ? `${act.effect} $${(act.amountUsd ?? act.amount)!.toLocaleString("en-US")}` : act.effect);

/** Exactly what gets hashed into the permit. Changing any of it invalidates the permit. */
const argsOf = (act: Act): Record<string, unknown> => {
  const a: Record<string, unknown> = { effect: act.effect, statement: statementOf(act) };
  if (act.env) a.environment = act.env;
  if (act.branch) a.branch = act.branch;
  if (act.amountUsd ?? act.amount) a.amount_usd = act.amountUsd ?? act.amount;
  return a;
};

/** The altered call a tamper probe models: the same request with one edit. */
const tamperedArgs = (act: Act): Record<string, unknown> => ({ ...argsOf(act), statement: statementOf(act) + " OR 1=1" });

/* ============================ rule → decision (derived, never written) ============================ */
const RANK: Record<Decision, number> = { ALLOW: 1, CONSTRAIN: 2, REVIEW: 3, BLOCK: 4 };

/** The strongest decision this rule can reach — read off the Rule, not typed in. */
function ruleDecision(r: Rule): Decision {
  const cands: Decision[] = [];
  if (r.decision) cands.push(r.decision);
  for (const t of r.tiers ?? []) cands.push(t.decision);
  for (const e of r.escalations ?? []) cands.push(e.decision);
  if (r.forbid?.length) cands.push("BLOCK");
  if (!cands.length) return "ALLOW";
  return cands.sort((x, y) => RANK[y] - RANK[x])[0];
}

const DECISION_ORDER: Decision[] = ["BLOCK", "REVIEW", "CONSTRAIN", "ALLOW"];

/* ============================ the real verdict ============================ */
function VerdictCard({ verdict, permitId, rewritten, original }: { verdict: Verdict; permitId?: string; rewritten?: string; original?: string }) {
  const d = verdict.decision;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <DecisionPill d={d} />
        <span className="text-[13px] font-semibold">{D_WORD[d]}</span>
        {verdict.constrain && <Chip tone="muted"><span className={cn("size-1.5 rounded-full", D_DOT.CONSTRAIN)} />{verdict.constrain === "mask" ? "masked" : verdict.constrain}</Chip>}
      </div>
      {/* The rule id and title live on the "Matched rule" row and the full trace in
          the Why drawer — the decision row states the reason once, and only when it
          adds something the title did not already say. */}
      {verdict.reason !== verdict.title && <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">{verdict.reason}</p>}
      {(verdict.approvers || verdict.quorum || permitId) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {verdict.approvers && <Chip tone="review">{verdict.approvers}</Chip>}
          {verdict.quorum ? <Chip tone="review"><Signature className="size-3" /> quorum {verdict.quorum}</Chip> : null}
          {permitId && <Chip tone="accent"><KeyRound className="size-3" /> {permitId}</Chip>}
        </div>
      )}
      {rewritten && (
        <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3">
          <div className="eyebrow mb-1.5">Rewritten before it ran</div>
          <div className="font-mono text-[11.5px] leading-snug text-fg-3 line-through">{original}</div>
          <div className="mt-1 break-all font-mono text-[11.5px] leading-snug text-fg">{rewritten}</div>
        </div>
      )}
    </div>
  );
}

/* ============================ 1 · ADMIN ============================ */
function DeployCard({ deploy, onOnboard, onPush, reduced }: { deploy: DeployState; onOnboard: () => void; onPush: () => void; reduced: boolean }) {
  const onboarded = deploy !== "idle";
  const pushed = deploy === "pushed";
  return (
    <Card className="shrink-0 overflow-hidden shadow-card">
      <CardHead title="Deploy" sub="Create the workspace, then push wrapboxd to the fleet." />
      <div className="border-t border-line">
        {/* Step 1 */}
        <div className="px-6 py-4 border-b border-line">
          <div className="flex items-center justify-between gap-3">
            <div className="eyebrow">Step 1 · Create workspace</div>
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-3">
              <Dot tone={onboarded ? "allow" : "muted"} /> {onboarded ? "done" : "idle"}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-[112px_1fr] gap-y-1.5 text-[12.5px]">
            <dt className="text-fg-3">Organization</dt>
            <dd className="font-medium">{ORG.name}</dd>
            <dt className="text-fg-3">Single sign-on</dt>
            <dd className="font-medium">{ORG.sso}</dd>
            <dt className="text-fg-3">Region</dt>
            <dd className="font-mono text-[12px]">{ORG.region}</dd>
          </dl>
          <div className="mt-3 flex items-center gap-3">
            {onboarded ? (
              <>
                <Chip tone="allow"><Check className="size-3" /> Workspace created</Chip>
                <span className="font-mono text-[11.5px] text-fg-3">console.wrapbox.ai/northwind</span>
              </>
            ) : (
              <Button variant="primary" size="sm" onClick={onOnboard}>Create workspace</Button>
            )}
          </div>
        </div>
        {/* Step 2 */}
        <div className="px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="eyebrow">Step 2 · Push wrapboxd to the fleet</div>
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-3">
              <Dot tone={pushed ? "allow" : "muted"} /> {pushed ? "done" : "idle"}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-lg bg-surface-2 text-fg-2"><Laptop className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">{ORG.mdm}</div>
              <div className="text-[12px] text-fg-2">{FLEET.length} devices in scope · macOS and Linux</div>
            </div>
            <span className="flex items-center -space-x-1.5" aria-hidden>
              <Logo name="apple" size={20} rounded="rounded-full" />
              <Logo name="ubuntu" size={20} rounded="rounded-full" />
            </span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            {pushed ? (
              <Chip tone="allow"><Check className="size-3" /> Push sent · {FLEET.length} devices</Chip>
            ) : (
              <Button variant="accent" size="sm" onClick={onPush} disabled={!onboarded}>Push via MDM</Button>
            )}
            <AnimatePresence initial={false}>
              {!onboarded && (
                <motion.span key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.01 : 0.2 }} className="text-[11.5px] text-fg-3">
                  create the workspace first
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </Card>
  );
}

function IntentContract({ enabled, onToggle, onReset, reduced }: { enabled: string[]; onToggle: (id: string) => void; onReset: () => void; reduced: boolean }) {
  // The same helper runAction() uses, so the chips can never disagree with the
  // rule set the engine actually evaluated.
  const active = activeRules(enabled);
  const grouped = DECISION_ORDER.map((d) => ({ d, rules: active.filter((r) => ruleDecision(r) === d) })).filter((g) => g.rules.length);

  return (
    <Card className="shrink-0 shadow-card">
      <CardHead title="Intent contract" sub="What the admin wrote" right={<Button variant="ghost" size="sm" onClick={onReset}><RotateCcw className="size-3.5" /> Reset</Button>} />
      <div className="border-t border-line">
        <div className="px-6 py-4 border-b border-line">
          <blockquote className="border-l-2 border-accent pl-3">
            {INTENT_CONTRACT.map((line, i) => (
              <p key={i} className={cn("text-[13.5px] leading-relaxed", i && "mt-1")}>{line}</p>
            ))}
          </blockquote>
        </div>

        {/* compiled */}
        <div className="px-6 py-4 border-b border-line">
          <div className="eyebrow">Compiled into {active.length} rules</div>
          <div className="mt-3 space-y-3">
            {grouped.map((g) => (
              <div key={g.d}>
                <div className="eyebrow mb-1.5 flex items-center gap-1.5">
                  <span className={cn("size-1.5 rounded-full", D_DOT[g.d])} />
                  {g.d} · {g.rules.length}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <AnimatePresence initial={false}>
                    {g.rules.map((r) => (
                      <motion.span key={r.id} layout initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }} transition={reduced ? { duration: 0.01 } : SPRING} title={r.why}>
                        <Chip tone={D_CHIP_TONE[g.d]}>{r.title}</Chip>
                      </motion.span>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* toggles — these really add and remove rules */}
        <div className="px-6 pt-4 pb-2">
          <div className="eyebrow">Policy switches</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-fg-3">Each switch adds or removes real rules from the set the engine evaluates. Turning one off re-runs the selected action, and the decision changes.</p>
        </div>
        <div>
          {POLICY_TOGGLES.map((t, i) => {
            const on = enabled.includes(t.id);
            return (
              <div key={t.id} className={cn("flex items-center gap-4 px-6 py-3.5", i < POLICY_TOGGLES.length - 1 && "border-b border-line")}>
                <div className="min-w-0 flex-1">
                  <div className={cn("text-[13.5px] font-semibold", !on && "text-fg-2")}>{t.label}</div>
                  <div className="mt-0.5 font-mono text-[11.5px] text-fg-3 truncate">{t.ruleIds.join(" · ")}</div>
                </div>
                <Toggle on={on} onChange={() => onToggle(t.id)} label={t.label} />
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/* ============================ 2 · THE WRAPBOX FABRIC ============================ */
function Node({ icon, title, copy, lit, tone = "accent", ruleId, right, reduced, children }: { icon: ReactNode; title: string; copy: ReactNode; lit?: boolean; tone?: "accent" | "ink"; ruleId?: string; right?: ReactNode; reduced: boolean; children?: ReactNode }) {
  const ring = tone === "ink" ? "var(--ink)" : "var(--accent)";
  return (
    <motion.div
      animate={{ boxShadow: lit ? `0 0 0 2px color-mix(in oklab, ${ring} 28%, transparent)` : "0 0 0 0px transparent" }}
      transition={{ duration: reduced ? 0.01 : 0.3, ease: EASE, delay: lit && !reduced ? 0.4 : 0 }}
      className="relative overflow-hidden rounded-xl border border-line bg-surface-2 px-3.5 py-3"
    >
      {lit && <motion.span layout initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: reduced ? 0.01 : 0.3, ease: EASE, delay: reduced ? 0 : 0.4 }} style={{ background: ring }} className="absolute inset-x-0 top-0 h-[2px] origin-left" aria-hidden />}
      <div className="flex items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface text-fg-2 border border-line">{icon}</span>
        <span className="text-[13px] font-semibold">{title}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {right}
          <AnimatePresence initial={false}>
            {lit && ruleId && (
              <motion.span key={ruleId} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={reduced ? { duration: 0.01 } : { ...SPRING, delay: 0.45 }}>
                <Chip tone="accent" className="whitespace-nowrap"><span className="font-mono">{ruleId}</span></Chip>
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg-2">{copy}</p>
      {children}
    </motion.div>
  );
}

function RailDown({ live }: { live?: boolean }) {
  return (
    <div className="relative h-5" aria-hidden>
      {live && <span className="wbx-heart absolute left-1/2 top-0 size-1 rounded-full bg-accent" />}
      <span className="absolute left-1/2 top-0 h-2.5 w-px -translate-x-1/2 bg-line" />
      <span className="absolute left-[25%] right-[25%] top-2.5 h-px bg-line" />
      <span className="absolute left-[25%] top-2.5 h-2.5 w-px bg-line" />
      <span className="absolute right-[25%] top-2.5 h-2.5 w-px bg-line" />
    </div>
  );
}
function RailUp({ live }: { live?: boolean }) {
  return (
    <div className="relative h-5" aria-hidden>
      {live && <span className="wbx-heart wbx-heart-2 absolute left-1/2 top-0 size-1 rounded-full bg-accent" />}
      <span className="absolute left-[25%] top-0 h-2.5 w-px bg-line" />
      <span className="absolute right-[25%] top-0 h-2.5 w-px bg-line" />
      <span className="absolute left-[25%] right-[25%] top-2.5 h-px bg-line" />
      <span className="absolute left-1/2 top-2.5 h-2.5 w-px -translate-x-1/2 bg-line" />
    </div>
  );
}

/** The request travelling from the top of the map into the enforcement point.
 *  Keyed on the run so it replays on a click — and only on a click. */
function Packet({ runKey, label, reduced }: { runKey: string; label: string; reduced: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center">
      <motion.span
        key={runKey}
        initial={{ y: reduced ? 6 : -64, opacity: 0 }}
        animate={{ y: 6, opacity: [0, 1, 1, 0] }}
        transition={{ duration: reduced ? 0.01 : 0.6, ease: EASE, times: [0, 0.2, 0.75, 1] }}
        className="max-w-[80%]"
      >
        <Chip tone="accent" className="shadow-card"><span className="font-mono truncate">{label}</span></Chip>
      </motion.span>
    </div>
  );
}

function FleetList({ deploy, enrolled, activeHost, reduced }: { deploy: DeployState; enrolled: number; activeHost?: string; reduced: boolean }) {
  if (deploy !== "pushed") return <div className="mt-2.5 border-t border-line pt-2 text-[12.5px] text-fg-2">0 devices · push wrapboxd from Deploy, on the left</div>;
  return (
    <div className="mt-2.5 border-t border-line">
      {/* The header counts enrolment up as the sequence lands; each row flips from
          enrolling to a pulsing live dot the moment its key is minted. */}
      <div className="flex items-center justify-between pt-2 pb-1 text-[11px] text-fg-3">
        <span>Device</span>
        <span className="tnum">{Math.min(enrolled, FLEET.length)}/{FLEET.length} enrolled</span>
      </div>
      <ul>
        {FLEET.map((d, i) => {
          const ok = i < enrolled;
          const here = d.host === activeHost;
          return (
            <motion.li
              key={d.host}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reduced ? 0.01 : 0.28, ease: EASE, delay: reduced ? 0 : 0.5 + i * 0.38 }}
              className={cn("border-t border-line py-1.5", here && "-mx-2 rounded-lg bg-accent-soft px-2 ring-1 ring-accent/25")}
            >
              <div className="flex items-center gap-2">
                <Logo name={d.logo} size={18} rounded="rounded-[5px]" />
                <span className={cn("truncate font-mono text-[12.5px]", here ? "font-semibold text-accent" : "text-fg")}>{d.host}</span>
                <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[11px]">
                  {ok ? (
                    <>
                      <span className="live-dot size-[7px] rounded-full bg-allow" />
                      <span className="font-medium text-allow">enrolled</span>
                    </>
                  ) : (
                    <>
                      <span className="size-[7px] animate-pulse rounded-full border border-fg-3" />
                      <span className="text-fg-3">enrolling…</span>
                    </>
                  )}
                </span>
              </div>
              <div className="pl-[26px] text-[11.5px] text-fg-2">
                <span className="truncate">{d.owner}</span>
                <span className="text-fg-3"> · {d.role}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 pl-[26px] text-[11.5px] text-fg-2">
                <span className="truncate">{d.os}</span>
                <span aria-hidden>·</span>
                {ok ? <span className="shrink-0 font-mono">{keyIdFor(d.host)}</span> : <span className="shrink-0 font-mono text-fg-3">minting key…</span>}
                {ok && <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-fg-3">just now</span>}
              </div>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

function FabricMap({ run, runKey, effect, deploy, device, receiptCount, reduced }: { run: RunResult | null; runKey: string; effect: string; deploy: DeployState; device: Device | null; receiptCount: number; reduced: boolean }) {
  const plane = run?.plane;
  const pushed = deploy === "pushed";

  // Presentation-only enrolment sequence: the push click starts it, reduced
  // motion snaps it, and reset (deploy back to idle) clears it. It never feeds
  // runAction() — decisions stay click-only.
  const [enrolled, setEnrolled] = useState(0);
  useEffect(() => {
    if (!pushed) {
      setEnrolled(0);
      return;
    }
    if (reduced) {
      setEnrolled(FLEET.length);
      return;
    }
    const timers = FLEET.map((_, i) => window.setTimeout(() => setEnrolled(i + 1), 680 + i * 380));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [pushed, reduced]);
  const allIn = enrolled >= FLEET.length;

  // Mouse parallax over the map — the product's .parallax-mouse idiom. CSS vars
  // only; the reduced-motion media query already pins the transform.
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    if (reduced) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    el.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };
  const onLeave = (e: MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.setProperty("--mx", "0");
    e.currentTarget.style.setProperty("--my", "0");
  };

  return (
    <div className="px-6 py-5" onMouseMove={onMove} onMouseLeave={onLeave}>
      <div className="parallax-mouse" style={{ "--depth": 3 } as CSSProperties}>
        <Node
          icon={<Cpu className="size-3.5" />}
          title="Control plane"
          copy="Holds the contract and the evidence — compiles the admin's sentence into rules and signs every receipt."
          right={pushed && <Chip tone="muted"><Signature className="size-3" /> policy bundle v1 · signed</Chip>}
          reduced={reduced}
        />
      </div>
      <RailDown live={pushed && !reduced} />
      <div className="grid grid-cols-2 gap-3">
        <div className="parallax-mouse relative" style={{ "--depth": 6 } as CSSProperties}>
          <Node
            icon={<Laptop className="size-3.5" />}
            title="Runtime"
            copy="On the device · OS-level enforcement (Apple Endpoint Security on macOS, kernel confinement on Linux)."
            lit={plane === "runtime"}
            ruleId={run?.verdict.rule}
            right={pushed && allIn ? <Chip tone="allow" className="whitespace-nowrap">Fleet · {FLEET.length}</Chip> : undefined}
            reduced={reduced}
          >
            <FleetList deploy={deploy} enrolled={enrolled} activeHost={plane === "runtime" ? device?.host : undefined} reduced={reduced} />
          </Node>
          {pushed && !allIn && <Packet runKey="mdm-push" label="wrapboxd · policy v1" reduced={reduced} />}
          {run && plane === "runtime" && <Packet runKey={runKey} label={effect} reduced={reduced} />}
        </div>
        <div className="parallax-mouse relative" style={{ "--depth": 6 } as CSSProperties}>
          <Node
            icon={<Server className="size-3.5" />}
            title="Gateway"
            copy="To company systems — APIs, MCP, SaaS, cloud and data — even when the agent runs elsewhere."
            lit={plane === "gateway"}
            tone="ink"
            ruleId={run?.verdict.rule}
            reduced={reduced}
          />
          {run && plane === "gateway" && <Packet runKey={runKey} label={effect} reduced={reduced} />}
        </div>
      </div>
      <RailUp live={pushed && !reduced} />
      <div className="parallax-mouse" style={{ "--depth": 3 } as CSSProperties}>
        <Node
          icon={<Signature className="size-3.5" />}
          title="Signed evidence"
          copy={receiptCount ? `${receiptCount} signed ${receiptCount === 1 ? "receipt" : "receipts"} this session · replayable from the control plane.` : "Every decision — allowed, constrained, held or blocked — becomes a signed receipt the control plane can replay."}
          reduced={reduced}
        />
      </div>
    </div>
  );
}

interface Receipt {
  key: string;
  receiptId: string;
  decision: Decision;
  label: string;
  /** Set on the follow-on record a review outcome writes (execution or denial). */
  note?: string;
}

function EvidenceList({ receipts, reduced }: { receipts: Receipt[]; reduced: boolean }) {
  if (!receipts.length) return null;
  return (
    <div className="border-t border-line">
      <div className="eyebrow px-6 pt-4 pb-2">Evidence · last {Math.min(receipts.length, 5)}</div>
      <AnimatePresence initial={false}>
        {receipts.slice(0, 5).map((r) => (
          <motion.div
            key={r.key}
            layout="position"
            initial={{ opacity: 0, y: -8, backgroundColor: "color-mix(in oklab, var(--accent) 8%, transparent)" }}
            animate={{ opacity: 1, y: 0, backgroundColor: "rgba(0,0,0,0)" }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.01 : 0.5 }}
            className="flex items-center gap-3 px-6 py-2.5 border-b border-line last:border-0"
          >
            <DecisionPill d={r.decision} size="sm" />
            <span className="min-w-0 flex-1 truncate text-[12.5px]">
              {r.label}
              {r.note && <span className="text-fg-3"> · {r.note}</span>}
            </span>
            <span className="font-mono text-[11px] text-fg-3">{r.receiptId}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function FabricColumn({
  run,
  runKey,
  action,
  surface,
  receipts,
  deploy,
  reduced,
  onAnotherAgent,
  onGateOutcome,
}: {
  run: RunResult | null;
  runKey: string;
  action: ScenarioAction | null;
  surface: Surface | null;
  receipts: Receipt[];
  deploy: DeployState;
  reduced: boolean;
  onAnotherAgent: () => void;
  onGateOutcome: (o: GateOutcome) => void;
}) {
  const [why, setWhy] = useState(false);
  useEffect(() => setWhy(false), [runKey]);
  const reveal = reduced ? 0 : 0.5;
  // After the click-triggered reveal lands, bring the decision into view (the
  // map above it is tall once the fleet is enrolled). Nearest edge only — no
  // jump when it is already visible.
  const decisionRef = useRef<HTMLDivElement>(null);
  const settle = () => decisionRef.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  const live = run && action && surface;
  const device = deviceFor(surface);

  const rows = live
    ? [
        {
          label: "Source",
          value: (
            <>
              <span className="font-medium">{run.agent}</span>
              <span className="text-fg-3">{run.agent === surface.title ? "" : ` · ${surface.title}`} — {surface.subtitle}</span>
            </>
          ),
        },
        {
          label: "Device",
          value: device ? (
            // Enforcement happened on ONE machine, belonging to one person. The
            // receipt names both, so an investigator knows where to go.
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Logo name={device.logo} size={16} rounded="rounded-[4px]" />
              <span className="font-medium">{device.owner}</span>
              <span className="text-fg-3">· {device.role}</span>
              <span className="basis-full font-mono text-[12px] text-fg-2">
                {device.host} · {device.os} · {keyIdFor(device.host)}
              </span>
              {deploy !== "pushed" && <span className="basis-full text-[12px] text-fg-3">fleet not pushed yet — enrolled ad hoc for this run</span>}
            </span>
          ) : (
            <span className="text-fg-2">
              No enrolled device — the agent reached the company system through the Gateway, so there is no laptop in front of it to enforce on.
            </span>
          ),
        },
        { label: "Intent", value: <span className="text-fg-2">{action.intent}</span> },
        {
          label: "Enforced at",
          value: (
            <span className="flex flex-wrap items-center gap-x-1.5">
              <PlaneTag plane={run.plane} />
              <span className="text-fg-3">— {run.plane === "runtime" ? `on ${device?.host ?? "the device"}` : "in front of the company system"}</span>
            </span>
          ),
        },
        {
          label: "Matched rule",
          value: (
            <>
              <span className="font-mono text-[12px]">{run.verdict.rule}</span>
              <span className="text-fg-3"> · {run.verdict.title}</span>
            </>
          ),
        },
        { label: "Decision", value: <VerdictCard verdict={run.verdict} permitId={run.permitId} rewritten={run.rewritten} original={action.act.command ?? action.act.sql} /> },
        { label: "Result", value: <span className="text-fg-2">{run.result}</span> },
        {
          label: "Evidence",
          value: (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Chip tone="muted"><Signature className="size-3" /> <span className="font-mono">{run.receiptId}</span></Chip>
              <span className="text-fg-3">signed receipt · replayable</span>
            </span>
          ),
        },
      ]
    : [];

  return (
    <Card className="shrink-0 shadow-card">
      <CardHead title="The Wrapbox fabric" sub="Where the request goes, which rule matched, and what the engine decided at the moment you clicked." />
      <div className="border-t border-line">
        <FabricMap run={run} runKey={runKey} effect={action?.act.effect ?? ""} deploy={deploy} device={device} receiptCount={receipts.length} reduced={reduced} />
      </div>

      {!live ? (
        <div className="border-t border-line px-6 py-10 text-center text-[13px] text-fg-3">Pick a surface on the right, then run one of its actions.</div>
      ) : (
        <div className="border-t border-line px-6 py-5">
          <motion.div ref={decisionRef} key={runKey} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0.01 : 0.35, ease: EASE, delay: reveal }} onAnimationComplete={settle}>
            <Card className="relative overflow-hidden shadow-card">
              <span aria-hidden className="absolute inset-x-0 top-0 h-[2px]" style={{ background: D_VAR[run.verdict.decision] }} />
              <CardHead title="Decision" sub={`${run.agent} · ${action.label}`} right={<DecisionPill d={run.verdict.decision} />} />
              <div className="border-t border-line px-6 py-5">
                <EvidenceChain rows={rows} />
              </div>
              {run.verdict.decision === "REVIEW" && (
                <ReviewGate
                  key={runKey}
                  verdict={run.verdict}
                  act={action.act}
                  agent={run.agent}
                  onBehalfOf={device ? `${device.owner} · ${device.host}` : "no enrolled device · gateway"}
                  ruleId={run.verdict.rule}
                  decisionId={run.receiptId}
                  reduced={reduced}
                  onOutcome={onGateOutcome}
                />
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-3.5">
                <Button variant="secondary" size="sm" onClick={() => setWhy(true)}><HelpCircle className="size-3.5" /> Why?</Button>
                <Button variant="secondary" size="sm" onClick={onAnotherAgent}><Repeat className="size-3.5" /> Try another agent</Button>
                <span className="text-[12px] text-fg-3">The rule keys on the action and its context, not the agent's name.</span>
              </div>
            </Card>
          </motion.div>
        </div>
      )}

      <EvidenceList receipts={receipts} reduced={reduced} />

      <Drawer open={why && !!live} onClose={() => setWhy(false)} width={480} title="Why this decision">
        {live && (
          <div className="p-5 space-y-5">
            <div className="flex items-center gap-2">
              <DecisionPill d={run.verdict.decision} />
              <span className="text-[13px] font-semibold">{D_WORD[run.verdict.decision]}</span>
              <span className="ml-auto font-mono text-[11.5px] text-fg-3">{run.receiptId}</span>
            </div>
            <div>
              <div className="eyebrow mb-2">The rule, in plain English</div>
              <p className="text-[13.5px] leading-relaxed">{action.why}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <div className="text-[13px] font-semibold">{run.verdict.title}</div>
              {run.verdict.reason !== run.verdict.title && <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{run.verdict.reason}</p>}
              <div className="mt-2 font-mono text-[11.5px] text-fg-3">rule {run.verdict.rule}</div>
            </div>
            <div>
              <div className="eyebrow mb-2">Evaluation trace</div>
              <EvidenceChain
                rows={run.verdict.trace
                  .filter((t) => t.matched)
                  .map((t) => ({
                    label: t.decision ?? "match",
                    value: (
                      <>
                        <span className="font-mono text-[12px]">{t.rule.id}</span>
                        <span className="text-fg-3"> — {t.why}</span>
                      </>
                    ),
                  }))}
              />
            </div>
          </div>
        )}
      </Drawer>
    </Card>
  );
}

/* ---- the review gate: a held request, its approvers, and the permit ---- */
interface GateOutcome {
  kind: "executed" | "denied";
  by: string;
  permitId?: string;
}

function ReviewGate({
  verdict,
  act,
  agent,
  onBehalfOf,
  ruleId,
  decisionId,
  reduced,
  onOutcome,
}: {
  verdict: Verdict;
  act: Act;
  agent: string;
  onBehalfOf: string;
  ruleId: string;
  decisionId: string;
  reduced: boolean;
  onOutcome: (o: GateOutcome) => void;
}) {
  const roster = rosterFor(verdict.approvers);
  const quorum = Math.min(verdict.quorum ?? 1, roster.length);

  const [signed, setSigned] = useState<{ id: string; name: string; sig: string }[]>([]);
  const [denied, setDenied] = useState<Approver | null>(null);
  const [permit, setPermit] = useState<Permit | null>(null);
  const [checks, setChecks] = useState<PermitCheck[] | null>(null);
  const [probe, setProbe] = useState<PermitCheck[] | null>(null);
  const [busy, setBusy] = useState(false);

  const met = signed.length >= quorum;

  // One approval = one real ECDSA signature over this exact action.
  const approve = async (p: Approver) => {
    if (busy || denied || signed.some((x) => x.id === p.id)) return;
    setBusy(true);
    const sig = await signApproval(p.id, { gate: ruleId, args: argsOf(act) });
    setSigned((prev) => [...prev, { id: p.id, name: p.name, sig }]);
    setBusy(false);
  };

  // Quorum reached → the control plane mints the permit, bound to these args.
  useEffect(() => {
    if (!met || permit || denied) return;
    let live = true;
    (async () => {
      const minted = await mintPermit({
        decision_id: decisionId,
        subject_agent: agent,
        on_behalf_of: onBehalfOf,
        action: act.effect,
        resource: statementOf(act).slice(0, 48),
        environment: String(act.env ?? "production"),
        approved_by: signed.map((x) => x.name),
        args: argsOf(act),
        ttl: 60,
      });
      if (live) setPermit(minted);
    })();
    return () => {
      live = false;
    };
  }, [met, permit, denied, decisionId, agent, onBehalfOf, act, signed]);

  // The executor's own check, before it performs the effect. Consumes the nonce.
  const runIt = async () => {
    if (!permit || busy || checks) return;
    setBusy(true);
    const c = await verifyPermit(permit, argsOf(act));
    setChecks(c);
    setBusy(false);
    if (c.every((x) => x.ok)) onOutcome({ kind: "executed", by: signed.map((x) => x.name).join(" + "), permitId: permit.id });
  };

  // The same permit presented with an altered statement — refused on the args hash.
  const probeIt = async () => {
    if (!permit || busy) return;
    setBusy(true);
    setProbe(await verifyPermit(permit, tamperedArgs(act), { consume: false, probe: true }));
    setBusy(false);
  };

  const deny = (p: Approver) => {
    if (busy || permit) return;
    setDenied(p);
    onOutcome({ kind: "denied", by: p.name });
  };

  const fade = reduced ? { duration: 0.01 } : { duration: 0.28, ease: EASE };

  return (
    <div className="border-t border-line">
      <div className="flex items-center justify-between gap-3 px-6 pt-4 pb-3">
        <div className="eyebrow flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-review" /> Held for approval
        </div>
        <span className="font-mono text-[11.5px] text-fg-3 tnum">
          {signed.length}/{quorum} signed
        </span>
      </div>

      <div className="px-6 pb-3">
        <p className="text-[12.5px] leading-relaxed text-fg-2">
          {verdict.approvers} — {quorum === 1 ? "one approval" : `${quorum} approvals`} required. Each approval is signed with that person&rsquo;s own key over the exact statement below; the
          permit that follows is bound to it and may be used once.
        </p>
        <div className="mt-2.5 break-all rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[11.5px] leading-snug text-fg">{statementOf(act)}</div>
      </div>

      {/* the approvers */}
      <div>
        {roster.map((p, i) => {
          const mine = signed.find((x) => x.id === p.id);
          return (
            <div key={p.id} className={cn("flex items-center gap-3 px-6 py-3", i < roster.length - 1 && "border-b border-line")}>
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold", mine ? "bg-allow-soft text-allow" : "bg-surface-2 text-fg-2 border border-line")}>
                {mine ? <Check className="size-3.5" /> : p.name.split(" ").map((w) => w[0]).join("")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">{p.name}</div>
                <div className="truncate text-[11.5px] text-fg-3">{mine ? <span className="font-mono">{mine.sig}</span> : p.role}</div>
              </div>
              {mine ? (
                <Chip tone="allow">signed</Chip>
              ) : denied || permit ? (
                <span className="text-[11.5px] text-fg-3">—</span>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => approve(p)} disabled={busy}>
                  Approve as {p.name.split(" ")[0]}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* deny, while it is still open */}
      {!permit && !denied && (
        <div className="flex items-center gap-2 border-t border-line px-6 py-3">
          <Button size="sm" variant="danger" onClick={() => deny(roster[0])} disabled={busy}>
            <ShieldAlert className="size-3.5" /> Deny
          </Button>
          <span className="text-[12px] text-fg-3">A denied request never runs. The refusal is signed too.</span>
        </div>
      )}

      <AnimatePresence initial={false}>
        {denied && (
          <motion.div key="denied" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={fade} className="border-t border-line px-6 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <DecisionPill d="BLOCK" />
              <span className="text-[13px] font-semibold">Denied by {denied.name}</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">No permit was minted, so the action has nothing to present to the executor. It never ran.</p>
          </motion.div>
        )}

        {permit && (
          <motion.div key="permit" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={fade} className="border-t border-line px-6 py-4 space-y-3">
            <div className="eyebrow">Permit issued · {signed.map((x) => x.name).join(" + ")}</div>
            <PermitTicket permit={permit} status={checks?.every((c) => c.ok) ? "used" : "authorized"} />

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" onClick={runIt} disabled={busy || !!checks}>
                <Play className="size-3.5" /> {checks ? "Ran once" : "Run it under the permit"}
              </Button>
              <Button size="sm" variant="secondary" onClick={probeIt} disabled={busy}>
                <Repeat className="size-3.5" /> Try a changed statement
              </Button>
            </div>

            {checks && (
              <div className="rounded-xl border border-line bg-surface-2 p-3.5">
                <div className="eyebrow mb-2">What the executor checked before running it</div>
                <Checks checks={checks} />
                <p className="mt-2.5 text-[12.5px] leading-relaxed text-fg-2">
                  {checks.every((c) => c.ok)
                    ? "All four passed, so the effect ran — once. The nonce is now spent: the same permit presented again is refused."
                    : "A check failed, so the executor refused it."}
                </p>
              </div>
            )}

            {probe && (
              <div className="rounded-xl border border-line bg-surface-2 p-3.5">
                <div className="eyebrow mb-2">The same permit, an altered statement</div>
                <Checks checks={probe} />
                <p className="mt-2.5 text-[12.5px] leading-relaxed text-fg-2">
                  The permit carries <span className="font-mono text-[11.5px]">{short(permit.args_hash)}</span> — the hash of what the approvers signed. A different statement hashes
                  differently, so the approval cannot be carried over to it.
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ============================ 3 · WHERE IS THE AGENT? ============================ */
// Vendor surfaces render their real mark through <Logo>; the lucide glyph is the
// fallback for a surface with no vendor (the unknown agent).
const ICONS: Record<string, typeof Bot> = { Bot };
const iconFor = (name: string) => ICONS[name] ?? Boxes;

type TabId = "all" | "runtime" | "gateway" | "browser" | "ide" | "mcp" | "cloud" | "data" | "saas";
// Two filter dimensions, the way Evidence lays them out: a three-option Segmented
// for the plane and a select for the kind. Both resolve through matchesTab().
const PLANE_TABS: { value: TabId; label: string }[] = [
  { value: "all", label: "All" },
  { value: "runtime", label: "Runtime" },
  { value: "gateway", label: "Gateway" },
];
const KIND_TABS: { value: TabId; label: string }[] = [
  { value: "all", label: "Any kind" },
  { value: "browser", label: "Browser" },
  { value: "ide", label: "IDE" },
  { value: "mcp", label: "MCP" },
  { value: "cloud", label: "Cloud" },
  { value: "data", label: "Data" },
  { value: "saas", label: "SaaS" },
];
const GROUPS_OF_TAB: Record<Exclude<TabId, "all" | "runtime" | "gateway">, SurfaceGroup[]> = {
  browser: ["runtime-browser"],
  ide: ["runtime-ide", "runtime-agent"],
  mcp: ["gateway-mcp"],
  cloud: ["gateway-cloud", "gateway-deploy"],
  data: ["gateway-database"],
  saas: ["gateway-saas"],
};
function matchesTab(s: Surface, tab: TabId): boolean {
  if (tab === "all") return true;
  if (tab === "runtime" || tab === "gateway") return s.plane === tab;
  return GROUPS_OF_TAB[tab].includes(s.group);
}

// One identity per plane, used everywhere a plane is named: Runtime wears the
// accent family, Gateway the solid ink of the primary button. Decision colors
// (allow/review/constrain/block) are never reused for a plane.
const PlaneTag = ({ plane }: { plane: Plane }) =>
  plane === "runtime" ? (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-accent/25 bg-accent-soft px-2 py-1 text-[11.5px] font-medium leading-none text-accent">
      <Laptop className="size-3" /> Runtime
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11.5px] font-medium leading-none text-ink-fg">
      <Server className="size-3" /> Gateway
    </span>
  );

/* ---- the mini interfaces (simulated surroundings, on product tokens) ---- */
const Traffic = () => (
  <span className="flex gap-1" aria-hidden>
    <i className="size-2 rounded-full bg-[#ff5f57]" />
    <i className="size-2 rounded-full bg-[#febc2e]" />
    <i className="size-2 rounded-full bg-[#28c840]" />
  </span>
);
function Field({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 h-7 text-[11.5px] text-fg-3", className)}>{children}</div>;
}

function MiniChrome({ surface, action, agent }: { surface: Surface; action: ScenarioAction | null; agent: string }) {
  const a = action;
  const box = "rounded-lg border border-line bg-surface-2 p-2.5";
  switch (surface.chrome) {
    case "browser":
      return (
        <div className={cn(box, "space-y-2")}>
          <div className="flex items-center gap-2">
            <Traffic />
            <span className="truncate rounded-t-md border border-b-0 border-line bg-surface px-2 py-0.5 text-[11px] text-fg-2">{a?.detail ?? "New tab"}</span>
          </div>
          <Field><Lock className="size-3 text-allow" /><span className="truncate font-mono">{a?.act.destination ?? "about:blank"}</span></Field>
          <Field><Upload className="size-3" /><span className="truncate text-fg-2">{a?.detail ?? "Choose file…"}</span><Chip tone="muted" className="ml-auto">Attach</Chip></Field>
        </div>
      );
    case "ide":
      return (
        <div className={cn(box, "grid grid-cols-[84px_1fr] gap-2")}>
          <div className="space-y-0.5 border-r border-line pr-2 text-[11px] text-fg-3">
            <div className="text-fg-2">src</div>
            <div className="pl-2.5">checkout.ts</div>
            <div className="pl-2.5">pricing.ts</div>
            <div className="pl-2.5 text-block">.env</div>
          </div>
          <div className="space-y-2 min-w-0">
            <div className="truncate rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-fg-2"><span className="text-fg-3">1 </span>{a?.act.path ?? "src/checkout.ts"}</div>
            <Field className="font-mono"><span className="text-allow">➜</span><span className="truncate text-fg-2">{a?.act.command ?? `${agent || "agent"} — ask anything`}</span></Field>
          </div>
        </div>
      );
    case "app":
      return (
        <div className={box}>
          <div className="mb-2 flex items-center gap-2 border-b border-line pb-2">
            <Traffic />
            <span className="text-[11.5px] font-medium text-fg-2">{surface.title}</span>
          </div>
          <div className="rounded-md bg-surface px-2.5 py-2 text-[12px] leading-snug text-fg-2">{a?.intent ?? "Ask the desktop agent to do something."}</div>
          <Field className="mt-2"><span className="truncate">Message {surface.title}…</span><Send className="ml-auto size-3" /></Field>
        </div>
      );
    case "console":
      return (
        <div className={cn(box, "font-mono text-[11.5px] leading-relaxed")}>
          <div className="text-fg-3">{agent || surface.title}</div>
          <div className="break-all text-fg-2"><span className="text-allow">$</span> {a?.act.command ?? a?.act.path ?? "python agent.py"}</div>
        </div>
      );
    case "sql":
      return (
        <div className={box}>
          <div className="eyebrow mb-1.5 flex items-center gap-1.5"><Database className="size-3" /> {surface.title} · production</div>
          <div className="min-h-[38px] break-all rounded-md border border-line bg-surface px-2.5 py-2 font-mono text-[11.5px] leading-snug text-fg-2">{a?.act.sql ?? "SELECT 1;"}</div>
          <div className="mt-2 text-[11.5px] text-fg-2">Pick an action below to run it through the Gateway.</div>
        </div>
      );
    case "payments":
      return (
        <div className={box}>
          <div className="eyebrow mb-1.5 flex items-center gap-1.5"><CreditCard className="size-3" /> Refund</div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-line bg-surface px-2.5 py-1 font-mono text-[14px] font-semibold tnum">${(a?.act.amountUsd ?? a?.act.amount ?? 0).toLocaleString("en-US")}</span>
            <span className="text-[11.5px] text-fg-3">USD · charge ch_3Q7f…</span>
          </div>
        </div>
      );
    case "repo":
      return (
        <div className={box}>
          <div className="flex items-center gap-1.5 text-[11.5px] text-fg-2"><GitBranch className="size-3" /> <span className="font-mono">{a?.act.branch ?? "main"}</span><Chip tone="muted" className="ml-auto">2 checks</Chip></div>
          <Field className="mt-2 font-mono"><span className="truncate">{a?.act.command ?? a?.act.destination ?? "api.github.com"}</span></Field>
        </div>
      );
    case "cloud":
      return (
        <div className={cn(box, "grid grid-cols-3 gap-2 text-[11px] text-fg-2")}>
          <div className="rounded-md border border-line bg-surface px-2 py-1.5">S3 · bucket</div>
          <div className="rounded-md border border-line bg-surface px-2 py-1.5">IAM · role</div>
          <div className="rounded-md border border-line bg-surface px-2 py-1.5">Deploy · {String(a?.act.env ?? "production")}</div>
          <div className="col-span-3 truncate font-mono text-[11px] text-fg-3">{a?.act.destination ?? "aws.amazonaws.com"}</div>
        </div>
      );
    case "chat":
      return (
        <div className={box}>
          <div className="flex items-center gap-1.5 text-[11.5px] text-fg-2"><Hash className="size-3" /> {a?.act.ctx?.["dest.external"] ? "vendor-connect (external)" : "eng-releases"}</div>
          <Field className="mt-2"><span className="truncate">{a?.intent ?? "Message the channel…"}</span><Send className="ml-auto size-3" /></Field>
        </div>
      );
  }
}

function SurfaceRow({
  surface,
  open,
  selectedActionId,
  agent,
  onOpen,
  onRun,
  reduced,
}: {
  surface: Surface;
  open: boolean;
  selectedActionId: string | null;
  agent: string;
  onOpen: () => void;
  onRun: (a: ScenarioAction) => void;
  reduced: boolean;
}) {
  const Icon = iconFor(surface.icon);
  const device = deviceFor(surface);
  // The mini interface shows the action that is actually selected on THIS surface.
  const shown = surface.actions.find((x) => x.id === selectedActionId) ?? null;
  return (
    <div className={cn("border-b border-line last:border-0", open && "bg-surface-2/40")}>
      <button onClick={onOpen} aria-expanded={open} className="flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-surface-2 transition-colors">
        {surface.logo ? (
          <Logo name={surface.logo} size={28} rounded="rounded-lg" className="mt-px" />
        ) : (
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", open ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-2")}><Icon className="size-4" /></span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{surface.title}</span>
          <span className="block truncate text-[12px] text-fg-2">{surface.subtitle}</span>
        </span>
        <PlaneTag plane={surface.plane} />
        <ChevronDown className={cn("mt-1.5 size-3.5 shrink-0 text-fg-3 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0.01 : 0.28, ease: EASE }} className="overflow-hidden">
            <div className="space-y-3 px-5 pb-4">
              {device && (
                <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-2">
                  <Logo name={device.logo} size={18} rounded="rounded-[5px]" />
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">
                    <span className="font-medium">{device.owner}</span>
                    <span className="text-fg-3"> · {device.host}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-fg-3">{device.os}</span>
                </div>
              )}
              <MiniChrome surface={surface} action={shown} agent={agent} />
              <div>
                <div className="eyebrow mb-2">Actions</div>
                <div className="flex flex-wrap gap-1.5">
                  {surface.actions.map((a) => {
                    const on = a.id === selectedActionId;
                    return (
                      // "selected", never "running": a BLOCKED action never ran.
                      <Button key={a.id} size="sm" variant={on ? "primary" : "secondary"} onClick={() => onRun(a)} aria-pressed={on} className="max-w-full">
                        <span className="truncate">{a.label}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Explorer({
  tab,
  setTab,
  openId,
  setOpenId,
  selectedActionId,
  agent,
  onRun,
  reduced,
}: {
  tab: TabId;
  setTab: (t: TabId) => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  selectedActionId: string | null;
  agent: string;
  onRun: (s: Surface, a: ScenarioAction) => void;
  reduced: boolean;
}) {
  const [kind, setKind] = useState<TabId>("all");
  const list = SURFACES.filter((s) => matchesTab(s, tab) && matchesTab(s, kind));
  return (
    <Card className="shrink-0 shadow-card">
      <CardHead title="Where is the agent?" sub="Every place an agent can run. Open one, then run an action — any surface, any order." />
      <div className="flex items-center gap-2 px-6 py-4 border-t border-line">
        <Segmented size="sm" options={PLANE_TABS} value={tab} onChange={setTab} />
        <select value={kind} onChange={(e) => setKind(e.target.value as TabId)} aria-label="Kind of surface" className="h-7 rounded-full border border-line bg-surface px-3 text-[12.5px] text-fg-2 outline-none">
          {KIND_TABS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
      </div>
      <div className="border-t border-line">
        {list.map((s) => (
          <SurfaceRow key={s.id} surface={s} open={openId === s.id} selectedActionId={selectedActionId} agent={agent} onOpen={() => setOpenId(openId === s.id ? null : s.id)} onRun={(a) => onRun(s, a)} reduced={reduced} />
        ))}
        {!list.length && <div className="px-6 py-10 text-[12.5px] text-fg-3">No surfaces in this filter.</div>}
      </div>
    </Card>
  );
}

/* ============================ the page ============================ */
interface Selection {
  surfaceId: string;
  actionId: string;
  agent: string;
  /** Bumped on every explicit click so motion replays — never incremented by a timer. */
  n: number;
}

const DEFAULT_TOGGLES = POLICY_TOGGLES.filter((t) => t.defaultOn).map((t) => t.id);

export function EnforcementPlayground() {
  // Deploy is presentation state: it never feeds runAction(). Clicks set it; the
  // Fabric animates from it. Nothing gates the explorer on it.
  const [deploy, setDeploy] = useState<DeployState>("idle");
  const nav = useNavStyle();

  // The stage's own light/dark switch. Sticky across visits; presentation only.
  const [stageTheme, setStageTheme] = useState<StageTheme>(() => {
    try {
      return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  const reduced = !!useReducedMotion();
  const [enabled, setEnabled] = useState<string[]>(DEFAULT_TOGGLES);
  const [sel, setSel] = useState<Selection | null>(null);
  const [tab, setTab] = useState<TabId>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);

  const surface = useMemo(() => SURFACES.find((s) => s.id === sel?.surfaceId) ?? null, [sel]);
  const action = useMemo(() => surface?.actions.find((a) => a.id === sel?.actionId) ?? null, [surface, sel]);

  // The only place a decision comes from. Recomputed when the selection changes
  // (a click) or a policy switch changes (a click) — never on a schedule.
  const run = useMemo(() => (action ? runAction(action, { enabledToggleIds: enabled, agent: sel?.agent }) : null), [action, enabled, sel?.agent]);
  const runKey = sel && run ? `${sel.actionId}:${sel.agent}:${sel.n}:${enabled.join(",")}` : "idle";

  // Drop a receipt for each distinct decision produced. A ref guards against the
  // double-invoke of StrictMode, not against time.
  //
  // receiptId is a stable hash of the action id, so re-running the SAME action
  // (a different agent, a policy switch) resolves to the same receipt. The strip
  // therefore carries one row per receipt id, refreshed to the newest decision,
  // rather than printing two different signed receipts under one id — an
  // evidence ledger that repeated an id would be lying about what it holds.
  const lastReceipt = useRef<string>("");
  useEffect(() => {
    if (!run || !action || runKey === "idle" || lastReceipt.current === runKey) return;
    lastReceipt.current = runKey;
    setReceipts((prev) =>
      [{ key: runKey, receiptId: run.receiptId, decision: run.verdict.decision, label: action.label }, ...prev.filter((r) => r.receiptId !== run.receiptId)].slice(0, 12),
    );
  }, [runKey, run, action]);

  // A review outcome is a SECOND decision event: the held request was released
  // under a permit, or refused. It gets its own record rather than overwriting
  // the REVIEW — an evidence ledger must keep both halves of the story.
  const onGateOutcome = (o: GateOutcome) => {
    if (!run || !action) return;
    setReceipts((prev) => {
      const id = `WB-${10000 + (hash32(`${runKey}|${o.kind}`) % 90000)}`;
      if (prev.some((r) => r.receiptId === id)) return prev;
      return [
        {
          key: `${runKey}:${o.kind}`,
          receiptId: id,
          decision: (o.kind === "executed" ? "ALLOW" : "BLOCK") as Decision,
          label: action.label,
          note: o.kind === "executed" ? `released under ${o.permitId} · ${o.by}` : `denied by ${o.by}`,
        },
        ...prev,
      ].slice(0, 12);
    });
  };

  const onRun = (s: Surface, a: ScenarioAction) => {
    setSel((prev) => ({ surfaceId: s.id, actionId: a.id, agent: prev?.actionId === a.id ? prev.agent : a.defaultAgent, n: (prev?.n ?? 0) + 1 }));
  };

  const anotherAgent = () => {
    if (!action || !sel) return;
    const pool = AGENT_POOLS[action.agentPool];
    const i = pool.indexOf(sel.agent);
    setSel({ ...sel, agent: pool[(i + 1 + pool.length) % pool.length], n: sel.n + 1 });
  };

  const toggle = (id: string) => setEnabled((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const reset = () => {
    setEnabled(DEFAULT_TOGGLES);
    setSel(null);
    setOpenId(null);
    setReceipts([]);
    lastReceipt.current = "";
    setDeploy("idle");
  };

  // The stage theme covers this subtree through the root pin; the product Drawer
  // portals to <body>, so the pin is extended to the root theme while the
  // playground is mounted, and the app's own setting is restored on unmount.
  const prevTheme = useRef<{ v?: string } | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    if (!prevTheme.current) prevTheme.current = { v: root.dataset.theme };
    root.dataset.theme = stageTheme;
    try {
      localStorage.setItem(THEME_KEY, stageTheme);
    } catch {
      /* storage unavailable — the switch still works for this visit */
    }
  }, [stageTheme]);
  useEffect(() => {
    return () => {
      const root = document.documentElement;
      const prev = prevTheme.current?.v;
      if (prev === undefined) delete root.dataset.theme;
      else root.dataset.theme = prev;
    };
  }, []);

  return (
    <div style={{ ...STAGE, background: GROUND[stageTheme] }} className="fixed inset-0 flex flex-col overflow-hidden">
      <style>{`.wbx-pg{grid-template-columns:1fr}@media(min-width:1100px){.wbx-pg{grid-template-columns:1fr 1.34fr 1fr}.wbx-pg>div{overflow-y:auto;min-height:0}}
@keyframes wbx-heart{0%{transform:translate(-50%,-3px);opacity:0}30%{opacity:.85}70%{opacity:.85}100%{transform:translate(-50%,17px);opacity:0}}
.wbx-heart{animation:wbx-heart 3.4s ease-in-out infinite}
.wbx-heart-2{animation-delay:1.7s}
@media(prefers-reduced-motion:reduce){.wbx-heart{animation:none;opacity:0}}`}</style>

      {/* The product's top bar — the same .wb-nav every page sits under, in whichever
          style the user chose (matte black by default, off-white if they switched). */}
      <header data-nav={nav} className="wb-nav relative flex h-[68px] shrink-0 items-center gap-3 px-4 lg:px-5 border-b border-(--n-edge)">
        <WrapboxWordmark tone={nav === "light" ? "light" : "dark"} />
        <span className="hidden md:block h-7 w-px bg-(--n-ring) mx-1" />
        <span className="hidden md:inline-flex items-center gap-2 rounded-full ring-1 ring-(--n-ring) px-3 h-8 text-[12px] text-(--n-fg-2)">
          <span className="size-1.5 rounded-full bg-(--n-fg-3)" />
          Simulated environment · live policy engine
        </span>
        <div className="ml-auto flex items-center gap-3">
          <Segmented
            size="sm"
            value={stageTheme}
            onChange={setStageTheme}
            options={[
              { value: "light", label: <Sun className="size-3.5" />, title: "Light" },
              { value: "dark", label: <Moon className="size-3.5" />, title: "Dark" },
            ]}
          />
          <span className="hidden text-[12.5px] text-(--n-fg-2) sm:inline">{ORG.name}</span>
          <button onClick={() => switchWorkspace("v2")} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-(--n-pill-bg) px-3.5 text-[12.5px] font-medium text-(--n-pill-fg) hover:opacity-90 transition-opacity">
            <LogOut className="size-3.5" /> Exit demo
          </button>
        </div>
      </header>

      {/* the three columns */}
      <div className="wbx-pg grid min-h-0 flex-1 gap-3 overflow-y-auto px-6 pb-4 pt-4 scroll-thin">
        <div className="flex flex-col gap-3 scroll-thin pr-0.5">
          <DeployCard deploy={deploy} onOnboard={() => setDeploy("onboarded")} onPush={() => setDeploy("pushed")} reduced={reduced} />
          <IntentContract enabled={enabled} onToggle={toggle} onReset={reset} reduced={reduced} />
        </div>
        <div className="flex flex-col gap-3 scroll-thin pr-0.5">
          <FabricColumn run={run} runKey={runKey} action={action} surface={surface} receipts={receipts} deploy={deploy} reduced={reduced} onAnotherAgent={anotherAgent} onGateOutcome={onGateOutcome} />
        </div>
        <div className="flex flex-col gap-3 scroll-thin pr-0.5">
          <Explorer tab={tab} setTab={setTab} openId={openId} setOpenId={setOpenId} selectedActionId={sel?.actionId ?? null} agent={sel?.agent ?? ""} onRun={onRun} reduced={reduced} />
        </div>
      </div>
    </div>
  );
}

// The route still imports LiveDemo; the playground is what it renders now.
export const LiveDemo = EnforcementPlayground;
export default EnforcementPlayground;
