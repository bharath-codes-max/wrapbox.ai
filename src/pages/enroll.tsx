// The install-once onboarding wizard shown only when the workspace is `fabric`. Uses the same setup
// chrome as the v1 onboarding, but walks through the two software pieces (Runtime → devices, Gateway →
// network) as their own step, then reframes the per-agent step as "provisioning adapters" on top of the
// already-installed Runtime. Every command shown here is imported from src/data/install.ts.

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, Container, Copy as CopyIcon, Download, Info, Loader2, Package, Rocket, ShieldCheck, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { agentById } from "../data/agents";
import { GATEWAY, MDM_ORDER, OS_META, OS_ORDER, RUNTIME, orgFor, runtimeInstall, type MdmVendor, type Os } from "../data/install";
import { profileOf } from "../data/profiles";
import { personById } from "../data/people";
import { CodeBlock, InlineCmd } from "../components/code";
import { Avatar, Button, Card, Chip, CompanyMark, CopyButton, Logo, Segmented, cn } from "../components/ui";
import { go } from "../lib/router";
import { adminPerson, markOnboarded, regionOf, toast, useStore } from "../lib/store";

const STEPS = [
  { t: "Create the workspace", s: "Tenant, identity provider, region" },
  { t: "Install Wrapbox", s: "Runtime on your devices · Gateway on your network" },
  { t: "Discover agents", s: "The Runtime finds what's on each laptop" },
  { t: "Provision adapters", s: "Adapters written per agent — nothing installed per agent" },
  { t: "Approvers & alerts", s: "Who signs what, and where they're asked" },
  { t: "Invite your team", s: "Engineers install the Runtime — same commands as Downloads" },
  { t: "Go live", s: "First heartbeat, first decision, Fleet" },
];

const MDM_LABEL: Record<MdmVendor, string> = { jamf: "Jamf Pro", intune: "Microsoft Intune", kandji: "Kandji" };

/** Small chrome, matched to the existing v1 SetupLayout. */
function Frame({ who, title, step, reached, onJump, children }: { who: "admin"; title: string; step: number; reached: number; onJump: (i: number) => void; children: ReactNode }) {
  const admin = adminPerson();
  return (
    <div className="mx-auto max-w-[1280px] px-4 lg:px-8 py-8">
      <div className="grid gap-6 lg:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6 self-start rounded-2xl border border-line bg-surface shadow-card overflow-hidden">
          <div className="prism-swatch h-1" aria-hidden />
          <div className="px-4 pt-4 pb-3.5 border-b border-line">
            <div className="flex items-center gap-2.5">
              <Avatar p={admin} size={30} />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold truncate">{title}</div>
                <div className="text-[11.5px] text-fg-3 truncate">{admin.name} · {admin.role}</div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-surface-3 overflow-hidden">
                <motion.div className="h-full prism-swatch" animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
              </div>
              <span className="text-[11px] text-fg-3 tnum shrink-0">
                {step + 1}/{STEPS.length}
              </span>
            </div>
          </div>
          <ol className="p-2 space-y-0.5">
            {STEPS.map((x, i) => (
              <li key={x.t}>
                <button
                  disabled={i > reached}
                  onClick={() => onJump(i)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed",
                    i === step ? "bg-surface-2 border border-line" : "border border-transparent hover:bg-surface-2",
                  )}
                >
                  <span className={cn("mt-0.5 grid size-5 place-items-center rounded-full text-[10.5px] font-semibold shrink-0", i < step ? "bg-allow text-white" : i === step ? "bg-ink text-ink-fg" : "border border-line text-fg-3")}>
                    {i < step ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-[13px] font-medium", i > reached ? "text-fg-3" : "text-fg")}>{x.t}</span>
                    <span className="block text-[11.5px] text-fg-3 leading-snug">{x.s}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <button onClick={() => go("/")} className="w-full border-t border-line px-4 py-2.5 text-left inline-flex items-center gap-1.5 text-[12px] text-fg-3 hover:text-fg hover:bg-surface-2">
            <X className="size-3.5" /> Exit setup
          </button>
        </aside>
        <AnimatePresence mode="wait">
          <motion.section key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.2 }} className="min-w-0">
            {children}
          </motion.section>
        </AnimatePresence>
      </div>
    </div>
  );
}

function StepHead({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div className="mb-5">
      <div className="eyebrow">Step {n} of {STEPS.length}</div>
      <h1 className="mt-1.5 text-[26px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-1.5 max-w-[68ch] text-[14px] text-fg-2 leading-relaxed">{sub}</p>
    </div>
  );
}

function Footer({ onBack, onNext, next = "Continue", disabled }: { onBack?: () => void; onNext: () => void; next?: string; disabled?: boolean }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
      {onBack && <Button variant="ghost" onClick={onBack}><ArrowLeft className="size-3.5" /> Back</Button>}
      <Button variant="primary" size="lg" className="ml-auto" onClick={onNext} disabled={disabled}>{next} <ArrowRight className="size-4" /></Button>
    </div>
  );
}

