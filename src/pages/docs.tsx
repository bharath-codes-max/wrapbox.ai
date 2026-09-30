import { ArrowRight, BookOpen, Container, Download, Package } from "lucide-react";
import type { ReactNode } from "react";
import { CodeBlock, InlineCmd } from "../components/code";
import { Button, Card, Chip, PageHeader, cn } from "../components/ui";
import { GATEWAY, MDM_ORDER, OS_META, RUNTIME, orgFor } from "../data/install";
import { go } from "../lib/router";
import { useStore } from "../lib/store";

/* ================= structure ================= */

interface Section {
  id: string;
  title: string;
  render: (ctx: DocCtx) => ReactNode;
}
interface DocSet {
  id: "runtime" | "gateway";
  title: string;
  icon: typeof Package;
  intro: string;
  sections: Section[];
}
interface DocCtx {
  org: string;
  domain: string;
  company: string;
  version: string;
  bundleVersion: number;
  runtimeOnDevices: number;
  totalDevices: number;
  gatewayLive: boolean;
  gatewayId?: string;
}

/* ================= runtime docs ================= */

const RUNTIME_DOCS: Section[] = [
  {
    id: "overview",
    title: "Overview",
    render: () => (
      <>
        <P>
          The Wrapbox Runtime — the process it registers as <M>wrapboxd</M> — is the piece of software installed once on every laptop and server. It has three responsibilities:
        </P>
        <ul className="my-3 space-y-1.5 list-disc pl-5 text-fg-2">
          <li><B>Discovery.</B> When the daemon starts, it reads the agent profiles it shipped with and looks for the binaries, IDE extensions and configuration files each profile names. Every found agent becomes a record on Fleet.</li>
          <li><B>Provisioning.</B> For each discovered agent that has an adapter template, the Runtime writes the adapter file itself — <M>managed-settings.json</M> for Claude Code, <M>hooks.json</M> for Cursor, and so on — and monitors it for change.</li>
          <li><B>Enforcement.</B> Two layers, both authoritative: the <B>Floor</B>, an OS-level fence on files, processes and network calls the agent makes; and the <B>Ceiling</B>, the native hook the agent's own harness fires before each tool call.</li>
        </ul>
        <P>The Runtime is not a sandbox in itself: it embeds Anthropic's Sandbox Runtime for confinement, the OS's own primitives for attribution, and calls back into the Control Plane's decision engine for every allow / deny / ask / constrain. Every action carries a coverage class so an auditor can see what was seen and how confidently.</P>
        <Callout>Nothing per agent is installed by the user. If an agent's profile exists, the Runtime finds and provisions it; if not, its model calls are refused by rule <M>model.egress</M> until it's enrolled or a profile is added.</Callout>
      </>
    ),
  },
  {
    id: "install",
    title: "Install",
    render: ({ org }) => (
      <>
        <P>The Runtime ships as a signed installer per operating system. All three read their configuration from the same MDM profile shape, and every install path ends with the same enrolment line.</P>
        <H3>macOS</H3>
        <P>Distribute <M>{RUNTIME.macos.pkg.name}</M> alongside the configuration profile that grants the three permissions the daemon needs: a System Extension entitlement, a Network Extension content-filter entitlement and Full Disk Access via PPPC. Every MDM vendor accepts the same <M>.mobileconfig</M>; see the {" "}
          <a href="#/downloads" className="underline underline-offset-2 text-fg">Downloads page</a> for the payload keys and step-by-step for {MDM_ORDER.map((v) => (v === "kandji" ? "and " : "") + (v === "jamf" ? "Jamf Pro" : v === "intune" ? "Intune" : "Kandji")).join(", ")}.
        </P>
        <P>On a developer box the same package installs from the shell:</P>
        <InlineCmd cmd={`${RUNTIME.macos.shell} && ${RUNTIME.enroll(org)}`} />
        <H3>Windows</H3>
        <P>
          Deploy <M>{RUNTIME.windows.msi.name}</M> as a Line-of-business app in Intune with a System install context. The Runtime runs as a Windows Service under LOCAL SYSTEM, attributes network flows with Windows Filtering Platform filters, and confines launched agents to {OS_META.windows.coverage} with NTFS ACEs on the working tree. No kernel driver is installed: after the 2024 endpoint-security changes Microsoft is moving security vendors out of the kernel, so the Runtime uses user-mode primitives only.
        </P>
        <InlineCmd cmd={RUNTIME.windows.shell} />
        <H3>Linux</H3>
        <P>On Debian- or Ubuntu-based fleets, add the apt repository once — the same key signs every release — then install:</P>
        <InlineCmd cmd={RUNTIME.linux.apt} />
        <P>On RHEL, Fedora or Amazon Linux, the equivalent is <M>{RUNTIME.linux.rpm}</M>. The daemon runs under systemd; check it with:</P>
        <InlineCmd cmd={RUNTIME.linux.systemd} />
        <P>Every install path finishes with the same command, which binds the machine to your tenant and downloads the current policy bundle:</P>
        <InlineCmd cmd={RUNTIME.enroll(org)} />
      </>
    ),
  },
  {
    id: "enrollment",
    title: "Enrollment & heartbeat",
    render: ({ org, bundleVersion }) => (
      <>
        <P>Enrolment is the moment a device becomes a Fleet member. It runs on first start after install, or when you rerun <M>{RUNTIME.enroll(org)}</M> after an unenroll.</P>
        <H3>What happens, in order</H3>
        <ol className="my-3 space-y-1.5 list-decimal pl-5 text-fg-2">
          <li>The Runtime generates a P-256 keypair in the platform keystore — the Secure Enclave on macOS, the TPM on Windows, the OS keyring on Linux — and never exports the private key.</li>
          <li>It registers the public half with the Control Plane along with the device's platform posture (OS version, arch, MDM identifier if present). The Control Plane returns a device id and a bundle URL.</li>
          <li>It downloads the current policy bundle (v{bundleVersion} at your tenant right now), verifies the signature against the release key, and caches it on disk.</li>
          <li>It sends its first heartbeat. The device appears on Fleet with state <B>enrolling</B>, then <B>healthy</B> once the first heartbeat is acknowledged.</li>
        </ol>
        <H3>Heartbeat</H3>
        <P>The Runtime sends a heartbeat every 30 seconds. Miss two in a row and the Fleet page moves the device to <B>heartbeat-lost</B>; the cached policy bundle keeps enforcing locally, but the Control Plane refuses to mint receipts for that device until it checks in. After ten minutes of silence the device moves to <B>quarantined</B> — every action from it is refused.</P>
        <Callout tone="review">The state is what a viewer sees on Fleet: no runtime, no receipt, and every tier-0 destination refuses the request. This is the only guarantee that survives a compromised laptop.</Callout>
      </>
    ),
  },
  {
    id: "enforcement",
    title: "How enforcement works",
    render: () => (
      <>
        <P>The Runtime enforces at two layers on every device. Both are authoritative — the Floor cannot be widened by a Ceiling decision — and both feed the same Control Plane engine.</P>
        <H3>Floor · OS confinement</H3>
        <P>Every agent the Runtime launches (or attributes by process ancestry) runs inside an OS sandbox with three fences:</P>
        <ul className="my-3 space-y-1.5 list-disc pl-5 text-fg-2">
          <li>A filesystem fence that grants read and write only inside the workspace the agent was started in, denies mandatory paths (shell rc files, <M>.git/hooks</M>, agent command directories) outright, and resolves symlinks before every check.</li>
          <li>A process fence that attributes every <M>exec</M> to the root ancestor, so a Python subprocess started by the agent is still attributed to the agent.</li>
          <li>A network fence that routes egress through the Runtime's local proxy. There is no route to the internet from an agent process that goes around the proxy.</li>
        </ul>
        <P>These three fences produce the events labelled <B>Floor</B> in Evidence. They see exec + argv, file open by path, and socket connect by host. They do not see request bodies or tool semantics — that is what the Ceiling is for.</P>
        <H3>Ceiling · native hooks</H3>
        <P>For every agent that exposes a pre-tool hook interface, the Runtime writes the adapter file the agent expects and points its hook at a signed shim binary. When the agent tries to run a tool, the harness fires the hook, the shim forwards the event to the local daemon over a Unix socket, and the daemon calls the decision engine with the full tool name and arguments. The verdict returns in the vendor's own format, with a reason string the model reads.</P>
        <P>The Ceiling sees intent. It is bypassable in principle — a compromised agent can ignore its own hooks — so the Runtime treats an edited adapter file as a signal, not an incident: the agent's launch mode flips to <M>native-unmanaged</M>, the Ceiling is dropped, the Floor keeps enforcing, and rule <M>model.egress</M> refuses model calls until the Runtime rewrites the adapter.</P>
      </>
    ),
  },
  {
    id: "bundles",
    title: "Policy bundles & propagation",
    render: ({ bundleVersion }) => (
      <>
        <P>The policy bundle is the set of rules the Runtime evaluates on. It is signed by the Control Plane and cached on every device.</P>
        <H3>Distribution</H3>
        <P>When you publish a change on the Intent contract page, the Control Plane signs a new bundle and marks it as the current version. Every device's heartbeat returns the current bundle id, and any device whose cached id is behind pulls the new bundle over the same heartbeat channel. Fleet shows the propagation status per device: the version number under the Runtime line is the bundle id it is enforcing right now.</P>
        <P>Your tenant is on bundle v{bundleVersion}. A publish reaches every healthy device in under a minute in the reference deployment.</P>
        <H3>Offline behaviour</H3>
        <P>A device that cannot reach the Control Plane keeps enforcing on its cached bundle for up to seven days. After that it drops to a conservative default profile: everything except <M>filesystem.read</M> inside the workspace is denied, so an agent on a fully offline laptop can still read the code, but can't ship, deploy, refund or reach a model. This bound is the last line before <B>quarantined</B>.</P>
        <Callout>Tier-0 destinations always fail closed: a device that cannot reach the Control Plane cannot mint a receipt, and every destination configured to require one refuses.</Callout>
      </>
    ),
  },
  {
    id: "adapters",
    title: "Adapters & integrity",
    render: () => (
      <>
        <P>An adapter is the file the Runtime writes to make a native hook work. The file paths, kinds and contents come from the agent profile; the Runtime never has agent-specific code.</P>
        <H3>What gets written</H3>
        <P>For a Claude Code install on macOS, the Runtime writes managed settings at <M>{RUNTIME.macos.mdm.jamf.profile.keys.PayloadIdentifier === "ai.wrapbox.runtime" ? "/Library/Application Support/ClaudeCode/managed-settings.json" : ""}</M>, with the six keys the vendor documents: <M>allowManagedHooksOnly</M>, <M>allowManagedPermissionRulesOnly</M>, <M>allowManagedMcpServersOnly</M>, <M>permissions.disableBypassPermissionsMode</M>, <M>sandbox.enabled</M> and <M>sandbox.failIfUnavailable</M>. The <M>hooks</M> block points every event at the signed shim binary the Runtime installed. Cursor gets <M>~/.cursor/hooks.json</M>, Codex CLI gets <M>~/.codex/hooks.json</M>, and each vendor's documented format is used verbatim.</P>
        <H3>Integrity monitor</H3>
        <P>Every provisioned adapter is monitored for change. Any write the Runtime did not itself make flips the file's state to <B>tampered</B>, records an <M>runtime.integrity</M> event in evidence, and marks the agent's launch mode as <M>native-unmanaged</M>. The Runtime then rewrites the file from the profile — the state becomes <B>re-provisioned</B>, launch mode goes back to <B>native-managed</B>, and everything is derived from what the fleet reports.</P>
        <P>Between the tamper and the rewrite, the Ceiling is not there, so any hookable action reverts to Floor-only enforcement — and rule <M>model.egress</M> refuses model calls because the launch mode is no longer managed. This is the window Fleet shows on the tamper history for a device.</P>
      </>
    ),
  },
  {
    id: "upgrades",
    title: "Upgrades & rollback",
    render: () => (
      <>
        <P>Runtime upgrades are staged, atomic and reversible.</P>
        <H3>Rollout</H3>
        <P>The Control Plane cuts a new release; the manifest becomes available at <M>get.wrapbox.dev</M>. MDM-managed fleets pick it up on the next check-in via the normal package channel. Devices that were installed with the shell one-liner get the update on next enrolment or on <M>wrapbox upgrade</M>. Every upgrade downloads the new binary side-by-side, runs its self-tests, then flips a symlink to activate; the old binary stays on disk for the next 24 hours.</P>
        <H3>Rollback</H3>
        <P>If a device fails its post-upgrade self-tests, the Runtime flips the symlink back and reports the failure to the Control Plane; the device stays on the previous version. To roll back manually, run <M>wrapbox rollback</M> — it flips to the previously-installed release. Rolling back a bundle rather than the binary is a publish on the Intent contract page.</P>
      </>
    ),
  },
  {
    id: "uninstall",
    title: "Uninstall",
    render: () => (
      <>
        <P>Uninstalling the Runtime is a one-command operation that leaves the machine in the state it would be in if the Runtime had never run.</P>
        <InlineCmd cmd="sudo wrapbox unenroll --keep-evidence" />
        <P>Unenrol first: the daemon removes every adapter it wrote, drops the OS sandbox fences it set up, and reports the device as <B>unenrolling</B> to the Control Plane. Evidence records are kept locally for seven days by default; pass <M>--purge</M> to remove them immediately. Then remove the package with the OS's own tool:</P>
        <InlineCmd cmd="sudo pkgutil --forget ai.wrapbox.runtime && sudo rm -rf /usr/local/wrapbox" />
        <P>The Control Plane keeps the device's evidence in the workspace log for the retention period configured on the Settings page, whether or not the device is enrolled today.</P>
      </>
    ),
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    render: () => (
      <>
        <P>Run <M>{RUNTIME.doctor}</M> first. It prints one line per coverage class, one line per profile discovered, and one line per adapter written — the same information Fleet shows for the device, from the local daemon's own view.</P>
        <H3>Common failures</H3>
        <ul className="my-3 space-y-2 list-disc pl-5 text-fg-2">
          <li><B>No heartbeat.</B> Check the daemon is running (<M>launchctl list | grep wrapbox</M> on macOS, <M>{RUNTIME.linux.systemd}</M> on Linux). If the process is up but the heartbeat is stuck, the outbound network is the usual cause — the Control Plane URL must be reachable from the device.</li>
          <li><B>Adapter rewritten every heartbeat.</B> Something else is writing the same file. MDM configuration profiles that manage the same settings key are the usual cause; the Runtime always wins the last write, but the alternation shows as a stream of <B>tampered → re-provisioned</B> events. Have IT remove the conflicting profile.</li>
          <li><B>Full Disk Access denied.</B> On macOS this is a PPPC grant. If the MDM did not deploy it, add the Wrapbox PPPC payload before the package.</li>
          <li><B>An endpoint security tool flagged the shim.</B> The shim is signed with an EV certificate. Add an exclusion for the Wrapbox install path in your EDR — on Windows this is an ASR exclusion — then run <M>wrapbox doctor</M> again.</li>
        </ul>
        <P>If none of the above helps, run <M>wrapbox bundle-report</M> — it packages the daemon log, the current policy bundle id and the last 200 evidence records into a signed tarball you can share with Wrapbox support without leaking the workspace state.</P>
      </>
    ),
  },
  {
    id: "security",
    title: "Security & privacy",
    render: () => (
      <>
        <P>The Runtime sees actions, not content.</P>
        <H3>What it sees</H3>
        <P>File paths (not contents), process command lines (not stdin/stdout), socket destinations (host and port, not payloads), and the JSON body of every hook event (tool name, arguments, transcript path). All of these are OCSF-shaped; every record includes the coverage class it was decided with, so an auditor can see whether Wrapbox actually saw the request or only its outline.</P>
        <H3>What it does not see</H3>
        <ul className="my-3 space-y-1.5 list-disc pl-5 text-fg-2">
          <li>File contents. The Runtime never reads a file — it decides whether the agent is allowed to.</li>
          <li>Prompts and completions. A prompt only enters evidence when it is attached to an approval request, and even then only the summary the agent sends with the hook event.</li>
          <li>Chat history. The Ceiling sees the tool call, not the conversation around it.</li>
        </ul>
        <H3>Cryptography</H3>
        <P>Every device has its own P-256 keypair in the Secure Enclave / TPM. The Control Plane's release key signs bundles and receipts; keys rotate every 90 days and are published at a JWKS endpoint per tenant. Evidence records are hash-chained locally on each device; a broken chain is a detection.</P>
        <Callout>The Runtime never has a copy of a customer credential. Credentials belong in the Gateway's broker; the Runtime holds only its device key and the current bundle.</Callout>
      </>
    ),
  },
];

