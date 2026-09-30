import { Apple, ArrowRight, BookOpen, CheckCircle2, Container, Download, Layers, Package, Server, Terminal } from "lucide-react";
import { useMemo, useState } from "react";
import { CodeBlock, InlineCmd } from "../components/code";
import { Button, Card, CardHead, Chip, CopyButton, Logo, PageHeader, Segmented, cn } from "../components/ui";
import { GATEWAY, MDM_ORDER, OS_META, OS_ORDER, RUNTIME, guessOs, orgFor, type MdmVendor, type Os } from "../data/install";
import { go } from "../lib/router";
import { toast, useStore } from "../lib/store";

/** Realistic two-step download: preparing → ready with the verify line, like the Evidence export toast. */
function beginDownload(name: string, verify: string) {
  toast("Preparing " + name, "Fetching the signed release manifest");
  setTimeout(() => toast(name + " ready", `Verify with: ${verify}`, "allow"), 1500);
}

const OS_LOGO: Record<Os, string> = { macos: "apple", windows: "windows", linux: "ubuntu" };

const MDM_LABEL: Record<MdmVendor, string> = { jamf: "Jamf Pro", intune: "Microsoft Intune", kandji: "Kandji" };
/** Intune is Microsoft's, so it carries the Microsoft mark. Jamf and Kandji ship no public icon set,
 *  so they get a lettermark in their own brand colour rather than an invented logo. */
const MDM_TINT: Record<MdmVendor, string> = { jamf: "#3B5DAA", intune: "", kandji: "#6B4EFF" };
function MdmMark({ vendor }: { vendor: MdmVendor }) {
  if (vendor === "intune") return <Logo name="microsoft" size={16} rounded="rounded-sm" />;
  return (
    <span className="grid size-4 place-items-center rounded-sm text-[9px] font-bold text-white" style={{ background: MDM_TINT[vendor] }} aria-hidden>
      {MDM_LABEL[vendor][0]}
    </span>
  );
}

export function Downloads() {
  const domain = useStore((s) => s.domain);
  const company = useStore((s) => s.company);
  const fleet = useStore((s) => s.fleet);
  const gateways = useStore((s) => s.gateways);
  const org = orgFor(domain, company);
  const runtimeOnDevices = fleet.filter((d) => d.runtimeVersion === RUNTIME.version && d.state !== "quarantined").length;
  const gatewayLive = gateways.some((g) => g.state === "healthy");

  return (
    <div className="mx-auto max-w-[1180px] px-4 lg:px-8 py-8">
      <PageHeader
        eyebrow="Deploy · install once per device, once per network"
        title="Downloads"
        sub="Wrapbox is one Control Plane (this app) plus two pieces of software: the Runtime on every laptop and server, and the Gateway on your network. Every command below matches the release your workspace is on."
      />
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-2 px-5 py-3.5 text-[12.5px] text-fg-2">
        <Chip tone="allow"><CheckCircle2 className="size-3" /> Release {RUNTIME.version}</Chip>
        <span>Runtime and Gateway ship on the same release train. Signed by the Wrapbox release key <span className="font-mono text-[11.5px] text-fg-3">wbx-release-2026-09</span>.</span>
        <a href="#/docs" className="ml-auto inline-flex items-center gap-1 font-medium text-accent">
          Read the docs <ArrowRight className="size-3" />
        </a>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <RuntimeCard org={org} onDevices={runtimeOnDevices} totalDevices={fleet.length} />
        <GatewayCard org={org} live={gatewayLive} name={gateways[0]?.id} />
      </div>
      <div className="mt-6 rounded-2xl border border-dashed border-line-strong bg-surface px-5 py-4 text-[12px] text-fg-3">
        Simulated download surface: the buttons show the real artifact name, size and sha256 shape, but nothing is fetched. A real deployment serves the same names, checksums and MDM profile keys from <span className="font-mono text-fg-2">get.wrapbox.dev</span>.
      </div>
    </div>
  );
}

