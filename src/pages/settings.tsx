import { Compass, LogOut, Moon, Plug, ShieldCheck, Sparkles, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, PageHeader, cn } from "../components/ui";
import { setNavStyle, useNavStyle, type NavStyle } from "../lib/navstyle";
import { signOut, useAccount } from "../lib/auth";
import { go } from "../lib/router";
import { setState, setTheme, tourFor, useStore } from "../lib/store";
import { aiPreferred, aiStatus, setAiPreferred } from "../lib/draft";
import { clearCpConfig, setCpConfig, useCpConfig } from "../lib/cp-config";
import { listOrgs, ping, type CpOrg } from "../lib/cp-api";
import { useCpStatus, type CpStatus } from "../lib/cp-sync";

/** OpenAI drafting status. The key lives in a server environment variable — this screen never holds it. */
function AiDrafting() {
  const [status, setStatus] = useState<{ configured: boolean; model: string | null } | null>(null);
  const [on, setOn] = useState(aiPreferred());
  useEffect(() => {
    aiStatus(true).then(setStatus);
  }, []);
  return (
    <>
      <Row
        title="Draft rules with OpenAI"
        sub="On the Intent contract page you can describe a rule in plain English. With a key configured on the server, OpenAI drafts the rule; without one, the built-in parser does. Either way a person reviews it in the builder before it can be published, and no model ever makes a live allow or block decision."
      >
        <div className="flex items-center gap-3">
          {status === null ? (
            <span className="text-[12.5px] text-fg-3">checking…</span>
          ) : status.configured ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-allow-soft px-2.5 py-1 text-[12px] font-semibold text-allow">
              <ShieldCheck className="size-3.5" /> Configured · {status.model}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-semibold text-fg-2">
              <Sparkles className="size-3.5" /> Not configured
            </span>
          )}
          <button
            role="switch"
            aria-checked={on}
            aria-label="Prefer OpenAI drafting"
            onClick={() => {
              setAiPreferred(!on);
              setOn(!on);
            }}
            className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", on ? "bg-allow" : "bg-line-strong")}
          >
            <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
          </button>
        </div>
      </Row>
      <div className="border-t border-line px-6 py-4 text-[12.5px] text-fg-2">
        <div className="font-semibold">How to turn it on</div>
        <ol className="mt-1.5 space-y-1 text-fg-3">
          <li>1. In Vercel → your project → Settings → Environment Variables, add <code className="font-mono text-[11.5px] text-fg-2">OPENAI_API_KEY</code>. Optionally add <code className="font-mono text-[11.5px] text-fg-2">OPENAI_MODEL</code>.</li>
          <li>2. Redeploy. The key is read only by the server function at <code className="font-mono text-[11.5px] text-fg-2">/api/draft-rule</code>.</li>
          <li>3. It is never sent to the browser, never bundled into the page, never written into a rule, a log or wrapbox.yaml.</li>
        </ol>
        <div className="mt-2 text-fg-3">Never paste a key into this page, a chat, or a repository. If a key has been shared anywhere, revoke it and issue a new one.</div>
      </div>
    </>
  );
}

function Row({ title, sub, children, last }: { title: string; sub: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-4 px-6 py-5", !last && "border-b border-line")}>
      <div className="min-w-[240px] flex-1">
        <div className="text-[14px] font-semibold">{title}</div>
        <p className="mt-0.5 text-[12.5px] text-fg-3 leading-relaxed max-w-[52ch]">{sub}</p>
      </div>
      {children}
    </div>
  );
}

/** A small picture of the top bar in each style. */
function BarPreview({ style, active, onClick }: { style: NavStyle; active: boolean; onClick: () => void }) {
  const black = style === "black";
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn("group w-[168px] rounded-xl border p-1.5 text-left transition-all", active ? "border-fg shadow-card" : "border-line hover:border-line-strong")}
    >
      <span className={cn("flex h-9 items-center gap-1.5 rounded-lg px-2.5", black ? "bg-[linear-gradient(180deg,#161618,#0d0d0f)]" : "bg-[#fafaf8] ring-1 ring-black/10")}>
        <span className={cn("size-3.5 rounded-[4px] border-[1.5px]", black ? "border-[#9db6ff]" : "border-[#1848ff]")} />
        <span className={cn("h-1.5 w-9 rounded-full", black ? "bg-white/85" : "bg-[#111c35]/85")} />
        <span className={cn("ml-auto h-4 w-10 rounded-md", black ? "bg-white/10" : "bg-black/[0.06]")} />
      </span>
      <span className="mt-1.5 flex items-center justify-between px-1 text-[12px] font-medium">
        {black ? "Matte black" : "Off-white"}
        <span className={cn("grid size-3.5 place-items-center rounded-full border", active ? "border-fg bg-fg" : "border-line-strong")}>{active && <span className="size-1.5 rounded-full bg-surface" />}</span>
      </span>
    </button>
  );
}