/* ================= the wizard ================= */

export function EnrollWizard() {
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  // Everything the summary counts is scoped to this session — the workspace's own history is not
  // something this admin just produced, so it would be wrong to show it on the last screen.
  const [since] = useState(() => Date.now());
  const company = useStore((s) => s.company);
  const domain = useStore((s) => s.domain);
  const idp = useStore((s) => s.idp);
  const fleet = useStore((s) => s.fleet);
  const gateways = useStore((s) => s.gateways);
  const org = orgFor(domain, company);

  const next = () => {
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
    setReached((r) => Math.max(r, step + 1));
    document.getElementById("main-scroll")?.scrollTo({ top: 0 });
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <Frame who="admin" title="Set up Wrapbox Enforcement Fabric" step={step} reached={reached} onJump={setStep}>
      {step === 0 && <Step0 company={company} domain={domain} idp={idp} onNext={next} />}
      {step === 1 && <Step1 org={org} fleet={fleet} gateways={gateways} onNext={next} onBack={back} />}
      {step === 2 && <Step2 fleet={fleet} onNext={next} onBack={back} />}
      {step === 3 && <Step3 fleet={fleet} onNext={next} onBack={back} />}
      {step === 4 && <Step4 onNext={next} onBack={back} />}
      {step === 5 && <Step5 org={org} onNext={next} onBack={back} />}
      {step === 6 && <Step6 since={since} onFinish={() => { markOnboarded("admin"); go("/"); toast("Wrapbox Enforcement Fabric is live", "Every page now reflects your enrolled fleet.", "allow"); }} onBack={back} />}
    </Frame>
  );
}

/* ---- step 0 ---- */
/** One row of the tenant identity card: a real mark, a value, and what it decides. */
function IdentityRow({ mark, label, value, sub, right }: { mark: ReactNode; label: string; value: string; sub: string; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 px-5 py-4 border-b border-line last:border-0">
      {mark}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold text-fg-3 uppercase tracking-wider">{label}</div>
        <div className="mt-0.5 text-[14.5px] font-medium truncate">{value}</div>
        <div className="text-[11.5px] text-fg-3 truncate">{sub}</div>
      </div>
      {right}
    </div>
  );
}

