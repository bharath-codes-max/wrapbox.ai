// Admin onboarding — "Set up Wrapbox". Seven steps, the same flow as the main
// Wrapbox prototype: Create workspace → Discover agents → Intent contract →
// Connect & roll out → Approvers & alerts → Invite your team → Go live.
// The controller owns step position + the draft; each step commits its part to
// the real store, so every other page reflects what the admin set up.
import { useEffect, useRef, useState } from "react";
import { useAppState, getState, completeAdminOnboarding, switchWorkspace } from "../state/store";
import { SEED_CONTRACTS } from "../model/contracts";
import { SetupLayout, type SetupStep } from "../ui/setup";
import type { AdminDraft, AdminStepProps } from "./onboarding/types";
import { Step1Workspace, Step2Discover, Step3Contract, Step4Rollout } from "./onboarding/admin-steps-a";
import { Step5Approvers, Step6Team, Step7GoLive } from "./onboarding/admin-steps-b";
import { Info } from "lucide-react";
import { ORG } from "../model/org";

export const ADMIN_STEPS: SetupStep[] = [
  { title: "Create workspace", sub: "SSO, company, data region" },
  { title: "Discover agents", sub: "Find what already runs" },
  { title: "Intent contract", sub: "Your rules, from day one" },
  { title: "Connect & roll out", sub: "Runtime, network, gateways" },
  { title: "Approvers & alerts", sub: "Who signs what, where" },
  { title: "Invite your team", sub: "Directory + invites" },
  { title: "Go live", sub: "See the first decision" },
];

const VIEWS = [Step1Workspace, Step2Discover, Step3Contract, Step4Rollout, Step5Approvers, Step6Team, Step7GoLive];
const posKey = (ws: string) => `wrapbox-onboarding-admin:${ws}`;

function initialDraft(): AdminDraft {
  const st = getState();
  const seedIds = new Set(SEED_CONTRACTS.map((c) => c.id));
  return {
    idp: st.org.idp,
    company: st.org.company,
    domain: st.org.domain,
    region: st.org.region,
    provisioned: !!st.org.keyThumb,
    // The scan itself isn't stored, so a resumed wizard never claims one happened.
    ghConnected: false,
    scanned: false,
    categories: st.onboarding.categories,
    contractStart: st.contracts.length === 0 ? null : st.contracts.some((c) => seedIds.has(c.id)) ? "recommended" : "scratch",
    phase: Object.fromEntries(st.onboarding.connected.map((id) => [id, 4])),
    alerts: st.onboarding.alerts,
    synced: st.onboarding.invited.length > 1,
    invitesSent: st.onboarding.invited.length > 1,
  };
}

export function AdminOnboarding({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  // Resume where you left off in this workspace (session-scoped).
  const [pos, setPos] = useState<{ step: number; reached: number }>(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(posKey(getState().workspace)) ?? "null");
      if (v && typeof v.step === "number" && typeof v.reached === "number") return v;
    } catch { /* default */ }
    return { step: 0, reached: 0 };
  });
  useEffect(() => {
    try { sessionStorage.setItem(posKey(s.workspace), JSON.stringify(pos)); } catch { /* session-only */ }
  }, [pos, s.workspace]);

  const [draft, setDraftState] = useState<AdminDraft>(initialDraft);
  // Switching workspace mid-wizard starts from that workspace's saved state.
  useEffect(() => { setDraftState(initialDraft()); }, [s.workspace]);
  // "Start over" (fresh workspace erased while open): back to step 1 with a clean draft.
  const hadWorkspace = useRef(!!s.org.createdAt);
  useEffect(() => {
    if (hadWorkspace.current && !s.org.createdAt) { setDraftState(initialDraft()); setPos({ step: 0, reached: 0 }); }
    hadWorkspace.current = !!s.org.createdAt;
  }, [s.org.createdAt]);
  const setDraft = (patch: Partial<AdminDraft>) => setDraftState((d) => ({ ...d, ...patch }));

  const go = (i: number) => {
    setPos((p) => ({ step: i, reached: Math.max(p.reached, i) }));
    document.querySelector(".main")?.scrollTo({ top: 0 });
  };
  const props: AdminStepProps = {
    n: pos.step + 1,
    total: ADMIN_STEPS.length,
    draft,
    setDraft,
    next: () => go(Math.min(pos.step + 1, ADMIN_STEPS.length - 1)),
    back: pos.step > 0 ? () => go(pos.step - 1) : undefined,
    finish: () => {
      completeAdminOnboarding();
      try { sessionStorage.removeItem(posKey(s.workspace)); } catch { /* ignore */ }
      nav("control");
    },
    nav,
  };
  const View = VIEWS[pos.step];

  return (
    <SetupLayout
      title="Set up Wrapbox"
      persona={`Priya Menon · Admin · ${s.org.company || "new workspace"}`}
      personaUserId="u-priya"
      steps={ADMIN_STEPS}
      step={pos.step}
      reached={pos.reached}
      onStep={(i) => setPos((p) => ({ ...p, step: i }))}
      onExit={() => nav("start")}
    >
      {s.workspace === "demo" && (
        <div className="filter-bar" style={{ marginBottom: 16 }}>
          <span className="row" style={{ gap: 8 }}>
            <Info size={14} />
            You're in the {ORG.short} demo, which is already set up — anything you change here applies to the demo.
          </span>
          <button className="btn btn-sm" onClick={() => { switchWorkspace("fresh"); setPos({ step: 0, reached: 0 }); }}>
            Use a fresh workspace instead
          </button>
        </div>
      )}
      <View {...props} />
    </SetupLayout>
  );
}
