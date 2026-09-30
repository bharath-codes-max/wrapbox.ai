// The single source of truth for every install command, artifact name and enrolment line in the app.
// Downloads, Docs, admin onboarding, employee onboarding, Fleet cards and invite emails all read from here.
//
// Simulated, but presented in the exact shape a real release would carry:
// - versions and checksums are stable, real-format strings; nothing actually downloads
// - commands and MDM profile keys follow each vendor's published documentation
// - "org" is the tenant slug from workspace state, so every command matches the live tenant

import { orgSlug } from "./contract";
import { RUNTIME_VERSION } from "./fabric";

/** The Runtime and Gateway ship together on the same release train. */
export const RELEASE_VERSION = RUNTIME_VERSION;
export const GATEWAY_URL = "https://mcp.wrapbox.ai";
export const REPO_APT = "deb [signed-by=/usr/share/keyrings/wrapbox.gpg] https://apt.wrapbox.dev/ stable main";
export const REPO_RPM = "https://rpm.wrapbox.dev/wrapbox.repo";

/** Simulated download URL. Clicking one shows a two-step "preparing → ready" toast; nothing is fetched. */
export const downloadUrl = (artifact: string) => `https://get.wrapbox.dev/${RELEASE_VERSION}/${artifact}`;

/** Placeholder-shaped but stable sha256 — the same shape a real release would ship, so verify lines look right. */
const sha = (seed: string) => {
  let h = 2166136261 >>> 0;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  return hex(h) + hex(Math.imul(h, 2246822519) >>> 0) + hex(Math.imul(h, 3266489917) >>> 0) + hex(Math.imul(h ^ 0x5bd1e995, 16777619) >>> 0) + hex(Math.imul(h ^ 0x27d4eb2f, 16777619) >>> 0) + hex(Math.imul(h ^ 0x165667b1, 16777619) >>> 0) + hex(Math.imul(h ^ 0xd35a2b3d, 16777619) >>> 0) + hex(Math.imul(h ^ 0x85ebca77, 16777619) >>> 0);
};

export type Os = "macos" | "windows" | "linux";
export type MdmVendor = "jamf" | "intune" | "kandji";

/* ================= platforms =================
   The Runtime ships on all three desktop and server platforms. Every surface — Downloads, Docs, the
   enrollment wizard, the invite email — reads this table rather than naming platforms itself. */
export interface OsMeta {
  id: Os;
  label: string;
  /** The artifact the platform ships as. */
  artifact: string;
  /** How the Floor is enforced on this platform. */
  coverage: string;
}

export const OS_META: Record<Os, OsMeta> = {
  macos: { id: "macos", label: "macOS", artifact: ".pkg", coverage: "Seatbelt confinement and a Network Extension content filter" },
  linux: { id: "linux", label: "Linux", artifact: "apt / rpm", coverage: "bubblewrap and seccomp, with eBPF attribution" },
  windows: { id: "windows", label: "Windows", artifact: ".msi", coverage: "an isolated account fenced by Windows Filtering Platform rules" },
};

export const OS_ORDER: Os[] = ["macos", "linux", "windows"];

export interface Artifact {
  name: string;
  url: string;
  sha256: string;
  size: string;
}

const artifact = (name: string, size: string): Artifact => ({ name, url: downloadUrl(name), sha256: sha(name), size });

export const RUNTIME = {
  version: RELEASE_VERSION,
  binary: "wrapboxd",
  macos: {
    pkg: artifact(`Wrapbox-Runtime-${RELEASE_VERSION}.pkg`, "24.6 MB"),
    /** The dev-box shell installer: reads the checksum from the release manifest before it runs the pkg. */
    shell: `curl -fsSL https://get.wrapbox.dev/install.sh | sh`,
    verify: (a: Artifact) => `shasum -a 256 ${a.name}`,
    /** Real config keys per Apple's PPPC + system-extension documentation and each MDM vendor's payload catalog. */
    mdm: {
      jamf: {
        vendor: "Jamf Pro",
        steps: [
          "In Jamf Pro, upload Wrapbox-Runtime.pkg as a Package.",
          "Create a Configuration Profile with three payloads: System Extensions (allow ai.wrapbox.runtime.systemext, Endpoint Security), PPPC (Full Disk Access for wrapboxd), and Content Filter (allow ai.wrapbox.runtime.netfilter).",
          "Attach the profile and the package to the smart group of managed Macs.",
          "The Runtime enrols on first heartbeat and appears on Fleet.",
        ],
        profile: {
          filename: "wrapbox-runtime-macos.mobileconfig",
          keys: {
            PayloadIdentifier: "ai.wrapbox.runtime",
            PayloadDisplayName: "Wrapbox Runtime",
            PayloadType: "Configuration",
            PayloadScope: "System",
            AllowedSystemExtensions: { "ai.wrapbox.runtime": ["ai.wrapbox.runtime.systemext"] },
            AllowedNetworkFilterExtensions: { "ai.wrapbox.runtime": ["ai.wrapbox.runtime.netfilter"] },
            Services: { SystemPolicyAllFiles: [{ Identifier: "ai.wrapbox.runtime.wrapboxd", CodeRequirement: "identifier \"ai.wrapbox.runtime.wrapboxd\" and anchor apple generic", Allowed: 1 }] },
          },
        },
      },
      intune: {
        vendor: "Microsoft Intune",
        steps: [
          "In Intune, add a macOS line-of-business app for Wrapbox-Runtime.pkg.",
          "Create a Device Configuration Profile of type \"Custom (mobileconfig)\" and upload the wrapbox-runtime-macos.mobileconfig above.",
          "Assign both to the target group of Macs. Intune deploys the profile before the package on the next check-in.",
          "The Runtime enrols on first heartbeat.",
        ],
      },
      kandji: {
        vendor: "Kandji",
        steps: [
          "In Kandji, add Wrapbox-Runtime.pkg as a Custom App with the audit script Kandji generates.",
          "Add a Custom Profile using the wrapbox-runtime-macos.mobileconfig above.",
          "Assign to the target Blueprint. Kandji installs and reports back on the next agent check-in.",
        ],
      },
    },
  },
  windows: {
    msi: artifact(`WrapboxRuntime-${RELEASE_VERSION}.msi`, "22.1 MB"),
    /** Silent install for MDM and for an elevated shell. */
    shell: `msiexec /i WrapboxRuntime-${RELEASE_VERSION}.msi /quiet`,
    verify: (a: Artifact) => `Get-FileHash -Algorithm SHA256 ${a.name}`,
    /** A Windows Service under LOCAL SYSTEM. Agents run in an isolated local account fenced by
     *  machine-wide WFP rules, with NTFS ACEs on the working tree. No kernel driver. */
    intune: {
      vendor: "Microsoft Intune",
      steps: [
        'In Intune, add a Windows app of type "Line-of-business app" and upload WrapboxRuntime.msi.',
        "Set the install context to System and the install command to msiexec /i WrapboxRuntime.msi /quiet.",
        "Assign to the target device group. Intune installs on the next device check-in.",
        "The Runtime enrols on first heartbeat and appears on Fleet.",
      ],
    },
  },
  linux: {
    apt: `sudo apt update && sudo apt install wrapbox-runtime`,
    rpm: `sudo dnf install wrapbox-runtime`,
    repoApt: REPO_APT,
    repoRpm: REPO_RPM,
    tarball: artifact(`wrapbox-runtime-${RELEASE_VERSION}-linux-x86_64.tar.gz`, "18.7 MB"),
    verify: (a: Artifact) => `sha256sum ${a.name}`,
    systemd: `systemctl status wrapboxd`,
  },
  /** Enrolment is the same on every OS after install. `--org` binds the device to the tenant. */
  enroll: (org: string) => `wrapbox enroll --org ${org}`,
  doctor: `wrapbox doctor`,
};

