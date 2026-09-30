// Shared contract between the admin onboarding controller and its step views.
// The draft is the wizard's working copy; each step COMMITS to the real store
// at its commit point (provision, continue, publish, connect, run), so every
// other page reflects what the admin actually did.
import type { AlertPrefs, Idp, Region } from "../../state/store";
import type { AgentKind } from "../../model/rollout";

export interface AdminDraft {
  // Step 1 — workspace
  idp: Idp;
  company: string;
  domain: string;
  region: Region;
  provisioned: boolean;
  // Step 2 — discovery (GitHub connection + scan are simulated; the agents found are the org's real registry)
  ghConnected: boolean;
  scanned: boolean;
  categories: AgentKind[];
  // Step 3 — contract
  contractStart: null | "recommended" | "scratch";
  // Step 4 — rollout (target id -> phase 0..4; 4 = connected)
  phase: Record<string, number>;
  // Step 5 — approvers & alerts
  alerts: AlertPrefs;
  // Step 6 — team
  synced: boolean;
  invitesSent: boolean;
}

export interface AdminStepProps {
  n: number;                 // 1-based step number
  total: number;
  draft: AdminDraft;
  setDraft: (patch: Partial<AdminDraft>) => void;
  next: () => void;
  back?: () => void;
  finish: () => void;        // Step 7 only: marks onboarding done and opens the Control Room
  nav: (r: string) => void;
}
