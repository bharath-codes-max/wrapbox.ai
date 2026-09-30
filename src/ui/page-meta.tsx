import type { ReactNode } from "react";
import {
  Bot, BrainCircuit, ChevronRight, CirclePlay, FileCheck2, FlaskConical, Hand, KeyRound, LayoutGrid,
  ListChecks, ListTree, Plug, Rocket, ScrollText, Settings as SettingsIcon, ShieldCheck, Siren, Table2,
  Timer, Waypoints, type LucideIcon,
} from "lucide-react";

/** Gradient circles sampled from the reference timeline (light top-left → dark bottom-right). */
export type PageTone = "blue" | "amber" | "green" | "teal" | "gray" | "red" | "cyan" | "lime";

interface PageMeta { group: string; label: string; icon: LucideIcon; tone: PageTone }

const PAGES: Record<string, PageMeta> = {
  start: { group: "Wrapbox", label: "Get started", icon: Rocket, tone: "green" },
  control: { group: "Overview", label: "Control Room", icon: LayoutGrid, tone: "blue" },
  live: { group: "Activity", label: "Live Actions", icon: ListTree, tone: "amber" },
  agents: { group: "Activity", label: "Agents", icon: Bot, tone: "teal" },
  tasks: { group: "Activity", label: "Tasks", icon: ListChecks, tone: "green" },
  intent: { group: "Policy", label: "Intent Studio", icon: FileCheck2, tone: "blue" },
  safety: { group: "Policy", label: "Safety Kernel", icon: ShieldCheck, tone: "red" },
  simulator: { group: "Policy", label: "Policy Simulator", icon: FlaskConical, tone: "cyan" },
  reviews: { group: "Authorization", label: "Review Center", icon: Hand, tone: "amber" },
  standing: { group: "Authorization", label: "Standing Permissions", icon: Timer, tone: "teal" },
  breakglass: { group: "Authorization", label: "Break Glass", icon: Siren, tone: "red" },
  coverage: { group: "Visibility", label: "Coverage Map", icon: Table2, tone: "lime" },
  trust: { group: "Visibility", label: "Trust Graph", icon: Waypoints, tone: "cyan" },
  evidence: { group: "Visibility", label: "Evidence", icon: ScrollText, tone: "gray" },
  simlab: { group: "Simulation", label: "Simulation Lab", icon: CirclePlay, tone: "lime" },
  integrations: { group: "System", label: "Integrations", icon: Plug, tone: "blue" },
  vault: { group: "System", label: "Token Vault", icon: KeyRound, tone: "amber" },
  brain: { group: "System", label: "Core Brain", icon: BrainCircuit, tone: "gray" },
  settings: { group: "Workspace", label: "Settings", icon: SettingsIcon, tone: "gray" },
};

export function currentPage(): PageMeta | undefined {
  if (typeof window === "undefined") return undefined;
  return PAGES[window.location.hash.replace(/^#\/?/, "").split("/")[0] || "start"];
}

export function Breadcrumb({ meta, title }: { meta: PageMeta; title?: string }) {
  const trail: ReactNode[] = ["Wrapbox"];
  if (meta.group !== "Wrapbox") trail.push(meta.group);
  trail.push(title ?? meta.label);
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {trail.map((t, i) => (
        <span key={i} className="crumb">
          {i > 0 && <ChevronRight size={12} className="crumb-sep" aria-hidden="true" />}
          <span className={i === trail.length - 1 ? "crumb-cur" : ""} aria-current={i === trail.length - 1 ? "page" : undefined}>{t}</span>
        </span>
      ))}
    </nav>
  );
}

export function PageIcon({ meta, size = 32 }: { meta: PageMeta; size?: number }) {
  const Icon = meta.icon;
  return (
    <span className={`page-icon tone-${meta.tone}`} style={{ width: size, height: size }} aria-hidden="true">
      <Icon size={Math.round(size * 0.5)} strokeWidth={2.2} />
    </span>
  );
}