/* ================= gateway docs ================= */

const GATEWAY_DOCS: Section[] = [
  {
    id: "overview",
    title: "Overview",
    render: () => (
      <>
        <P>The Wrapbox Gateway is the piece of software you deploy once on your network, in front of every MCP server, API, cloud CLI and database an agent needs. It has three responsibilities:</P>
        <ul className="my-3 space-y-1.5 list-disc pl-5 text-fg-2">
          <li><B>Virtual MCP server.</B> A single MCP endpoint at <M>{GATEWAY.url}</M> that aggregates upstream servers behind per-team tool views and pins each tool's schema. Agent clients point at the Gateway URL; the Gateway forwards approved calls to the real server.</li>
          <li><B>Forward API proxy.</B> The same endpoint accepts plain HTTP requests to a configured list of upstream hosts, strips any credential the agent supplied and injects the org's real credential from the Gateway's vault.</li>
          <li><B>Credential broker.</B> A short-lived, scoped session token binds every agent session to a device and a person; the Gateway swaps it for the real credential at execution time and never returns the real credential to the device.</li>
        </ul>
        <P>All three sit on the same decision engine and the same policy bundle as the device Runtime — so a rule like "no push to main without approval" is one policy whether the push comes from a laptop shell or from an MCP tool call inside a hosted agent.</P>
      </>
    ),
  },
  {
    id: "install",
    title: "Install",
    render: ({ org }) => (
      <>
        <P>The Gateway ships as a container image. Two shapes: a single container (Docker) for the fast path, and a Helm chart for production Kubernetes.</P>
        <H3>Docker · fast path</H3>
        <CodeBlock file="deploy.sh" lang="bash" code={GATEWAY.docker(org)} />
        <P>The container reads its policy bundle from the Control Plane on start, mounts <M>/etc/wrapbox</M> for local state (rotated logs, cached vault leases), and listens on 8443 for MCP and HTTPS traffic. The <M>WRAPBOX_ENROLL_TOKEN</M> is a one-time secret issued by the Control Plane's Deploy → Downloads page; pass it once, and the Gateway rotates its own credentials on registration.</P>
        <H3>Kubernetes · Helm</H3>
        <CodeBlock file="deploy.sh" lang="bash" code={GATEWAY.helm(org)} />
        <P>The chart runs two replicas by default, expects a Kubernetes secret named <M>wrapbox-enroll</M> with the enrolment token, and exposes an ingress at <M>mcp.{org}.internal</M>. Set <M>ingress.className</M> to your ingress controller. For HA in more than one region, install the chart in each region and point every regional agent client at the local ingress; the Gateways coordinate through the Control Plane.</P>
        <H3>After install</H3>
        <P>The Gateway appears on the Fleet page as soon as its registration is acknowledged. Point agent MCP clients at the Gateway URL — the Runtime rewrites this configuration for every managed agent it discovers.</P>
      </>
    ),
  },
  {
    id: "registration",
    title: "Registration & policy sync",
    render: ({ bundleVersion }) => (
      <>
        <P>Registration is symmetric to device enrolment: the Gateway generates a keypair on first start, presents the enrolment token to the Control Plane, and receives a Gateway id and the current policy bundle URL.</P>
        <P>After the first sync, the Gateway pulls the bundle on the same 30-second heartbeat cadence the Runtime uses. Your tenant is on bundle v{bundleVersion}; the Gateway shows that number on Fleet under its version line, and a publish reaches it in the same window as the devices.</P>
        <Callout>A Gateway that cannot reach the Control Plane keeps enforcing on its cached bundle for up to seven days. Like the Runtime, it fails closed for tier-0 destinations — no receipt can be minted if the bundle expiry has passed.</Callout>
      </>
    ),
  },
  {
    id: "enforcement",
    title: "How enforcement works",
    render: () => (
      <>
        <P>The Gateway enforces at two layers, both remote to the device.</P>
        <H3>Remote · full request semantics</H3>
        <P>Every request that reaches the Gateway is normalized into the same <M>Act</M> the Runtime produces — effect, target, arguments, environment — and evaluated against the same rules. Because the Gateway terminates TLS on the connection to the agent, it sees the full body: an HTTP <M>POST /v1/refunds</M> with an amount, an MCP <M>execute_sql</M> with a query. This is what makes tiered rules like <M>payments.refund</M> or <M>pii.read</M> work in the same shape as on a laptop.</P>
        <H3>Assured · receipts</H3>
        <P>For destinations configured as tier-0 — production deploys, pushes to main, payments — the Gateway attaches a signed <B>receipt</B> to every approved request. The destination verifies the receipt (signature, expiry, action hash, nonce) before it acts. If the Gateway's registration is revoked or its bundle expires, no receipt is minted, and tier-0 destinations refuse the request. The verification middleware is a small library the destination team drops in front of its endpoint; see the <a href="#/docs/gateway/receipts" className="underline underline-offset-2 text-fg">Receipts section</a>.</P>
      </>
    ),
  },
  {
    id: "broker",
    title: "Credential brokering",
    render: () => (
      <>
        <P>The rule is simple: agents hold no long-lived secrets. Every real credential — API key, OAuth refresh token, database password, cloud role — lives in your vault (HashiCorp Vault or AWS Secrets Manager, referenced by id). The Gateway resolves the reference at execution time.</P>
        <H3>Session tokens</H3>
        <P>The Runtime mints a per-session token when an agent starts a task. The token is bound to the device's public key and the user's IdP identity, carries a scope ("stripe:refunds.write", "postgres:claims.read") and expires in minutes. The Gateway validates the token against the Control Plane on the first request of a session, then verifies it locally for the rest of the session's lifetime.</P>
        <H3>Strip-and-replace</H3>
        <P>A request whose payload carries an <M>Authorization: Bearer ...</M> header — because the agent has a leftover key from a previous era, or an attacker poisoned a file — has that header stripped and replaced with the brokered credential at the last hop. The evidence record shows both: the header the agent sent (redacted to a fingerprint) and the header the destination received. A rule matching <M>carries_credentials: true</M> turns this into an alert.</P>
        <H3>Revocation</H3>
        <P>A revoke on a session token is immediate at the Gateway. On the next request in that session, the destination sees no valid token, the Gateway sees no valid session, and the Wrapbox decision is BLOCK. This is independent of the user's own access — the user can keep working; only that agent's session is severed.</P>
      </>
    ),
  },
  {
    id: "receipts",
    title: "Receipts & verification",
    render: () => (
      <>
        <P>A receipt is a compact signed token the Gateway attaches to the request as the <M>Wrapbox-Receipt</M> header (in HTTP) or in the tool-call metadata (in MCP). Its payload:</P>
        <CodeBlock lang="json" code={`{\n  "decision_id": "d-4f81a2",\n  "action_hash": "sha256:c7f4…",\n  "principal":   { "user": "arjun.n", "device": "dk-macbook-pro", "session": "wbs_71b4…" },\n  "effect":      "payment",\n  "policy_id":   "payments.refund",\n  "iat":         1758734801,\n  "exp":         1758735101,\n  "nonce":       "9b3ff2…"\n}`} />
        <P>Signed with the tenant's org key (ES256) whose public half is published at a JWKS endpoint the destination fetches once and caches. Every field is bound to the exact action being approved: change the amount, and the action_hash no longer matches; wait 61 seconds, and the token no longer verifies. Tier-0 destinations are configured to refuse any request without a valid receipt.</P>
        <H3>Verification middleware</H3>
        <P>The Runtime and the Gateway attach; the destination verifies. Verification is a small library: an Express middleware for Node, a <M>net/http</M> middleware for Go, an ASGI middleware for Python, an Envoy <M>ext_authz</M> reference, and a Kubernetes admission webhook. The GitHub App puts the same check in front of every push and merge.</P>
        <Callout tone="review">A device that cannot reach the Control Plane cannot mint a receipt. That single rule is what survives a compromised laptop: the destination refuses the request whether or not the daemon on the device is still speaking.</Callout>
      </>
    ),
  },
  {
    id: "upgrades",
    title: "Upgrades & rollback",
    render: () => (
      <>
        <P>Gateway upgrades are rolling and session-safe.</P>
        <H3>Rollout</H3>
        <P>On Docker, pull the new image and stop the old container; the new one registers as a fresh Gateway id and takes over on next request. On Kubernetes, <M>helm upgrade</M> the same release: the chart's default rolling strategy drains one replica at a time, and existing sessions are held on the old replica for two minutes to allow requests to complete.</P>
        <H3>Rollback</H3>
        <P>Roll back with <M>helm rollback wrapbox &lt;revision&gt;</M> or by pulling the previous image tag. The Gateway keeps every prior bundle for 24 hours; a rolled-back Gateway resumes on the bundle version that was current when it was running before.</P>
      </>
    ),
  },
  {
    id: "uninstall",
    title: "Uninstall",
    render: () => (
      <>
        <P>Draining a Gateway is a two-step operation. First, mark it as draining so it stops accepting new sessions but keeps serving open ones:</P>
        <InlineCmd cmd="wrapbox gateway drain --grace 120s" />
        <P>After the grace window, remove the container or the Helm release:</P>
        <InlineCmd cmd="docker rm -f wrapbox-gateway" />
        <P>Or:</P>
        <InlineCmd cmd="helm uninstall wrapbox --namespace wrapbox" />
        <P>The Control Plane invalidates every session token bound to the removed Gateway, so no agent can reuse a token after the drain window closes. Vault leases open through the Gateway are revoked; the vault itself and the credentials in it are untouched.</P>
      </>
    ),
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    render: () => (
      <>
        <H3>Common failures</H3>
        <ul className="my-3 space-y-2 list-disc pl-5 text-fg-2">
          <li><B>Gateway does not appear on Fleet.</B> The enrolment token expired (they are single-use, 15 minutes). Regenerate on Downloads → Gateway.</li>
          <li><B>401 from a brokered destination.</B> The vault reference id in the policy does not match any entry in the Gateway's vault view; verify the reference on the Broker tab.</li>
          <li><B>Slow first request per session.</B> The Gateway performs an outbound STS or OAuth call the first time a session touches a new credential; subsequent requests reuse the cached lease.</li>
          <li><B>Destination rejects the receipt.</B> Check the destination's JWKS cache — a rotated key needs a minute to reach caches on the far side. <M>wrapbox gateway keyrotate --status</M> prints the current key id.</li>
        </ul>
        <P>For a full snapshot, run <M>wrapbox gateway bundle-report</M> — same shape as the Runtime's report, packaged so support can reproduce without seeing your tenant state.</P>
      </>
    ),
  },
  {
    id: "security",
    title: "Security & privacy",
    render: () => (
      <>
        <P>The Gateway holds two kinds of secrets, and they are both scoped tightly.</P>
        <H3>Session tokens</H3>
        <P>Short-lived (minutes), bound to a device key and a user identity, scoped to the actions the current session needs. They never leave the Gateway process.</P>
        <H3>Vault references</H3>
        <P>The Gateway holds references to your vault, not the credentials themselves. It resolves each reference at execution time, uses the credential once, and never writes it to disk or to a log. Every resolve is an evidence record: which session, which reference, when.</P>
        <H3>What the Gateway sees</H3>
        <P>Full request semantics for every action that traverses it. Bodies are inspected for the classifiers configured in your contract (secret, PII, source code); everything else is recorded as an outline. Because the Gateway terminates TLS, its logs are the strongest evidence in the system — treat them accordingly.</P>
        <Callout>The Gateway never writes a customer secret to disk. It writes references, session tokens (short-lived), evidence records, and the current policy bundle.</Callout>
      </>
    ),
  },
];