function Step0({ company, domain, idp, onNext }: { company: string; domain: string; idp: string; onNext: () => void }) {
  const region = useStore((s) => s.region);
  const r = regionOf(region);
  const members = useStore((s) => s.members);
  const idpName = idp || "Okta";
  const idpLogo = idpName.toLowerCase().includes("okta") ? "okta" : "microsoft";
  return (
    <>
      <StepHead n={1} title="Create the workspace" sub="One tenant, one policy engine, one evidence chain. The Runtime and the Gateway will both register into this workspace." />
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden">
          {/* The tenant's identity, carried in the brand gradient the rest of the product uses for it. */}
          <div className="hero-prism relative px-5 py-5 text-white">
            <div className="flex items-center gap-3.5">
              <span className="grid size-12 place-items-center rounded-xl bg-white/20 ring-1 ring-white/35 backdrop-blur-md text-[18px] font-semibold">
                {company.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="text-[18px] font-semibold tracking-tight truncate">{company}</div>
                <div className="text-[12px] text-white/85 truncate">{domain} · {members.length} people in the directory</div>
              </div>
            </div>
          </div>
          <IdentityRow
            mark={<CompanyMark name={company} size={40} className="rounded-xl" />}
            label="Company"
            value={company}
            sub={domain}
            right={<Chip tone="allow">Tenant created</Chip>}
          />
          <IdentityRow
            mark={<span className="grid size-10 place-items-center rounded-xl border border-line bg-surface"><Logo name={idpLogo} size={24} rounded="rounded-md" /></span>}
            label="Identity provider"
            value={idpName}
            sub="SSO and SCIM directory sync"
            right={<Chip tone="allow">Connected</Chip>}
          />
          <IdentityRow
            mark={<Logo name={r.flag} size={40} rounded="rounded-xl" />}
            label="Data region"
            value={`${r.country} · ${r.label}`}
            sub="Evidence, receipts and vault leases stay in the region."
            right={<Chip>Pinned</Chip>}
          />
        </Card>
        <Card className="p-5 h-fit">
          <div className="text-[13px] font-semibold">What lands in this workspace</div>
          <ul className="mt-3 space-y-2.5 text-[12.5px] text-fg-2">
            {[
              [Package, "Every enrolled device", "macOS, Windows and Linux"],
              [Container, "Every Gateway you deploy", "one per network"],
              [ShieldCheck, "One policy bundle", "and one signing key"],
            ].map(([Icon, t, s]) => {
              const I = Icon as typeof Package;
              return (
                <li key={t as string} className="flex gap-2.5">
                  <span className="grid size-7 place-items-center rounded-lg bg-surface-2 text-fg-2 shrink-0">
                    <I className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-fg">{t as string}</span>
                    <span className="block text-[11.5px] text-fg-3">{s as string}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 pt-3 border-t border-line text-[11.5px] text-fg-3">Simulated: signup and SSO are already provisioned in this walkthrough.</p>
        </Card>
      </div>
      <Footer onNext={onNext} />
    </>
  );
}

/* ---- step 1: Install Wrapbox — Runtime + Gateway ---- */
function Step1({ org, fleet, gateways, onNext, onBack }: { org: string; fleet: any[]; gateways: any[]; onNext: () => void; onBack: () => void }) {
  const [runtimeMode, setRuntimeMode] = useState<"mdm" | "link">("mdm");
  const [mdm, setMdm] = useState<MdmVendor>("jamf");
  const [rolling, setRolling] = useState<"idle" | "pushing" | "done">(fleet.length ? "done" : "idle");
  const [gwState, setGwState] = useState<"idle" | "deploying" | "live">(gateways.length ? "live" : "idle");
  const [linkOs, setLinkOs] = useState<Os>("macos");
  const macDevices = fleet.filter((d) => /mac/i.test(d.os)).length;
  const winDevices = fleet.filter((d) => /win/i.test(d.os)).length;
  const linuxDevices = fleet.filter((d) => /ubuntu|linux|debian|rhel|fedora/i.test(d.os)).length;

  const pushMdm = () => { setRolling("pushing"); setTimeout(() => setRolling("done"), 1600); };
  const deployGw = () => { setGwState("deploying"); setTimeout(() => setGwState("live"), 1400); };

  const runtimeDone = rolling === "done" || fleet.length > 0;
  const gwDone = gwState === "live" || gateways.length > 0;

  return (
    <>
      <StepHead
        n={2}
        title="Install Wrapbox"
        sub="Wrapbox is one Control Plane (this app) plus two pieces of software you install once: the Runtime on every device, and the Gateway on your network. Do both here — the same commands live on the Downloads page."
      />
      <div className="grid gap-5 xl:grid-cols-2">
        {/* Runtime → devices */}
        <Card className="p-0 overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b border-line">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-[#1d4ed8]/10 text-[#1d4ed8]"><Package className="size-4.5" /></span>
              <div>
                <div className="text-[15px] font-semibold">Runtime → your devices</div>
                <div className="text-[11.5px] text-fg-3">wrapboxd {RUNTIME.version} · installed once, discovers every agent</div>
              </div>
              {runtimeDone && <Chip tone="allow" className="ml-auto">Rolled out</Chip>}
            </div>
          </div>
          <div className="px-6 py-5 space-y-4">
            <Segmented
              size="sm"
              value={runtimeMode}
              onChange={setRuntimeMode}
              options={[
                { value: "mdm", label: "Push with MDM" },
                { value: "link", label: "Send install link" },
              ]}
            />
            {runtimeMode === "mdm" ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {MDM_ORDER.map((v) => (
                    <button key={v} onClick={() => setMdm(v)} className={cn("h-7 rounded-full border px-3 text-[12px] font-medium", mdm === v ? "border-fg text-fg bg-surface" : "border-line text-fg-2 hover:border-line-strong")}>
                      {MDM_LABEL[v]}
                    </button>
                  ))}
                </div>
                <div className="rounded-xl border border-line bg-surface-2 px-4 py-3.5">
                  <div className="text-[12px] font-medium mb-1.5">What IT sends</div>
                  <ul className="space-y-1 text-[12px] text-fg-2">
                    <li>· <span className="font-mono">{RUNTIME.macos.pkg.name}</span> (macOS) · <span className="font-mono">{RUNTIME.windows.msi.name}</span> (Windows) · <span className="font-mono">wrapbox-runtime</span> apt / rpm (Linux)</li>
                    <li>· <span className="font-mono">wrapbox-runtime-macos.mobileconfig</span> with the System Extension, PPPC and Content Filter payloads</li>
                    <li>· One MDM smart group covering every laptop and server that needs Wrapbox</li>
                  </ul>
                </div>
                <div>
                  <div className="text-[12px] font-medium mb-1.5">MDM steps · {mdm === "jamf" ? "Jamf Pro" : mdm === "intune" ? "Microsoft Intune" : "Kandji"}</div>
                  <ol className="space-y-1.5 text-[12px] text-fg-2">
                    {RUNTIME.macos.mdm[mdm].steps.map((s, i) => (
                      <li key={i} className="flex gap-2"><span className="text-fg-3 tnum shrink-0">{i + 1}.</span> {s}</li>
                    ))}
                  </ol>
                </div>
                <div className="rounded-xl bg-code border border-code-line px-4 py-3.5 font-mono text-[11.5px] text-[#a2acc5] leading-relaxed">
                  {rolling === "idle" && <div className="text-[#5f6a88]">→ Waiting for Push</div>}
                  {rolling !== "idle" && (
                    <>
                      <div className="text-[#3fd49b]">✓ Package uploaded · sha256 {RUNTIME.macos.pkg.sha256.slice(0, 16)}…</div>
                      <div className="text-[#3fd49b]">✓ Profile pushed to {mdm === "jamf" ? "Jamf" : mdm === "intune" ? "Intune" : "Kandji"} smart group</div>
                      {rolling === "pushing" && <div className="animate-pulse">· devices checking in…</div>}
                      {rolling === "done" && (
                        <>
                          <div className="text-[#3fd49b]">
                            ✓ {[[macDevices, "macOS"], [winDevices, "Windows"], [linuxDevices, "Linux"]].filter(([n]) => (n as number) > 0).map(([n, l]) => `${n} ${l}`).join(" · ")} {fleet.length === 1 ? "device" : "devices"} enrolled
                          </div>
                          <div className="text-[#3fd49b]">✓ First heartbeat received · policy bundle v{fleet[0]?.policyBundleVersion ?? 27} cached</div>
                        </>
                      )}
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant={runtimeDone ? "secondary" : "primary"} onClick={pushMdm} disabled={rolling === "pushing"}>
                    {rolling === "pushing" ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                    {runtimeDone ? "Re-push" : "Push to MDM"}
                  </Button>
                  <a href="#/downloads" className="text-[12.5px] font-medium text-accent inline-flex items-center gap-1">Open Downloads <ArrowRight className="size-3" /></a>
                  <a href="#/docs/runtime/install" className="text-[12.5px] text-fg-3 hover:text-fg inline-flex items-center gap-1"><BookOpen className="size-3" /> Install docs</a>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-line bg-surface-2 px-4 py-3.5">
                  <div className="text-[12px] font-medium mb-1">What each engineer does</div>
                  <ol className="text-[12px] text-fg-2 space-y-1">
                    <li>1. Open the install link you send them.</li>
                    <li>2. Download the artifact for their OS and run one command:</li>
                  </ol>
                </div>
                <OsPicker value={linkOs} onChange={setLinkOs} />
                <OsCommand os={linkOs} org={org} />
                <p className="text-[11.5px] text-fg-3">The invite that goes to engineers on step 6 carries the command for their own OS and a link to <a href="#/downloads" className="underline underline-offset-2 text-fg">Downloads</a>.</p>
              </>
            )}
          </div>
        </Card>

        {/* Gateway → network */}
        <Card className="p-0 overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b border-line">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-[#15803d]/10 text-[#15803d]"><Container className="size-4.5" /></span>
              <div>
                <div className="text-[15px] font-semibold">Gateway → your network</div>
                <div className="text-[11.5px] text-fg-3">One deployable · fronts every MCP server, API, cloud CLI</div>
              </div>
              {gwDone && <Chip tone="allow" className="ml-auto">Live</Chip>}
            </div>
          </div>
          <div className="px-6 py-5 space-y-4">
            <div>
              <div className="text-[12px] font-medium mb-1.5">Docker · fast path</div>
              <CodeBlock file="deploy.sh" lang="bash" code={GATEWAY.docker(org)} maxH={200} />
            </div>
            <div>
              <div className="text-[12px] font-medium mb-1.5">Kubernetes · Helm (production)</div>
              <CodeBlock file="deploy.sh" lang="bash" code={GATEWAY.helm(org)} maxH={200} />
            </div>
            <div className="rounded-xl border border-line bg-surface-2 px-4 py-3.5">
              <div className="text-[12px] font-medium mb-1">After deploy</div>
              <div className="text-[12px] text-fg-2">Point agent MCP clients at <span className="font-mono text-fg">{GATEWAY.url}</span> — the Runtime rewrites this for every managed agent it discovers.</div>
            </div>
            <div className="rounded-xl bg-code border border-code-line px-4 py-3.5 font-mono text-[11.5px] text-[#a2acc5] leading-relaxed">
              {gwState === "idle" && <div className="text-[#5f6a88]">→ Waiting for Deploy</div>}
              {gwState !== "idle" && (
                <>
                  <div className="text-[#3fd49b]">✓ Image pulled · {GATEWAY.image}</div>
                  <div className="text-[#3fd49b]">✓ Registered with the Control Plane</div>
                  {gwState === "deploying" && <div className="animate-pulse">· syncing policy bundle…</div>}
                  {gwState === "live" && (
                    <>
                      <div className="text-[#3fd49b]">✓ Gateway id · {gateways[0]?.id ?? "gw-us-east-1"} · region us-east-1</div>
                      <div className="text-[#3fd49b]">✓ Bundle v{gateways[0]?.policyBundleVersion ?? 27} · listening at {GATEWAY.url}</div>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={gwDone ? "secondary" : "primary"} onClick={deployGw} disabled={gwState === "deploying"}>
                {gwState === "deploying" ? <Loader2 className="size-3.5 animate-spin" /> : <Container className="size-3.5" />}
                {gwDone ? "Re-deploy" : "Deploy"}
              </Button>
              <a href="#/docs/gateway/install" className="text-[12.5px] text-fg-3 hover:text-fg inline-flex items-center gap-1"><BookOpen className="size-3" /> Install docs</a>
            </div>
          </div>
        </Card>
      </div>
      <div className="mt-4 rounded-xl border border-dashed border-line-strong bg-surface px-5 py-3.5 text-[12px] text-fg-3">
        <span className="font-medium text-fg-2">Simulated in this walkthrough:</span> nothing is actually pushed or deployed. The commands, sha256 fingerprints and MDM steps are the same ones your IT team would run in production — this workspace already reflects what the state would be after both rollouts complete.
      </div>
      <Footer onBack={onBack} onNext={onNext} disabled={!(runtimeDone && gwDone)} />
    </>
  );
}

/** The OS picker used wherever an engineer-facing command is shown. */
function OsPicker({ value, onChange }: { value: Os; onChange: (v: Os) => void }) {
  return <Segmented size="sm" value={value} onChange={onChange} options={OS_ORDER.map((id) => ({ value: id, label: OS_META[id].label }))} />;
}

/** The install line for one OS, straight from the shared install table. */
function OsCommand({ os, org }: { os: Os; org: string }) {
  const install = runtimeInstall(os, org);
  return (
    <div>
      <div className="text-[12px] font-medium mb-1.5">{OS_META[os].label} · one line</div>
      <InlineCmd cmd={install.oneLiner} />
    </div>
  );
}

/* ---- step 2: Discover agents ---- */
function Step2({ fleet, onNext, onBack }: { fleet: any[]; onNext: () => void; onBack: () => void }) {
  const discovered = fleet.flatMap((d) => d.agents);
  const withProfile = discovered.filter((a) => profileOf(a.agentId));
  const unknown = discovered.length - withProfile.length;
  return (
    <>
      <StepHead n={3} title="Discover agents" sub={`The Runtime scans each device against its agent profiles — binaries, signing IDs, IDE extensions, MCP config files. Anything unmatched shows up flagged. Your fleet has ${discovered.length} agents discovered across ${fleet.length} devices.`} />
      <Card className="overflow-hidden">
        <div className="px-6 pt-4 pb-3 border-b border-line flex flex-wrap items-center gap-3 text-[12.5px]">
          <Chip tone="allow"><CheckCircle2 className="size-3" /> {withProfile.length} matched to a profile</Chip>
          {unknown > 0 && <Chip tone="review">{unknown} unknown · Floor only</Chip>}
          <span className="ml-auto text-fg-3">Every agent above is data, not code. Adding one is a profile entry — see <a href="#/docs/runtime/adapters" className="underline underline-offset-2">Adapters</a>.</span>
        </div>
        <div className="divide-y divide-line">
          {fleet.map((d) => (
            <div key={d.id} className="px-6 py-4">
              <div className="flex items-center gap-3 mb-2">
                <Logo name={d.osLogo} size={22} rounded="rounded-md" />
                <span className="font-mono text-[13px] font-semibold">{d.hostname}</span>
                <span className="text-[11.5px] text-fg-3">{d.os}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {d.agents.map((a: any) => {
                  const p = profileOf(a.agentId);
                  const agent = agentById(a.agentId);
                  return (
                    <div key={a.agentId} className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-1.5">
                      <Logo name={agent.logo} bleed={agent.bleed} size={20} rounded="rounded" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-medium truncate">{agent.name} <span className="font-normal text-fg-3">{a.version}</span></div>
                        <div className="text-[10.5px] text-fg-3 font-mono truncate">{p ? p.binaries[0] : "no profile match"}</div>
                      </div>
                      {p ? <Chip tone="allow">matched</Chip> : <Chip tone="review">unknown</Chip>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Footer onBack={onBack} onNext={onNext} />
    </>
  );
}

/* ---- step 3: Provision adapters ---- */
function Step3({ fleet, onNext, onBack }: { fleet: any[]; onNext: () => void; onBack: () => void }) {
  const rows = fleet.flatMap((d) => d.agents.filter((a: any) => a.adapter).map((a: any) => ({ d, a })));
  return (
    <>
      <StepHead n={4} title="Provision adapters" sub="The Runtime is already installed. This step is the Runtime writing each agent's adapter file — managed-settings.json, hooks.json — from the profile, and starting to monitor it for change. No new software gets installed per agent." />
      <Card className="overflow-hidden">
        <div className="px-6 pt-4 pb-3 border-b border-line text-[12.5px]">
          <Chip tone="allow"><CheckCircle2 className="size-3" /> {rows.length} adapters written · integrity monitored</Chip>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead>
              <tr className="text-[11.5px] text-fg-3 border-b border-line">
                <th className="font-medium px-6 py-2.5">Device</th>
                <th className="font-medium px-3 py-2.5">Agent</th>
                <th className="font-medium px-3 py-2.5">Adapter</th>
                <th className="font-medium px-3 py-2.5">Kind</th>
                <th className="font-medium px-3 py-2.5">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ d, a }) => {
                const agent = agentById(a.agentId);
                return (
                  <tr key={d.id + a.agentId} className="border-b border-line last:border-0">
                    <td className="px-6 py-3 font-mono text-[11.5px]">{d.hostname}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <Logo name={agent.logo} bleed={agent.bleed} size={18} rounded="rounded" /> {agent.name}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-[11.5px] truncate max-w-[280px]">{a.adapter.path}</td>
                    <td className="px-3 py-3 text-fg-3">{a.adapter.kind}</td>
                    <td className="px-3 py-3"><Chip tone={a.adapter.state === "tampered" ? "block" : "allow"}>{a.adapter.state}</Chip></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="mt-4 p-5">
        <div className="text-[13px] font-semibold mb-1">Adding a new agent later</div>
        <p className="text-[12.5px] text-fg-2 leading-relaxed">There is no per-agent install. When Wrapbox adds a profile for an agent, the Runtime writes its adapter on the next heartbeat — on every device that has the agent — and the agent appears on Fleet with the coverage classes its profile provides. See <a href="#/docs/runtime/adapters" className="underline underline-offset-2 text-fg">Adapters &amp; integrity</a>.</p>
      </Card>
      <Footer onBack={onBack} onNext={onNext} />
    </>
  );
}

/* ---- step 4: approvers & alerts ---- */
function Step4({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const groups = useStore((s) => s.groups);
  return (
    <>
      <StepHead n={5} title="Approvers & alerts" sub="REVIEW decisions go to real people, not a queue. Every approver group in your contract maps to at least one person; approvals arrive as receipts on their signed action." />
      <Card className="overflow-hidden">
        {Object.entries(groups).map(([g, ids]) => (
          <div key={g} className="flex flex-wrap items-center gap-3 px-6 py-3.5 border-b border-line last:border-0">
            <span className="font-mono text-[12.5px] text-review w-[170px] shrink-0">{g}</span>
            <div className="flex -space-x-1.5">
              {ids.map((id) => {
                const p = personById(id);
                return p ? <Avatar key={id} p={p} size={22} /> : null;
              })}
            </div>
            <span className="text-[12px] text-fg-2 truncate">{ids.map((id) => personById(id)?.name).filter(Boolean).join(", ")}</span>
          </div>
        ))}
      </Card>
      <p className="mt-3 text-[12px] text-fg-3">Approvals arrive out-of-band (Slack, mobile) with the argv, diff, request summary and the agent's stated reason from the hook. Every approval produces a receipt the destination verifies.</p>
      <Footer onBack={onBack} onNext={onNext} />
    </>
  );
}

/* ---- step 5: invite ---- */
function Step5({ org, onNext, onBack }: { org: string; onNext: () => void; onBack: () => void }) {
  const members = useStore((s) => s.members);
  const withoutDevice = members.filter((m) => m.status === "invited").length;
  const inviteUrl = `https://app.wrapbox.ai/join/${org}`;
  const [emailOs, setEmailOs] = useState<Os>("macos");
  const install = runtimeInstall(emailOs, org);
  return (
    <>
      <StepHead n={6} title="Invite your team" sub={`Every invited engineer installs the Runtime on their own machine — same commands as the Downloads page. ${members.length} people in the directory today; ${withoutDevice} still to install.`} />
      <Card className="p-6">
        <div className="text-[12px] font-semibold text-fg-3 uppercase tracking-wider mb-1.5">Invite link</div>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3.5 h-11">
          <code className="flex-1 font-mono text-[12.5px] truncate">{inviteUrl}</code>
          <CopyButton text={inviteUrl} />
        </div>
        <p className="mt-2 text-[12px] text-fg-3">The invite carries the engineer's OS-specific install command and links back to <a href="#/downloads" className="underline underline-offset-2 text-fg">Downloads</a>.</p>
      </Card>
      <Card className="mt-5 p-6">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="text-[13px] font-semibold">What arrives in their inbox</div>
          <OsPicker value={emailOs} onChange={setEmailOs} />
          <span className="text-[11.5px] text-fg-3">Each engineer gets the line for their own machine.</span>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 p-4 text-[12.5px] text-fg-2 leading-relaxed">
          <div className="font-semibold text-fg">You're invited to Wrapbox Enforcement Fabric</div>
          <p className="mt-2">Your admin set up Wrapbox for {org}. To finish, install the Wrapbox Runtime on your laptop and run one enrolment command — takes about three minutes.</p>
          <ol className="mt-2 space-y-1.5">
            <li>1. Download the Runtime for your OS: <a href="#/downloads" className="text-accent underline underline-offset-2">app.wrapbox.ai/downloads</a></li>
            <li>
              2. {OS_META[emailOs].label}: <code className="font-mono text-[11.5px] bg-surface-3 px-1 py-0.5 rounded">{install.installOnly}</code>
            </li>
            <li>3. Enrol: <code className="font-mono text-[11.5px] bg-surface-3 px-1 py-0.5 rounded">{RUNTIME.enroll(org)}</code></li>
          </ol>
          <p className="mt-2">Your device will show up on Fleet within a minute. Reply here if anything sticks — the <a href="#/docs/runtime/troubleshooting" className="text-accent underline underline-offset-2">Troubleshooting docs</a> cover the usual issues.</p>
        </div>
      </Card>
      <Footer onBack={onBack} onNext={onNext} />
    </>
  );
}

/* ---- step 6: go live ----
   Counts are scoped to this setup session, not the workspace's history: one screen after finishing
   setup, nothing has been asked and almost nothing has run. `since` is the moment the wizard opened. */
function Step6({ since, onFinish, onBack }: { since: number; onFinish: () => void; onBack: () => void }) {
  const fleet = useStore((s) => s.fleet);
  const gateways = useStore((s) => s.gateways);
  const events = useStore((s) => s.events);
  const approvals = useStore((s) => s.approvals);
  const fresh = events.filter((e) => e.ts >= since);
  const waiting = approvals.filter((a) => a.status === "pending" && a.createdAt >= since);
  const gwLive = gateways.some((g) => g.state === "healthy");
  return (
    <>
      <StepHead n={7} title="Go live" sub="One Control Plane, one Runtime on every device, one Gateway on your network. Every action from here on is decided by one policy and lands on Evidence." />
      <Card className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-line overflow-hidden mb-4">
        {[
          ["Devices enrolled", String(fleet.length), "across every platform"],
          ["Gateway", gwLive ? "live" : "not yet", gwLive ? gateways[0].region : "deploy on step 2"],
          ["Decisions so far", String(fresh.length), fresh.length ? "since setup started" : "nothing has run yet"],
          ["Waiting for a human", String(waiting.length), waiting.length ? "open Approvals" : "nothing asked yet"],
        ].map(([l, v, s]) => (
          <div key={l} className="px-6 py-5">
            <div className="text-[12px] text-fg-3">{l}</div>
            <div className="mt-1 text-[22px] font-semibold tracking-tight tnum">{v}</div>
            <div className="text-[11.5px] text-fg-3 mt-0.5 truncate">{s}</div>
          </div>
        ))}
      </Card>
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <Rocket className="size-5 text-accent mt-0.5" />
          <div className="flex-1">
            <div className="text-[14px] font-semibold">Fleet is ready. The first decision will show up as soon as an agent runs.</div>
            <p className="mt-1 text-[12.5px] text-fg-2">Fleet shows every device and gateway; Evidence records every decision; Approvals lands the ones that need a person. If you add a new agent tomorrow, no install — a profile entry, and the Runtime writes the adapter on the next heartbeat.</p>
          </div>
        </div>
      </Card>
      <Footer onBack={onBack} onNext={onFinish} next="Open Fleet" />
    </>
  );
}