function RuntimeCard({ org, onDevices, totalDevices }: { org: string; onDevices: number; totalDevices: number }) {
  const [os, setOs] = useState<Os>(guessOs);
  return (
    <Card className="p-0 overflow-hidden flex flex-col">
      <CardHead
        title={
          <span className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-[#1d4ed8]/10 text-[#1d4ed8]"><Package className="size-4.5" /></span>
            <span>
              <span className="block text-[16px] font-semibold">Wrapbox Runtime</span>
              <span className="block text-[12px] font-normal text-fg-3">Installed once per device · governs every agent on it</span>
            </span>
          </span>
        }
        right={
          <div className="text-right">
            <div className="text-[11.5px] text-fg-3">Version</div>
            <div className="font-mono text-[13px] font-semibold tnum">{RUNTIME.version}</div>
          </div>
        }
      />
      <div className="px-6 py-4 border-t border-line bg-surface-2 flex flex-wrap items-center gap-3 text-[12.5px] text-fg-2">
        <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-3.5 text-allow" /> Running on {onDevices} of {totalDevices} {totalDevices === 1 ? "device" : "devices"}</span>
        <span className="text-fg-3">·</span>
        <PlatformSupport />
        <a href="#/docs/runtime" className="ml-auto inline-flex items-center gap-1 font-medium text-accent"><BookOpen className="size-3.5" /> Runtime docs</a>
      </div>
      <div className="px-6 pt-5 pb-2">
        <Segmented
          size="sm"
          value={os}
          onChange={setOs}
          options={OS_ORDER.map((id) => ({
            value: id,
            label: (
              <>
                <Logo name={OS_LOGO[id]} size={14} rounded="rounded-sm" className={cn(os !== id && "opacity-60 grayscale")} />
                {OS_META[id].label}
              </>
            ),
          }))}
        />
      </div>
      <div className="px-6 pb-6 space-y-5 flex-1">
        {os === "macos" && <MacosPanel org={org} />}
        {os === "linux" && <LinuxPanel org={org} />}
        {os === "windows" && <WindowsPanel org={org} />}
      </div>
    </Card>
  );
}

function GatewayCard({ org, live, name }: { org: string; live: boolean; name?: string }) {
  const [tab, setTab] = useState<"docker" | "helm">("docker");
  return (
    <Card className="p-0 overflow-hidden flex flex-col">
      <CardHead
        title={
          <span className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-[#15803d]/10 text-[#15803d]"><Container className="size-4.5" /></span>
            <span>
              <span className="block text-[16px] font-semibold">Wrapbox Gateway</span>
              <span className="block text-[12px] font-normal text-fg-3">Installed once per network · fronts every MCP server, API and cloud call</span>
            </span>
          </span>
        }
        right={
          <div className="text-right">
            <div className="text-[11.5px] text-fg-3">Version</div>
            <div className="font-mono text-[13px] font-semibold tnum">{GATEWAY.version}</div>
          </div>
        }
      />
      <div className="px-6 py-4 border-t border-line bg-surface-2 flex flex-wrap items-center gap-3 text-[12.5px] text-fg-2">
        {live ? (
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-3.5 text-allow" /> Gateway live {name ? <span className="font-mono text-fg-3">· {name}</span> : null}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-review"><CheckCircle2 className="size-3.5 opacity-30" /> No gateway deployed yet</span>
        )}
        <span className="text-fg-3">·</span>
        <a href="#/docs/gateway" className="inline-flex items-center gap-1 font-medium text-accent"><BookOpen className="size-3.5" /> Gateway docs</a>
      </div>
      <div className="px-6 pt-5 pb-2">
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "docker", label: <><Logo name="docker" size={14} rounded="rounded-sm" className={cn(tab !== "docker" && "opacity-60 grayscale")} /> Docker · fast path</> },
            { value: "helm", label: <><Logo name="kubernetes" size={14} rounded="rounded-sm" className={cn(tab !== "helm" && "opacity-60 grayscale")} /> Kubernetes · Helm</> },
          ]}
        />
      </div>
      <div className="px-6 pb-6 space-y-5 flex-1">
        {tab === "docker" ? (
          <>
            <ArtifactRow title="Container image" name={GATEWAY.image} sha={GATEWAY.imageDigest} action={() => beginDownload(GATEWAY.image, `docker image inspect ${GATEWAY.image} --format '{{.Id}}'`)} actionLabel="Pull image" />
            <div>
              <div className="eyebrow mb-1.5">Deploy in one command</div>
              <CodeBlock file="deploy.sh" lang="bash" code={GATEWAY.docker(org)} />
              <p className="mt-2 text-[12px] text-fg-3">The container reads its policy bundle from the Control Plane on start, then advertises itself at <span className="font-mono text-fg-2">{GATEWAY.url}</span> for every agent client to point at.</p>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="eyebrow mb-1.5">Helm chart</div>
              <InlineCmd cmd={`helm show chart ${GATEWAY.helmChart} --version ${GATEWAY.helmVersion}`} />
            </div>
            <div>
              <div className="eyebrow mb-1.5">Install</div>
              <CodeBlock file="deploy.sh" lang="bash" code={GATEWAY.helm(org)} />
              <p className="mt-2 text-[12px] text-fg-3">Two replicas by default, an ingress at <span className="font-mono text-fg-2">mcp.{org}.internal</span>, and vault credentials read from the Kubernetes secret named in <span className="font-mono">enrollTokenSecret</span>.</p>
            </div>
          </>
        )}
        <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-[12px] text-fg-2">
          <div className="font-medium mb-1">After deploy</div>
          <ul className="space-y-1 text-fg-3">
            <li>Point agent clients at <span className="font-mono text-fg-2">{GATEWAY.url}</span> instead of the real MCP server or API host.</li>
            <li>The Gateway shows up on <a href="#/" className="underline underline-offset-2 text-fg">Fleet</a> as soon as it registers with the Control Plane.</li>
            <li>Full walkthrough in the <a href="#/docs/gateway/install" className="underline underline-offset-2 text-fg">Gateway install docs</a>.</li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

/** The platforms the Runtime ships on, read from the platform table rather than written out. */
export function PlatformSupport({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-fg-2", className)}>
      {OS_ORDER.map((id) => (
        <span key={id} className="inline-flex items-center gap-1" title={`${OS_META[id].label} · ${OS_META[id].artifact}`}>
          <CheckCircle2 className="size-3 text-allow" />
          {OS_META[id].label}
        </span>
      ))}
    </span>
  );
}

function ArtifactRow({ title, name, sha, size, action, actionLabel = "Download" }: { title: string; name: string; sha: string; size?: string; action: () => void; actionLabel?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] text-fg-3">{title}</div>
          <div className="font-mono text-[13px] font-medium truncate">{name}</div>
          <div className="mt-1 font-mono text-[10.5px] text-fg-3 truncate">
            sha256 · {sha.replace(/^sha256:/, "").slice(0, 24)}… {size ? <span>· {size}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <CopyButton text={name} label="Name" />
          <Button size="sm" variant="primary" onClick={action}><Download className="size-3.5" /> {actionLabel}</Button>
        </div>
      </div>
    </div>
  );
}

function MacosPanel({ org }: { org: string }) {
  const a = RUNTIME.macos.pkg;
  const [mdm, setMdm] = useState<MdmVendor>("jamf");
  const [mode, setMode] = useState<"mdm" | "dev">("mdm");
  const m = RUNTIME.macos.mdm[mdm];
  return (
    <>
      <ArtifactRow title="macOS installer" name={a.name} sha={a.sha256} size={a.size} action={() => beginDownload(a.name, RUNTIME.macos.verify(a))} />
      <Segmented
        size="sm"
        value={mode}
        onChange={setMode}
        options={[
          { value: "mdm", label: "Push with MDM · production" },
          { value: "dev", label: "Dev box · one command" },
        ]}
      />
      {mode === "mdm" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {MDM_ORDER.map((v) => (
              <button key={v} onClick={() => setMdm(v)} className={cn("inline-flex items-center gap-1.5 h-7 rounded-full border pl-1.5 pr-3 text-[12px] font-medium transition-colors", mdm === v ? "border-fg text-fg bg-surface" : "border-line text-fg-2 hover:border-line-strong")}>
                <MdmMark vendor={v} />
                {MDM_LABEL[v]}
              </button>
            ))}
          </div>
          <div>
            <div className="eyebrow mb-1.5">How IT deploys it via {m.vendor}</div>
            <ol className="space-y-1.5 text-[12.5px] text-fg-2">
              {m.steps.map((s, i) => (
                <li key={i} className="flex gap-3"><span className="grid size-5 place-items-center rounded-full bg-surface-3 text-[10.5px] font-semibold shrink-0 tnum">{i + 1}</span><span>{s}</span></li>
              ))}
            </ol>
          </div>
          <div>
            <div className="eyebrow mb-1.5">Configuration profile · {RUNTIME.macos.mdm.jamf.profile.filename}</div>
            <CodeBlock file={RUNTIME.macos.mdm.jamf.profile.filename} lang="json" code={JSON.stringify(RUNTIME.macos.mdm.jamf.profile.keys, null, 2)} maxH={220} />
            <p className="mt-2 text-[12px] text-fg-3">This is the payload the MDM pushes: the system-extension approval, the content-filter approval and the Full Disk Access grant. Same file for all three vendors.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="eyebrow mb-1.5">Install and enrol in one line</div>
            <InlineCmd cmd={`${RUNTIME.macos.shell} && ${RUNTIME.enroll(org)}`} />
          </div>
          <div>
            <div className="eyebrow mb-1.5">Or, install then enrol separately</div>
            <InlineCmd cmd={`sudo installer -pkg ${a.name} -target /`} />
            <div className="mt-1.5"><InlineCmd cmd={RUNTIME.enroll(org)} /></div>
          </div>
          <div>
            <div className="eyebrow mb-1.5">Verify the artifact</div>
            <InlineCmd cmd={RUNTIME.macos.verify(a)} />
          </div>
        </div>
      )}
    </>
  );
}