const DOC_SETS: Record<"runtime" | "gateway", DocSet> = {
  runtime: {
    id: "runtime",
    title: "Runtime",
    icon: Package,
    intro: "Installed once on every laptop and server. Discovers agents, writes their adapters and enforces at the OS and hook layers.",
    sections: RUNTIME_DOCS,
  },
  gateway: {
    id: "gateway",
    title: "Gateway",
    icon: Container,
    intro: "Installed once on your network. Fronts every MCP server, API, cloud CLI and database with the same engine and the same policy.",
    sections: GATEWAY_DOCS,
  },
};

/* ================= components ================= */

const M = ({ children }: { children: ReactNode }) => <code className="font-mono text-[12px] bg-surface-2 rounded px-1 py-0.5 text-fg">{children}</code>;
const B = ({ children }: { children: ReactNode }) => <span className="font-semibold text-fg">{children}</span>;
const P = ({ children }: { children: ReactNode }) => <p className="my-3 text-[13.5px] leading-relaxed text-fg-2">{children}</p>;
const H3 = ({ children }: { children: ReactNode }) => <h3 className="mt-6 mb-2 text-[15px] font-semibold text-fg">{children}</h3>;
function Callout({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "review" }) {
  return (
    <div className={cn("my-4 rounded-xl border px-4 py-3 text-[12.5px] leading-relaxed", tone === "review" ? "border-review/30 bg-review-soft/40 text-fg" : "border-line bg-surface-2 text-fg-2")}>
      {children}
    </div>
  );
}

