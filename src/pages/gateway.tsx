import { motion } from "motion/react";
import { ArrowRight, Check, Loader2, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { agentById } from "../data/agents";
import { CodeBlock, InlineCmd } from "../components/code";
import { Button, Card, CardHead, Chip, CopyButton, DecisionPill, Drawer, Logo, PageHeader, Segmented, cn } from "../components/ui";
import type { Act } from "../lib/engine";
import { go } from "../lib/router";
import { connectAgent, evaluateNow, toast, useStore, useWorkspace } from "../lib/store";

interface Upstream {
  id: string;
  agentId: string;
  name: string;
  logo: string;
  upstream: string;
  slug: string;
  /** Each tool with a representative normalized call. The decision column is evaluated, never typed in. */
  tools: { name: string; effect: string; risk: "low" | "medium" | "high"; act: Act }[];
}

const UPSTREAMS: Upstream[] = [
  {
    id: "stripe",
    agentId: "stripe-mcp",
    name: "Stripe",
    logo: "stripe",
    upstream: "https://mcp.stripe.com",
    slug: "stripe",
    tools: [
      { name: "list_customers", effect: "payments.read", risk: "low", act: { effect: "payments.read", env: "production" } },
      { name: "list_payment_intents", effect: "payments.read", risk: "low", act: { effect: "payments.read", env: "production" } },
      { name: "create_refund", effect: "payments.refund", risk: "high", act: { effect: "payments.refund", amount: 30000, amountUsd: 300, env: "production" } },
      { name: "create_payment_link", effect: "payments.create", risk: "medium", act: { effect: "payments.create", amount: 25000, amountUsd: 250, env: "production" } },
      { name: "cancel_subscription", effect: "billing.cancel", risk: "high", act: { effect: "billing.cancel", env: "production" } },
    ],
  },
  {
    id: "razorpay",
    agentId: "razorpay-mcp",
    name: "Razorpay",
    logo: "razorpay",
    upstream: "https://mcp.razorpay.com/mcp",
    slug: "razorpay",
    tools: [
      { name: "fetch_payment", effect: "payments.read", risk: "low", act: { effect: "payments.read", env: "production" } },
      { name: "fetch_settlements", effect: "payments.read", risk: "low", act: { effect: "payments.read", env: "production" } },
      { name: "create_refund", effect: "payments.refund", risk: "high", act: { effect: "payments.refund", amount: 4000, amountUsd: 48, env: "production" } },
      { name: "create_payment_link", effect: "payments.create", risk: "medium", act: { effect: "payments.create", amount: 4000, amountUsd: 48, env: "production" } },
      { name: "create_payout", effect: "payments.payout", risk: "high", act: { effect: "payments.payout", amount: 100000, amountUsd: 1200, env: "production" } },
    ],
  },
  {
    id: "github",
    agentId: "github-mcp",
    name: "GitHub",
    logo: "github_light",
    upstream: "https://api.githubcopilot.com/mcp/",
    slug: "github",
    tools: [
      { name: "get_file_contents", effect: "git.read", risk: "low", act: { effect: "git.read", env: "production" } },
      { name: "create_issue", effect: "git.issue.create", risk: "low", act: { effect: "git.issue.create", env: "production" } },
      { name: "create_pull_request", effect: "git.pr.create", risk: "low", act: { effect: "git.pr.create", env: "production" } },
      { name: "merge_pull_request", effect: "git.merge", risk: "high", act: { effect: "git.merge", branch: "main", env: "production" } },
    ],
  },
  {
    id: "postgres",
    agentId: "postgres-mcp",
    name: "Postgres · prod",
    logo: "postgresql",
    upstream: "stdio: postgres-mcp --access-mode=unrestricted",
    slug: "postgres-prod",
    tools: [
      { name: "execute_sql · SELECT", effect: "database.read", risk: "low", act: { effect: "database.read", columns: ["count(*)"], sql: "SELECT count(*) FROM claims", env: "production" } },
      { name: "execute_sql · SELECT on PII", effect: "database.read · PII", risk: "medium", act: { effect: "database.read", columns: ["email", "phone"], sql: "SELECT email, phone FROM customers", env: "production" } },
      { name: "execute_sql · UPDATE/DELETE", effect: "database.write", risk: "high", act: { effect: "database.write", sql: "DELETE FROM claims WHERE status = 'test'", env: "production" } },
      { name: "execute_sql · DDL", effect: "database.migrate", risk: "high", act: { effect: "database.migrate", sql: "ALTER TABLE claims ADD COLUMN note text", env: "production" } },
    ],
  },
];

/** What the published contract decides for a representative call of each tool. */
function ToolTable({ tools, agentId }: { tools: Upstream["tools"]; agentId: string }) {
  const published = useStore((s) => s.published);
  useStore((s) => s.killSwitch);
  // In v2 the published rules are Control-Plane rules whose conditions are opaque to the
  // browser matcher (when: policy.*), so every representative call falls through to the
  // browser default (ALLOW). That is the inverse of what the CP does — it decides at call
  // time and fails closed on no match — so we must not render a decision the runtime never
  // made. In the simulated workspaces the local engine genuinely decides these calls.
  const cpBacked = useStore((s) => s.workspace) === "v2";
  const decide = (act: Act) => {
    const v = evaluateNow(act, agentId);
    const rule = published.find((r) => r.id === v.rule);
    const cpUnevaluable = cpBacked && (v.rule === "default" || rule?.custom === true);
    return { v, tiers: !!rule?.tiers, cpUnevaluable };
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[520px] text-left text-[12.5px]">
        <thead>
          <tr className="text-[11.5px] text-fg-3 border-b border-line bg-surface-2">
            <th className="font-medium px-4 py-2.5">Tool</th>
            <th className="font-medium px-4 py-2.5">Normalized effect</th>
            <th className="font-medium px-4 py-2.5">Risk</th>
            <th className="font-medium px-4 py-2.5">Decision</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((t, i) => {
            const { v, tiers, cpUnevaluable } = decide(t.act);
            return (
              <motion.tr key={t.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.08 }} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-mono">{t.name}</td>
                <td className="px-4 py-2.5 font-mono text-fg-2">{t.effect}</td>
                <td className="px-4 py-2.5">
                  <Chip tone={t.risk === "high" ? "block" : t.risk === "medium" ? "review" : "muted"}>{t.risk}</Chip>
                </td>
                <td className="px-4 py-2.5">
                  {cpUnevaluable ? (
                    <span className="flex max-w-[280px] flex-col items-start gap-1">
                      <Chip>Not evaluated here</Chip>
                      <span className="text-[11px] text-fg-3">Decided by the Control Plane at call time. Calls that match no active rule are blocked (fail closed).</span>
                    </span>
                  ) : tiers ? (
                    <span className="font-mono text-[11.5px] text-fg">rule {v.rule} (tiers)</span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <DecisionPill d={v.decision} size="sm" />
                      <span className="font-mono text-[11px] text-fg-3">{v.rule}</span>
                    </span>
                  )}
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AddServer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pick, setPick] = useState<Upstream>(UPSTREAMS[1]);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [discovering, setDiscovering] = useState(false);
  const [client, setClient] = useState<"claude" | "cursor" | "codex" | "vscode">("claude");
  const url = `https://mcp.wrapbox.ai/${pick.slug}`;
  const configs = {
    claude: { file: "terminal", lang: "bash" as const, code: `claude mcp add --transport http ${pick.slug} ${url} \\\n  --header "Authorization: Bearer $WRAPBOX_TOKEN"` },
    cursor: { file: ".cursor/mcp.json", lang: "json" as const, code: `{\n  "mcpServers": {\n    "${pick.slug}": {\n      "url": "${url}",\n      "headers": { "Authorization": "Bearer \${env:WRAPBOX_TOKEN}" }\n    }\n  }\n}` },
    codex: { file: "~/.codex/config.toml", lang: "toml" as const, code: `[mcp_servers.${pick.slug.replace(/-/g, "_")}]\nurl = "${url}"\nbearer_token_env_var = "WRAPBOX_TOKEN"` },
    vscode: { file: ".vscode/mcp.json", lang: "json" as const, code: `{\n  "servers": {\n    "${pick.slug}": {\n      "type": "http",\n      "url": "${url}",\n      "headers": { "Authorization": "Bearer \${input:wrapbox-token}" }\n    }\n  }\n}` },
  }[client];

  return (
    <Drawer open={open} onClose={onClose} width={640} title="Wrap an MCP server">
      <div className="p-5 space-y-5">
        <ol className="flex items-center gap-2 text-[12px]">
          {["Choose server", "Discover tools", "Point clients at Wrapbox"].map((l, i) => (
            <li key={l} className={cn("flex items-center gap-1.5", i <= step ? "text-fg font-medium" : "text-fg-3")}>
              <span className={cn("grid size-5 place-items-center rounded-full text-[10.5px]", i < step ? "bg-allow text-white" : i === step ? "bg-ink text-ink-fg" : "border border-line")}>{i < step ? <Check className="size-3" /> : i + 1}</span>
              {l}
              {i < 2 && <ArrowRight className="size-3 text-fg-3" />}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {UPSTREAMS.map((u) => (
                <button key={u.id} onClick={() => setPick(u)} className={cn("flex flex-col items-center gap-2 rounded-xl border p-3", pick.id === u.id ? "border-fg ring-1 ring-fg" : "border-line hover:border-line-strong")}>
                  <Logo name={u.logo} size={32} />
                  <span className="text-[12.5px] font-medium">{u.name}</span>
                </button>
              ))}
            </div>
            <label className="block">
              <span className="text-[12px] font-medium">Upstream MCP server</span>
              <input readOnly value={pick.upstream} className="mt-1 w-full h-9 rounded-lg border border-line bg-surface-2 px-3 font-mono text-[12.5px] outline-none" />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium">Upstream credential</span>
              <input readOnly value={`vault://payments/${pick.slug}-restricted-key`} className="mt-1 w-full h-9 rounded-lg border border-line bg-surface-2 px-3 font-mono text-[12.5px] outline-none" />
              <span className="mt-1 block text-[11.5px] text-fg-3">Stored in your vault. Agents never see it — they only ever hold a Wrapbox token.</span>
            </label>
            <Button
              variant="primary"
              onClick={() => {
                setDiscovering(true);
                setTimeout(() => {
                  setDiscovering(false);
                  setStep(1);
                }, 1100);
              }}
              disabled={discovering}
            >
              {discovering ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {discovering ? "Calling tools/list…" : "Discover tools"}
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-[13px] text-fg-2">
              Wrapbox called <span className="font-mono">tools/list</span> on {pick.name} and classified each tool into the normalized action model. Refund tools inherit your existing <span className="font-mono">payments.refund</span> tiers automatically.
            </p>
            <ToolTable tools={pick.tools} agentId={pick.agentId} />
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button variant="primary" onClick={() => setStep(2)}>
                Create wrapped endpoint
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <div className="text-[12px] font-medium mb-1.5">Your wrapped endpoint</div>
              <div className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft/40 px-3 h-10">
                <ShieldCheck className="size-4 text-accent" />
                <code className="flex-1 font-mono text-[12.5px] truncate">{url}</code>
                <CopyButton text={url} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[12px] font-medium">Paste into any MCP client</span>
                <Segmented
                  size="sm"
                  value={client}
                  onChange={setClient}
                  options={[
                    { value: "claude", label: "Claude Code" },
                    { value: "cursor", label: "Cursor" },
                    { value: "codex", label: "Codex" },
                    { value: "vscode", label: "VS Code" },
                  ]}
                />
              </div>
              <CodeBlock file={configs.file} lang={configs.lang} code={configs.code} />
            </div>
            <Button
              variant="primary"
              onClick={() => {
                connectAgent(pick.agentId, "gateway", "gateway-enforced");
                toast(`${pick.name} is behind Wrapbox`, `${pick.tools.length} tools governed · ${url.replace("https://", "")}`, "allow");
                onClose();
                setStep(0);
              }}
            >
              Finish
            </Button>
          </div>
        )}
      </div>
    </Drawer>
  );
}

export function Gateway() {
  const connected = useStore((s) => s.connected);
  const events = useStore((s) => s.events);
  const { labs, fabric } = useWorkspace();
  // v2 is the live Control-Plane-backed workspace. The hosted MCP gateway and credential
  // broker are genuinely simulated in the `fabric` reference workspace but are not built in
  // v2 (this dashboard only reads from the CP), so gateway-enforcement copy must not claim
  // them there. Both workspaces have fabric: true, so gate on the workspace id itself.
  const cpBacked = useStore((s) => s.workspace) === "v2";
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const callsOf = (u: Upstream) => events.filter((e) => e.agentId === u.agentId && e.ts >= dayStart).length;
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Upstream>(UPSTREAMS[0]);
  return (
    <div className="mx-auto max-w-[1280px] px-4 lg:px-8 py-8">
      <PageHeader
        eyebrow={fabric ? (cpBacked ? "MCP gateway · planned" : "Installed once per network · gateway-enforced") : "MCP tools & servers · gateway-enforced"}
        title={fabric ? "Gateway" : "MCP gateway"}
        sub={fabric ? (cpBacked ? "Planned: one front door for every MCP server and API your agents reach. Not built in this release — no MCP server is proxied today and no credential is brokered. The network control that exists in this build is the local proxy on 127.0.0.1:4180, which covers processes launched through wrapboxd." : "One front door for every MCP server and API your agents reach. Clients use the Wrapbox URL instead of the real one; approved calls are forwarded with a brokered credential, everything else never reaches the upstream.") : "Wrap any MCP server — including your payment gateways — behind one policy. Clients use the Wrapbox URL instead of the real one; approved calls are forwarded, everything else never reaches the upstream."}
        right={
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" /> Wrap a server
          </Button>
        }
      />

      <Card className="p-5 mb-4">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto_1fr_auto_1fr] items-center">
          <div>
            <div className="eyebrow mb-2">Any MCP client</div>
            <div className="flex -space-x-1.5">
              {["claudecode", "cursor", "codex", "githubcopilot", "langgraph", "geminicli"].map((l) => (
                <Logo key={l} name={l} size={30} rounded="rounded-full" className="ring-2 ring-surface" />
              ))}
            </div>
          </div>
          <ArrowRight className="hidden lg:block size-4 text-fg-3" />
          <div className="rounded-xl p-[1px] brand-grad">
            <div className="rounded-[11px] bg-surface p-3.5">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <ShieldCheck className="size-4 text-accent" /> mcp.wrapbox.ai
              </div>
              <div className="mt-1 font-mono text-[11px] text-fg-3">tools/call → normalize → policy → permit → forward</div>
            </div>
          </div>
          <ArrowRight className="hidden lg:block size-4 text-fg-3" />
          <div>
            <div className="eyebrow mb-2">Real upstream servers</div>
            <div className="flex gap-1.5">
              {UPSTREAMS.map((u) => (
                <Logo key={u.id} name={u.logo} size={30} className={cn(!connected[u.agentId] && "opacity-35 grayscale")} />
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden min-w-0">
          <CardHead title="Wrapped servers" sub="Click one to see how its tools are governed." />
          <div className="border-t border-line">
            {UPSTREAMS.map((u) => {
              const on = !!connected[u.agentId];
              return (
                <button key={u.id} onClick={() => setSel(u)} className={cn("flex w-full items-center gap-3 px-6 py-4 border-b border-line last:border-0 text-left transition-colors", sel.id === u.id ? "bg-surface-2" : "hover:bg-surface-2")}>
                  <Logo name={u.logo} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold">{u.name}</span>
                      {on ? <Chip tone="allow">live</Chip> : <Chip>not wrapped</Chip>}
                    </div>
                    <div className="font-mono text-[11.5px] text-fg-3 truncate">{on ? `mcp.wrapbox.ai/${u.slug}` : u.upstream}</div>
                  </div>
                  <div className="text-right hidden sm:block">
                    <div className="font-mono text-[12.5px] tnum">{on ? callsOf(u).toLocaleString() : "—"}</div>
                    <div className="text-[11px] text-fg-3">calls today</div>
                  </div>
                  <div className="text-right w-[54px]">
                    <div className="font-mono text-[12.5px] tnum">{u.tools.length}</div>
                    <div className="text-[11px] text-fg-3">tools</div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
        <Card className="min-w-0">
          <CardHead
            title={
              <span className="flex items-center gap-2">
                <Logo name={sel.logo} size={20} rounded="rounded-md" /> {sel.name} tools
              </span>
            }
            sub={connected[sel.agentId] ? "Live policy for every client that uses the wrapped URL" : "Not wrapped yet"}
            right={
              connected[sel.agentId] ? (
                <Button size="sm" onClick={() => go(labs ? `/flows/${agentById(sel.agentId).scenario}?agent=${sel.agentId}` : fabric ? `/evidence?agent=${sel.agentId}` : `/agents/${sel.agentId}?tab=activity`)}>
                  {labs ? "Happy flow" : "Activity"} <ArrowRight className="size-3" />
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
                  Wrap it
                </Button>
              )
            }
          />
          <div className="px-5 pb-5 space-y-4">
            <ToolTable tools={sel.tools} agentId={sel.agentId} />
            <div>
              <div className="text-[12px] font-medium mb-1.5">Or add it from the CLI</div>
              <InlineCmd cmd={agentById(sel.agentId).install} />
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <div className="text-[13.5px] font-semibold">Why a payment call through the gateway is safe</div>
        <div className="mt-3 grid gap-3 md:grid-cols-3 text-[12.5px] text-fg-2">
          <div className="rounded-xl border border-line p-3.5">
            <div className="font-semibold text-fg mb-1">1 · Agents never hold the key</div>
            The Stripe or Razorpay key lives in your vault. Agents only carry a Wrapbox token scoped to their identity.
          </div>
          <div className="rounded-xl border border-line p-3.5">
            <div className="font-semibold text-fg mb-1">2 · One refund rule, any currency</div>
            <span className="font-mono">payments.refund</span> tiers apply to Stripe USD and Razorpay INR alike — normalized before evaluation.
          </div>
          <div className="rounded-xl border border-line p-3.5">
            <div className="font-semibold text-fg mb-1">3 · Optional: resource-verified</div>
            Your payment service can also verify the permit itself, so even a direct call without the gateway can't move money.
          </div>
        </div>
      </Card>
      <AddServer open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