function WindowsPanel({ org }: { org: string }) {
  const a = RUNTIME.windows.msi;
  const m = RUNTIME.windows.intune;
  return (
    <>
      <ArtifactRow title="Windows installer" name={a.name} sha={a.sha256} size={a.size} action={() => beginDownload(a.name, RUNTIME.windows.verify(a))} />
      <div>
        <div className="eyebrow mb-1.5">How IT deploys it via {m.vendor}</div>
        <ol className="space-y-1.5 text-[12.5px] text-fg-2">
          {m.steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-5 place-items-center rounded-full bg-surface-3 text-[10.5px] font-semibold shrink-0 tnum">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <div className="eyebrow mb-1.5">Silent install</div>
        <InlineCmd cmd={RUNTIME.windows.shell} />
        <div className="mt-1.5">
          <InlineCmd cmd={RUNTIME.enroll(org)} />
        </div>
      </div>
      <div>
        <div className="eyebrow mb-1.5">Verify the artifact</div>
        <InlineCmd cmd={RUNTIME.windows.verify(a)} />
      </div>
      <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-[12px] text-fg-2">
        <div className="font-medium mb-0.5">How it enforces</div>
        <div className="text-fg-3">The Runtime is a Windows Service under LOCAL SYSTEM. Agents run in {OS_META.windows.coverage}, with NTFS ACEs on the working tree. No kernel driver is installed.</div>
      </div>
    </>
  );
}

function LinuxPanel({ org }: { org: string }) {
  const a = RUNTIME.linux.tarball;
  const [tab, setTab] = useState<"apt" | "rpm" | "tarball">("apt");
  return (
    <>
      <Segmented
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: "apt", label: "apt · Debian / Ubuntu" },
          { value: "rpm", label: "rpm · RHEL / Fedora" },
          { value: "tarball", label: "Tarball" },
        ]}
      />
      {tab === "apt" && (
        <>
          <div>
            <div className="eyebrow mb-1.5">Add the repository</div>
            <CodeBlock file="/etc/apt/sources.list.d/wrapbox.list" lang="bash" code={`# Add the signing key and the apt repo\ncurl -fsSL https://apt.wrapbox.dev/wrapbox.gpg | sudo tee /usr/share/keyrings/wrapbox.gpg > /dev/null\necho "${RUNTIME.linux.repoApt}" | sudo tee /etc/apt/sources.list.d/wrapbox.list`} />
          </div>
          <div>
            <div className="eyebrow mb-1.5">Install and enrol</div>
            <InlineCmd cmd={RUNTIME.linux.apt} />
            <div className="mt-1.5"><InlineCmd cmd={RUNTIME.enroll(org)} /></div>
          </div>
        </>
      )}
      {tab === "rpm" && (
        <>
          <div>
            <div className="eyebrow mb-1.5">Add the repository</div>
            <InlineCmd cmd={`sudo dnf config-manager --add-repo ${RUNTIME.linux.repoRpm}`} />
          </div>
          <div>
            <div className="eyebrow mb-1.5">Install and enrol</div>
            <InlineCmd cmd={RUNTIME.linux.rpm} />
            <div className="mt-1.5"><InlineCmd cmd={RUNTIME.enroll(org)} /></div>
          </div>
        </>
      )}
      {tab === "tarball" && (
        <>
          <ArtifactRow title="Static tarball · x86_64" name={a.name} sha={a.sha256} size={a.size} action={() => beginDownload(a.name, RUNTIME.linux.verify(a))} />
          <div>
            <div className="eyebrow mb-1.5">Install into /usr/local</div>
            <CodeBlock file="install.sh" lang="bash" code={`tar -xzf ${a.name} -C /usr/local\nsudo install /usr/local/wrapbox-runtime/wrapboxd /usr/local/bin/wrapboxd\nsudo cp /usr/local/wrapbox-runtime/wrapboxd.service /etc/systemd/system/\nsudo systemctl daemon-reload && sudo systemctl enable --now wrapboxd\n${RUNTIME.enroll(org)}`} />
          </div>
        </>
      )}
      <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-[12px] text-fg-2">
        <div className="font-medium mb-0.5">After install</div>
        <div className="text-fg-3">Check the daemon with <span className="font-mono text-fg-2">{RUNTIME.linux.systemd}</span>, then run <span className="font-mono text-fg-2">{RUNTIME.doctor}</span> to see the coverage classes it enabled.</div>
      </div>
    </>
  );
}