export const GATEWAY = {
  version: RELEASE_VERSION,
  image: `ghcr.io/wrapbox/gateway:${RELEASE_VERSION}`,
  imageDigest: `sha256:${sha("gateway-" + RELEASE_VERSION).slice(0, 64)}`,
  url: GATEWAY_URL,
  helmChart: `oci://ghcr.io/wrapbox/charts/gateway`,
  helmVersion: RELEASE_VERSION,
  /** The fast path: a single container. Reads its policy bundle from the Control Plane on start. */
  docker: (org: string) =>
    `docker run -d \\
  --name wrapbox-gateway \\
  -p 443:8443 \\
  -e WRAPBOX_ORG=${org} \\
  -e WRAPBOX_ENROLL_TOKEN=$WRAPBOX_ENROLL_TOKEN \\
  -v /etc/wrapbox:/etc/wrapbox \\
  ghcr.io/wrapbox/gateway:${RELEASE_VERSION}`,
  /** The enterprise path: a Helm chart with HA replicas, an ingress and a Kubernetes secret for vault access. */
  helm: (org: string) =>
    `helm install wrapbox oci://ghcr.io/wrapbox/charts/gateway \\
  --version ${RELEASE_VERSION} \\
  --namespace wrapbox --create-namespace \\
  --set org=${org} \\
  --set enrollTokenSecret=wrapbox-enroll \\
  --set replicas=2 \\
  --set ingress.host=mcp.${org}.internal`,
  verify: `docker image inspect ghcr.io/wrapbox/gateway:${RELEASE_VERSION} --format '{{.Id}}'`,
};

/** Everything an admin needs to hand off to IT for a Jamf / Intune / Kandji rollout, in one place. */
export const MDM_ORDER: MdmVendor[] = ["jamf", "intune", "kandji"];

/** The Runtime's install for a given OS: what to run, what to verify, and the enrolment line.
 *  `installOnly` is what an engineer runs to get the Runtime onto the machine; enrolment is its own step. */
export function runtimeInstall(os: Os, org: string) {
  const enroll = RUNTIME.enroll(org);
  switch (os) {
    case "macos":
      return { artifact: RUNTIME.macos.pkg, install: `sudo installer -pkg ${RUNTIME.macos.pkg.name} -target /`, installOnly: RUNTIME.macos.shell, oneLiner: `${RUNTIME.macos.shell} && ${enroll}`, verify: RUNTIME.macos.verify(RUNTIME.macos.pkg), enroll };
    case "linux":
      return { artifact: RUNTIME.linux.tarball, install: RUNTIME.linux.apt, installOnly: RUNTIME.linux.apt, oneLiner: `${RUNTIME.linux.apt} && ${enroll}`, verify: RUNTIME.linux.verify(RUNTIME.linux.tarball), enroll };
    case "windows":
      return { artifact: RUNTIME.windows.msi, install: RUNTIME.windows.shell, installOnly: RUNTIME.windows.shell, oneLiner: `${RUNTIME.windows.shell} && ${enroll}`, verify: RUNTIME.windows.verify(RUNTIME.windows.msi), enroll };
  }
}

/** Guess the viewer's OS for the default tab. */
export function guessOs(): Os {
  if (typeof navigator === "undefined") return "macos";
  const p = navigator.platform + " " + navigator.userAgent;
  return /Win/.test(p) ? "windows" : /Linux|X11/.test(p) && !/Android/.test(p) ? "linux" : "macos";
}

export const orgFor = (domain: string, company?: string) => orgSlug(domain, company);
