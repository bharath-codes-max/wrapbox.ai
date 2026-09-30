import { ArrowRight, Compass, Eye, Lock, ShieldCheck, UserCog, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { AGENTS, ASSURANCE, CATEGORIES, agentsIn, productOf, type Assurance } from "../data/agents";
import { toYaml, INITIAL_RULES } from "../data/contract";
import { CodeBlock } from "../components/code";
import { PermitTicket } from "../components/permit";
import { DecisionStream } from "../components/stream";
import { Button, Card, Chip, DecisionPill, Logo, Segmented, cn } from "../components/ui";
import { mintPermit, type Permit } from "../lib/permit";
import { go } from "../lib/router";
import { setState, useStore, useWorkspace } from "../lib/store";

function useHeroPermit() {
  const [p, setP] = useState<Permit | null>(null);
  useEffect(() => {
    let alive = true;
    const mint = () =>
      mintPermit({
        decision_id: "d-4f81a2",
        subject_agent: "claims-agent-prod",
        on_behalf_of: "anjali.v (claims intake)",
        action: "claims.payout",
        resource: "claim CLM-4821 · ₹3,00,000",
        environment: "production",
        approved_by: ["meera.i", "rohan.d"],
        args: { claim_id: "CLM-4821", amount: 300000, currency: "INR", payee: "Apollo Hospitals" },
      }).then((x) => alive && setP(x));
    mint();
    const t = setInterval(mint, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return p;
}

const RESOURCES = [
  { logo: "github_light", label: "GitHub" },
  { logo: "postgresql", label: "Postgres" },
  { logo: "aws", label: "AWS" },
  { logo: "kubernetes", label: "Kubernetes" },
  { logo: "stripe", label: "Stripe" },
  { logo: "razorpay", label: "Razorpay" },
  { logo: "slack", label: "Slack" },
  { logo: "salesforce", label: "CRM" },
];

const HERO_AGENTS = ["claudecode", "cursor", "codex", "githubcopilot", "geminicli", "langgraph", "salesforce", "browseruse"];

export function Welcome() {
  const permit = useHeroPermit();
  const events = useStore((s) => s.events);
  const { labs } = useWorkspace();
  const [tab, setTab] = useState<"claude" | "cursor" | "sdk" | "mcp">("claude");
  const snippet = {
    claude: AGENTS.find((a) => a.id === "claude-code")!,
    cursor: AGENTS.find((a) => a.id === "cursor")!,
    sdk: AGENTS.find((a) => a.id === "langgraph")!,
    mcp: AGENTS.find((a) => a.id === "stripe-mcp")!,
  }[tab];

  return (
    <div className="mx-auto max-w-[1240px] px-4 lg:px-8 pt-8 pb-16">
      {/* Hero */}
      <section className="grid gap-8 lg:grid-cols-[1.08fr_0.92fr] items-start">
        <div className="pt-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface pl-1 pr-3 py-1 text-[12px] text-fg-2">
            <span className="rounded-full brand-grad px-2 py-0.5 text-[10.5px] font-semibold text-white">Pre-seed</span>
            Runtime authorization for AI agents
          </div>
          <h1 className="mt-5 text-[44px] sm:text-[58px] leading-[0.98] font-semibold tracking-[-0.045em]">
            No sensitive effect
            <br />
            without a <span className="brand-text">permit.</span>
          </h1>
          <p className="mt-5 max-w-[56ch] text-[15.5px] leading-relaxed text-fg-2">
            Wrapbox checks every security-sensitive action an agent takes immediately before it runs — and answers <DecisionPill d="ALLOW" size="sm" />{" "}
            <DecisionPill d="CONSTRAIN" size="sm" /> <DecisionPill d="REVIEW" size="sm" /> or <DecisionPill d="BLOCK" size="sm" />. CONSTRAIN runs a safer variant — PII masked, a force-push made safe. Approved actions get a short-lived, signed permit bound to the exact arguments. Change the
            amount, or wait 61 seconds, and it no longer works.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="primary" size="lg" onClick={() => setState({ tour: 0 })}>
              <Compass className="size-4" /> Start guided tour
            </Button>
            <Button size="lg" onClick={() => go(labs ? "/flows/cli" : "/approvals")}>
              {labs ? "Watch a happy flow" : "Open the approval studio"} <ArrowRight className="size-4" />
            </Button>
          </div>
          <div className="mt-7 flex items-center gap-3">
            <div className="flex -space-x-1.5">
              {HERO_AGENTS.map((l) => (
                <Logo key={l} name={l} size={28} bleed={l === "browseruse"} rounded="rounded-full" className="ring-2 ring-bg" />
              ))}
            </div>
            <span className="text-[12.5px] text-fg-3">{CATEGORIES.length} agent platforms · {AGENTS.length} agents · one contract</span>
          </div>
        </div>
        <div className="space-y-3">
          {permit && <PermitTicket permit={permit} />}
          <p className="text-[12px] text-fg-3 px-1 leading-relaxed">
            A real ECDSA signature, minted in your browser just now. The payment service verifies it before it pays — and a new one is minted every 60 seconds.
          </p>
        </div>
      </section>

      {/* Three layers */}
      <section className="mt-16">
        <div className="eyebrow">The mental model</div>
        <h2 className="mt-2 text-[28px] font-semibold">Three questions, every time.</h2>
        <p className="mt-2 text-fg-2 max-w-[62ch]">
          Wrapbox doesn't govern AWS, GitHub or Stripe. It governs an agent <i>attempting</i> an AWS, GitHub or Stripe action — before that action executes.
        </p>
        <div className="mt-6 grid gap-3 lg:grid-cols-[1fr_1.15fr_1fr] items-stretch">
          <Card className="p-6">
            <div className="eyebrow">1 · What is the agent?</div>
            <div className="mt-1 text-[13px] text-fg-2">Where the decision is made.</div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {HERO_AGENTS.map((l) => (
                <Logo key={l} name={l} size={40} bleed={l === "browseruse"} rounded="rounded-xl" />
              ))}
            </div>
          </Card>
          <div className="relative rounded-2xl p-[1px] brand-grad">
            <div className="h-full rounded-[15px] bg-surface p-5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-accent" />
                <div className="eyebrow">2 · Where can we intercept?</div>
              </div>
              <div className="mt-1 text-[13px] text-fg-2">Hook, SDK, MCP gateway, connector, executor or A2A gateway.</div>
              <div className="mt-4 flex flex-wrap items-center gap-1.5 font-mono text-[11.5px]">
                {["normalize", "identity + delegation", "policy"].map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className="rounded-md border border-line bg-surface-2 px-2 py-1">{s}</span>
                    <ArrowRight className="size-3 text-fg-3" />
                  </span>
                ))}
                <DecisionPill d="ALLOW" size="sm" />
                <DecisionPill d="CONSTRAIN" size="sm" />
                <DecisionPill d="REVIEW" size="sm" />
                <DecisionPill d="BLOCK" size="sm" />
                <ArrowRight className="size-3 text-fg-3" />
                <span className="rounded-md border border-accent/40 bg-accent-soft text-accent px-2 py-1">signed permit</span>
                <ArrowRight className="size-3 text-fg-3" />
                <span className="rounded-md border border-line bg-surface-2 px-2 py-1">evidence</span>
              </div>
              <div className="relative mt-5 h-6 overflow-hidden rounded-full bg-surface-2">
                {[0, 0.9, 1.7].map((d) => (
                  <span key={d} className="packet absolute top-1.5 left-0 size-3 rounded-full brand-grad" style={{ animationDelay: `${d}s` }} />
                ))}
              </div>
            </div>
          </div>
          <Card className="p-6">
            <div className="eyebrow">3 · What is it touching?</div>
            <div className="mt-1 text-[13px] text-fg-2">Where the effect lands.</div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {RESOURCES.map((r) => (
                <div key={r.label} className="flex flex-col items-center gap-1">
                  <Logo name={r.logo} size={40} rounded="rounded-xl" />
                  <span className="text-[10.5px] text-fg-3">{r.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-1 font-mono text-[11px]">
              {[".env", "shell", "browser form", "subagent"].map((x) => (
                <Chip key={x}>{x}</Chip>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* 8 categories */}
      <section className="mt-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Canonical market map</div>
            <h2 className="mt-2 text-[28px] font-semibold">Every agent surface. One permit.</h2>
          </div>
          <Button onClick={() => go("/agents")}>
            See all {AGENTS.length} agents <ArrowRight className="size-3.5" />
          </Button>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {CATEGORIES.map((c) => (
            <a key={c.id} href={labs ? `#/flows/${c.scenario}` : `#/agents?c=${c.id}`} className="group flex flex-col rounded-2xl border border-line bg-surface p-4 hover:border-line-strong hover:shadow-card transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-fg-3 truncate">{productOf(c.id).name}</span>
                <Chip tone={c.timing === "NOW" ? "allow" : c.timing === "NEXT" ? "accent" : "muted"}>{c.timing}</Chip>
              </div>
              <div className="mt-2 text-[15px] font-semibold tracking-tight">{c.name}</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2 flex-1">{c.plain}</p>
              <div className="mt-3 flex -space-x-1">
                {agentsIn(c.id).map((a) => (
                  <Logo key={a.id} name={a.logo} bleed={a.bleed} size={24} rounded="rounded-full" className="ring-2 ring-surface" />
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[12px]">
                <span className="text-fg-3 truncate">{c.method}</span>
                <span className="inline-flex items-center gap-1 font-medium text-accent group-hover:gap-1.5 transition-all shrink-0">
                  {labs ? "Happy flow" : "Agents"} <ArrowRight className="size-3" />
                </span>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mt-16">
        <div className="eyebrow">How it works</div>
        <h2 className="mt-2 text-[28px] font-semibold">One intent contract. Every agent reads it.</h2>
        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          <div>
            <Step n={1} title="Write the contract" body="Plain rules about effects and resources — not about any one tool. Committed to the repo or set org-wide." />
            <CodeBlock file="wrapbox.yaml" lang="yaml" code={toYaml(INITIAL_RULES, 14).split("\n").slice(6, 30).join("\n")} maxH={300} />
          </div>
          <div>
            <Step n={2} title="Connect an agent" body="Each platform already exposes a pre-execution hook or a place to wrap tool calls. Wrapbox plugs into the one it has." />
            <Segmented
              size="sm"
              className="mb-2"
              value={tab}
              onChange={setTab}
              options={[
                { value: "claude", label: "Claude Code" },
                { value: "cursor", label: "Cursor" },
                { value: "sdk", label: "SDK" },
                { value: "mcp", label: "MCP" },
              ]}
            />
            <CodeBlock file={snippet.file} lang={snippet.lang} code={snippet.snippet} maxH={262} />
          </div>
          <div>
            <Step n={3} title="Every action becomes a decision" body="The hook sends the exact action. Wrapbox matches a rule and answers in the agent's own format." />
            <Card className="overflow-hidden">
              <DecisionStream events={events} limit={6} compact />
            </Card>
          </div>
        </div>
      </section>

      {/* Roles */}
      <section className="mt-16 grid gap-5 lg:grid-cols-2">
        <RoleCard
          icon={<UserCog className="size-4" />}
          title="Admin / founder view"
          who="Priya Menon · Founder & CEO"
          items={["Connect agents and choose enforcement per platform", "Write and publish the intent contract", "See every agent's actions across the org", "Approve anything, run the org kill switch", "Manage team access, MCP gateway and evidence export"]}
          onClick={() => {
            setState({ role: "admin" });
            go("/");
          }}
        />
        <RoleCard
          icon={<UserRound className="size-4" />}
          title="Employee view"
          who="Dev Kapoor · Platform engineer, on-call SRE"
          items={["One command installs Wrapbox on their laptop", "See their own agents' actions and why something was blocked", "Read the rules that apply to them — no editing", "Approve only what they're on the hook for (on-call)", "Request access to a new agent"]}
          onClick={() => {
            setState({ role: "employee" });
            go("/");
          }}
        />
      </section>

      {/* Assurance */}
      <section className="mt-16">
        <Card className="p-6">
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <div className="eyebrow">Honest assurance levels</div>
              <h3 className="mt-2 text-[22px] font-semibold">Hooks are adapters. The permit is the boundary.</h3>
              <p className="mt-2 text-[13.5px] text-fg-2 leading-relaxed">
                Every integration is labelled by what it can actually guarantee. An HTTP hook that times out doesn't block in Claude Code, and Cursor hooks fail open unless{" "}
                <code className="font-mono text-[12px]">failClosed</code> is set — so for high-risk effects the executor itself verifies the permit.
              </p>
            </div>
            <ol className="grid gap-2">
              {(Object.keys(ASSURANCE) as Assurance[]).map((a) => (
                <li key={a} className="flex items-start gap-3 rounded-xl border border-line px-3.5 py-2.5">
                  <span className="flex gap-[2px] mt-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <span key={i} className={cn("h-3 w-[3px] rounded-full", i <= ASSURANCE[a].rank ? "bg-accent" : "bg-line-strong")} />
                    ))}
                  </span>
                  <div>
                    <div className="text-[13px] font-semibold">{ASSURANCE[a].label}</div>
                    <div className="text-[12px] text-fg-3">{ASSURANCE[a].desc}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Card>
        <p className="mt-4 flex items-center gap-2 text-[12px] text-fg-3">
          <Eye className="size-3.5" /> Preview build. Config formats follow each vendor's published documentation; permits are signed and verified in your browser with real ECDSA keys.
          <Lock className="size-3.5 ml-1" />
        </p>
      </section>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="mb-3 flex gap-3">
      <span className="grid size-6 place-items-center rounded-full bg-ink text-ink-fg text-[12px] font-semibold shrink-0">{n}</span>
      <div>
        <div className="text-[14px] font-semibold">{title}</div>
        <p className="text-[12.5px] text-fg-2 leading-relaxed mt-0.5">{body}</p>
      </div>
    </div>
  );
}

function RoleCard({ icon, title, who, items, onClick }: { icon: React.ReactNode; title: string; who: string; items: string[]; onClick: () => void }) {
  return (
    <Card className="p-5 flex flex-col">
      <div className="flex items-center gap-2 text-fg-2">{icon}<span className="eyebrow">{title}</span></div>
      <div className="mt-2 text-[15px] font-semibold">{who}</div>
      <ul className="mt-3 space-y-1.5 flex-1">
        {items.map((i) => (
          <li key={i} className="flex gap-2 text-[13px] text-fg-2">
            <span className="mt-[7px] size-1 rounded-full bg-fg-3 shrink-0" />
            {i}
          </li>
        ))}
      </ul>
      <Button className="mt-4 self-start" onClick={onClick}>
        Open this view <ArrowRight className="size-3.5" />
      </Button>
    </Card>
  );
}