const STATUS_LABEL: Record<CpStatus, { text: string; tone: "allow" | "review" | "block" | "muted" }> = {
  connected: { text: "Connected", tone: "allow" },
  connecting: { text: "Connecting…", tone: "review" },
  unconfigured: { text: "Not configured", tone: "muted" },
  unreachable: { text: "Unreachable", tone: "review" },
  unauthorized: { text: "Unauthorized", tone: "block" },
};

function StatusPill({ status }: { status: CpStatus }) {
  const s = STATUS_LABEL[status];
  const cls =
    s.tone === "allow" ? "bg-allow-soft text-allow" :
    s.tone === "review" ? "bg-review-soft text-review" :
    s.tone === "block" ? "bg-block-soft text-block" :
    "bg-surface-2 text-fg-2";
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold", cls)}>{s.text}</span>;
}

function ControlPlaneCard() {
  const cfg = useCpConfig();
  const status = useCpStatus();
  const [server, setServer] = useState(cfg.server);
  const [key, setKey] = useState(cfg.adminKey);
  const [orgId, setOrgId] = useState(cfg.orgId);
  const [orgs, setOrgs] = useState<CpOrg[] | null>(null);
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [testMsg, setTestMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => { setServer(cfg.server); }, [cfg.server]);
  useEffect(() => { setKey(cfg.adminKey); }, [cfg.adminKey]);
  useEffect(() => { setOrgId(cfg.orgId); }, [cfg.orgId]);

  async function loadOrgs() {
    setLoadingOrgs(true);
    setTestMsg(null);
    // Save the entered values first so the api client sees them.
    setCpConfig({ server: server.trim(), adminKey: key, orgId });
    const r = await listOrgs();
    setLoadingOrgs(false);
    if (!r.ok) { setTestMsg({ tone: "err", text: r.error || `HTTP ${r.status}` }); return; }
    setOrgs(r.data);
    if (!orgId && r.data.length === 1) { setOrgId(r.data[0].id); setCpConfig({ orgId: r.data[0].id }); }
  }

  async function testConnection() {
    setTesting(true);
    setTestMsg(null);
    setCpConfig({ server: server.trim(), adminKey: key, orgId });
    const h = await ping(server.trim());
    if (!h.ok) { setTesting(false); setTestMsg({ tone: "err", text: `Health check failed — ${h.error}` }); return; }
    const o = await listOrgs();
    setTesting(false);
    if (!o.ok) { setTestMsg({ tone: "err", text: `Auth check failed — ${o.error}` }); return; }
    setOrgs(o.data);
    setTestMsg({ tone: "ok", text: `Reached the Control Plane · ${o.data.length} org${o.data.length === 1 ? "" : "s"} visible.` });
  }

  function save() {
    setCpConfig({ server: server.trim(), adminKey: key, orgId });
  }

  function disconnect() {
    clearCpConfig();
    setServer(""); setKey(""); setOrgId(""); setOrgs(null); setTestMsg(null);
  }

  return (
    <>
      <Row title="Connection" sub="Wrapbox v2 pulls its fleet, rules, agents and receipts from the live Control Plane you point it at. The admin key is stored only in this browser, and never sent to any URL you did not type here.">
        <StatusPill status={status} />
      </Row>
      <div className="border-t border-line px-6 py-5 space-y-3">
        <label className="block">
          <div className="text-[12.5px] font-medium mb-1">Server URL</div>
          <input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            onBlur={save}
            placeholder="http://localhost:4231"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-mono outline-none focus:border-line-strong"
          />
        </label>
        <label className="block">
          <div className="text-[12.5px] font-medium mb-1">Admin key</div>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onBlur={save}
            placeholder="X-Admin-Key value from the Control Plane env"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-mono outline-none focus:border-line-strong"
          />
        </label>
        <label className="block">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[12.5px] font-medium">Org id</div>
            <button
              type="button"
              onClick={loadOrgs}
              disabled={!server.trim() || !key || loadingOrgs}
              className="text-[11.5px] text-fg-2 hover:text-fg disabled:opacity-40"
            >
              {loadingOrgs ? "Loading…" : "Load orgs"}
            </button>
          </div>
          {orgs && orgs.length > 0 ? (
            <select
              value={orgId}
              onChange={(e) => { setOrgId(e.target.value); setCpConfig({ orgId: e.target.value }); }}
              onBlur={save}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-line-strong"
            >
              <option value="">Select an org…</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name} · {o.id}</option>
              ))}
            </select>
          ) : (
            <input
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              onBlur={save}
              placeholder="org id from the Control Plane"
              spellCheck={false}
              autoComplete="off"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-mono outline-none focus:border-line-strong"
            />
          )}
        </label>
        {testMsg && (
          <div className={cn("text-[12.5px]", testMsg.tone === "ok" ? "text-allow" : "text-block")}>
            {testMsg.text}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="primary" onClick={testConnection} disabled={!server.trim() || !key || testing}>
            <Plug className="size-3.5" /> {testing ? "Testing…" : "Test connection"}
          </Button>
          <Button onClick={disconnect}>Disconnect</Button>
        </div>
        <p className="text-[11.5px] text-fg-3 leading-relaxed pt-1">
          The Control Plane runs at <code className="font-mono text-fg-2">PORT=4231 npm run dev</code> in the <code className="font-mono text-fg-2">control-plane/</code> workspace, and mints its own admin key on startup (printed to its logs). Every call from this page carries <code className="font-mono text-fg-2">X-Admin-Key</code>. The key never leaves the browser and is not written into rules, YAML or receipts.
        </p>
      </div>
    </>
  );
}