/* ================= page ================= */

export function Docs({ setId, sectionId }: { setId?: string; sectionId?: string }) {
  const domain = useStore((s) => s.domain);
  const company = useStore((s) => s.company);
  const fleet = useStore((s) => s.fleet);
  const gateways = useStore((s) => s.gateways);
  const version = useStore((s) => s.version);
  const org = orgFor(domain, company);
  if (!setId || (setId !== "runtime" && setId !== "gateway")) return <DocsIndex />;
  const set = DOC_SETS[setId];
  const ctx: DocCtx = {
    org,
    domain,
    company,
    version: RUNTIME.version,
    bundleVersion: version,
    runtimeOnDevices: fleet.filter((d) => d.state !== "quarantined" && d.runtimeVersion === RUNTIME.version).length,
    totalDevices: fleet.length,
    gatewayLive: gateways.some((g) => g.state === "healthy"),
    gatewayId: gateways[0]?.id,
  };
  const active = set.sections.find((x) => x.id === sectionId) ?? set.sections[0];
  return (
    <div className="mx-auto max-w-[1240px] px-4 lg:px-8 py-8">
      <PageHeader
        eyebrow={`Docs · ${set.title}`}
        title={<span className="flex items-center gap-3"><span className={cn("grid size-9 place-items-center rounded-xl", setId === "runtime" ? "bg-[#1d4ed8]/10 text-[#1d4ed8]" : "bg-[#15803d]/10 text-[#15803d]")}><set.icon className="size-4.5" /></span>{set.title} documentation</span>}
        sub={set.intro}
        right={
          <Button variant="primary" onClick={() => go("/downloads")}>
            <Download className="size-3.5" /> Download {set.title.toLowerCase()}
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="lg:sticky lg:top-4 h-fit">
          <div className="text-[11px] font-semibold text-fg-3 uppercase tracking-wider mb-2 px-2.5">On this doc set</div>
          <ul className="space-y-0.5">
            {set.sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#/docs/${set.id}/${s.id}`}
                  className={cn(
                    "block rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
                    active.id === s.id ? "bg-surface-2 text-fg font-medium border border-line" : "text-fg-2 hover:text-fg hover:bg-surface-2 border border-transparent",
                  )}
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-[11.5px] text-fg-3">
            <div className="flex items-center gap-1.5 text-fg-2 font-medium mb-1"><BookOpen className="size-3.5" /> Other doc set</div>
            <a href={`#/docs/${setId === "runtime" ? "gateway" : "runtime"}`} className="text-accent hover:underline">
              {setId === "runtime" ? "Gateway docs" : "Runtime docs"} <ArrowRight className="inline size-3" />
            </a>
          </div>
        </nav>
        <article className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[11.5px] text-fg-3">
            <a href="#/docs" className="hover:text-fg">Docs</a>
            <span>›</span>
            <a href={`#/docs/${set.id}`} className="hover:text-fg">{set.title}</a>
            <span>›</span>
            <span className="text-fg-2">{active.title}</span>
          </div>
          <h2 className="text-[26px] font-semibold tracking-tight mb-1">{active.title}</h2>
          <div className="prose max-w-none">{active.render(ctx)}</div>
          <SectionNav set={set} activeId={active.id} />
        </article>
      </div>
    </div>
  );
}

function SectionNav({ set, activeId }: { set: DocSet; activeId: string }) {
  const idx = set.sections.findIndex((s) => s.id === activeId);
  const prev = idx > 0 ? set.sections[idx - 1] : null;
  const next = idx < set.sections.length - 1 ? set.sections[idx + 1] : null;
  return (
    <div className="mt-10 pt-5 border-t border-line grid gap-3 sm:grid-cols-2 text-[13px]">
      {prev ? (
        <a href={`#/docs/${set.id}/${prev.id}`} className="rounded-xl border border-line px-4 py-3 hover:border-line-strong">
          <div className="text-[11px] text-fg-3">Previous</div>
          <div className="font-medium">{prev.title}</div>
        </a>
      ) : <span />}
      {next ? (
        <a href={`#/docs/${set.id}/${next.id}`} className="rounded-xl border border-line px-4 py-3 text-right hover:border-line-strong">
          <div className="text-[11px] text-fg-3">Next</div>
          <div className="font-medium">{next.title}</div>
        </a>
      ) : <span />}
    </div>
  );
}

function DocsIndex() {
  return (
    <div className="mx-auto max-w-[1180px] px-4 lg:px-8 py-8">
      <PageHeader
        eyebrow="Deploy · read before you install"
        title="Docs"
        sub="Two doc sets: one for the Runtime you install on every device, one for the Gateway you install on your network. Every command shown here is the same command used on Downloads and in the onboarding wizard."
      />
      <div className="grid gap-5 md:grid-cols-2">
        {(Object.values(DOC_SETS)).map((set) => (
          <a key={set.id} href={`#/docs/${set.id}`} className="group">
            <Card className="p-6 h-full flex flex-col transition-all hover:shadow-card hover:border-line-strong">
              <div className="flex items-start gap-3.5">
                <span className={cn("grid size-11 place-items-center rounded-2xl", set.id === "runtime" ? "bg-[#1d4ed8]/10 text-[#1d4ed8]" : "bg-[#15803d]/10 text-[#15803d]")}><set.icon className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[18px] font-semibold">{set.title}</div>
                  <div className="mt-0.5 text-[12px] text-fg-3">{set.sections.length} sections · release {RUNTIME.version}</div>
                </div>
                <Chip>Read</Chip>
              </div>
              <p className="mt-4 text-[13px] text-fg-2 leading-relaxed">{set.intro}</p>
              <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-fg-3">
                {set.sections.slice(0, 6).map((s) => (
                  <li key={s.id} className="truncate">· {s.title}</li>
                ))}
                {set.sections.length > 6 && <li className="text-fg-2">+{set.sections.length - 6} more</li>}
              </ul>
              <div className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent">
                Open the {set.title.toLowerCase()} docs <ArrowRight className="size-3.5" />
              </div>
            </Card>
          </a>
        ))}
      </div>
      <Card className="mt-6 p-5 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <div className="text-[14px] font-semibold">Ready to install?</div>
          <div className="text-[12.5px] text-fg-3">Every command in the docs is on Downloads too, one click away.</div>
        </div>
        <Button variant="primary" onClick={() => go("/downloads")}><Download className="size-3.5" /> Go to Downloads</Button>
      </Card>
    </div>
  );
}