export function SettingsPage() {
  const theme = useStore((s) => s.theme);
  const workspace = useStore((s) => s.workspace);
  const role = useStore((s) => s.role);
  const hasTour = tourFor(workspace).length > 0;
  const nav = useNavStyle();
  const account = useAccount();
  return (
    <div className="mx-auto max-w-[880px] px-4 lg:px-8 py-8">
      <PageHeader eyebrow="Workspace" title="Settings" sub="How Wrapbox looks on this browser, and a guided walk-through whenever you want one." />

      <div className="eyebrow mb-2 px-1">Appearance</div>
      <Card className="overflow-hidden">
        <Row title="Theme" sub="Light is an off-white page; dark is easier on the eyes at night.">
          <div className="inline-flex rounded-xl border border-line bg-surface-2 p-1" role="radiogroup" aria-label="Theme">
            {(
              [
                { v: "light", label: "Light", icon: Sun },
                { v: "dark", label: "Dark", icon: Moon },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                role="radio"
                aria-checked={theme === o.v}
                onClick={() => setTheme(o.v)}
                className={cn("inline-flex items-center gap-2 rounded-lg h-9 px-4 text-[13px] font-medium transition-colors", theme === o.v ? "bg-surface text-fg shadow-card border border-line" : "text-fg-3 hover:text-fg-2")}
              >
                <o.icon className="size-4" /> {o.label}
              </button>
            ))}
          </div>
        </Row>
        <Row title="Top bar" sub="Matte black stands apart from the page; off-white blends into it." last>
          <div className="flex gap-2.5">
            <BarPreview style="black" active={nav === "black"} onClick={() => setNavStyle("black")} />
            <BarPreview style="light" active={nav === "light"} onClick={() => setNavStyle("light")} />
          </div>
        </Row>
      </Card>

      {workspace === "v2" && role === "admin" && (
        <>
          <div className="eyebrow mt-7 mb-2 px-1">Control Plane</div>
          <Card className="overflow-hidden">
            <ControlPlaneCard />
          </Card>
        </>
      )}

      <div className="eyebrow mt-7 mb-2 px-1">Rule drafting</div>
      <Card className="overflow-hidden">
        <AiDrafting />
      </Card>

      <div className="eyebrow mt-7 mb-2 px-1">Account</div>
      <Card className="overflow-hidden">
        <Row title={account?.name ?? account?.email ?? "Signed in"} sub={`Signed in as ${account?.email ?? "—"}${account?.company ? ` · ${account.company}` : ""}. Signing out returns you to the sign-in page.`} last>
          <Button
            onClick={() => {
              signOut();
              go("/login");
            }}
          >
            <LogOut className="size-4" /> Sign out
          </Button>
        </Row>
      </Card>

      {hasTour && (
        <>
          <div className="eyebrow mt-7 mb-2 px-1">Help</div>
          <Card className="overflow-hidden">
            <Row title="Guided tour" sub="Walks you through each page step by step: agents, the intent contract, approvals and evidence." last>
              <Button variant="primary" onClick={() => setState({ tour: 0 })}>
                <Compass className="size-4" /> Start the tour
              </Button>
            </Row>
          </Card>
        </>
      )}
    </div>
  );
}
