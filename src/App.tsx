import { MotionConfig, motion } from "motion/react";
import { useEffect } from "react";
import { Shell } from "./components/shell";
import { useRoute } from "./lib/router";
import { WORKSPACES, homePath, startLive, switchWorkspace, useStore } from "./lib/store";
import { startCpSync } from "./lib/cp-sync";
import { cpConfigComplete, useCpConfig } from "./lib/cp-config";
import { AgentDetail, AgentsPage } from "./pages/agents";
import { Fleet, FleetDeviceDetail } from "./pages/fleet";
import { Docs } from "./pages/docs";
import { Downloads } from "./pages/downloads";
import { EnrollWizard } from "./pages/enroll";
import { Approvals } from "./pages/approvals";
import { ContractPage } from "./pages/contract";
import { EmployeeHome } from "./pages/employee";
import { Evidence } from "./pages/evidence";
import { FlowsPage } from "./pages/flows";
import { Gateway } from "./pages/gateway";
import { Overview } from "./pages/overview";
import { Locked, Team } from "./pages/team";
import { Welcome } from "./pages/welcome";
import { Start } from "./pages/start";
import { AdminSetup, EmployeeSetup } from "./pages/onboarding";
import { Playground } from "./pages/playground";
import { SettingsPage } from "./pages/settings";
import { AuthPage } from "./pages/auth";
import { Landing } from "./pages/landing";
import { LiveDemo } from "./pages/live";
import { Pitch } from "./pages/pitch";

function LiveEmbed() {
  useEffect(() => { switchWorkspace("live"); }, []);
  return (
    <MotionConfig reducedMotion="user">
      <LiveDemo />
    </MotionConfig>
  );
}
import { useAccount } from "./lib/auth";
import { go } from "./lib/router";

export default function App() {
  const route = useRoute();
  const role = useStore((s) => s.role);
  const theme = useStore((s) => s.theme);
  const workspace = useStore((s) => s.workspace);
  const cpCfg = useCpConfig();
  const account = useAccount();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => startLive(), []);
  useEffect(() => { startCpSync(); }, []);

  const [path, qs] = route.split("?");
  const query = new URLSearchParams(qs ?? "");
  const seg = path.split("/").filter(Boolean);
  const authRoute = seg[0] === "login" || seg[0] === "signup";
  const landing = seg[0] === "landing";
  // The investor pitch is public, like the landing page: no account, no shell.
  const pitch = seg[0] === "pitch";
  // A public route that forces the live workspace and renders just the demo
  // for embedding in an iframe from the pitch deck.
  const liveEmbed = seg[0] === "live-embed";

  const meta = WORKSPACES[workspace];
  const labsRoute = seg[0] === "playground" || seg[0] === "flows";
  // The install-once product has no per-agent pages, no workspace picker and no v1 hub / team pages.
  // Onboarding is kept — in fabric it's the Enrollment wizard, in v1 the existing SetupLayout wizard.
  const v1Route = ["start", "agents", "team"].includes(seg[0] ?? "");
  useEffect(() => {
    if (!account && !authRoute && !landing && !pitch && !liveEmbed) go("/landing");
    else if (account && authRoute) go(homePath());
    else if (labsRoute && !meta.labs) go("/");
    else if (v1Route && meta.fabric) go("/");
    else if (account && workspace === "v2" && !cpConfigComplete(cpCfg) && seg[0] !== "settings" && !authRoute && !landing && !pitch && !liveEmbed) go("/settings");
  }, [account, authRoute, landing, pitch, liveEmbed, labsRoute, v1Route, meta, workspace, cpCfg, path]);

  if (pitch)
    return (
      <MotionConfig reducedMotion="user">
        <Pitch />
      </MotionConfig>
    );

  if (liveEmbed) return <LiveEmbed />;

  if (landing || (!account && !authRoute))
    return (
      <MotionConfig reducedMotion="user">
        <Landing />
      </MotionConfig>
    );

  if (!account || authRoute)
    return (
      <MotionConfig reducedMotion="user">
        <AuthPage mode={seg[0] === "signup" ? "signup" : "login"} />
      </MotionConfig>
    );

  // The Enforcement Playground owns the whole viewport — no Shell, no sidebar.
  if (workspace === "live")
    return (
      <MotionConfig reducedMotion="user">
        <LiveDemo />
      </MotionConfig>
    );

  let page: React.ReactNode;
  switch (seg[0]) {
    case undefined:
      page = meta.fabric ? <Fleet /> : role === "admin" ? <Overview /> : <EmployeeHome />;
      break;
    case "fleet":
      page = seg[1] ? <FleetDeviceDetail key={seg[1]} id={seg[1]} /> : <Fleet />;
      break;
    case "downloads":
      page = <Downloads />;
      break;
    case "docs":
      page = <Docs setId={seg[1]} sectionId={seg[2]} />;
      break;
    case "welcome":
      page = <Welcome />;
      break;
    case "start":
      page = <Start />;
      break;
    case "onboarding":
      page = meta.fabric ? <EnrollWizard key="fabric-enroll" /> : seg[1] === "employee" ? <EmployeeSetup key="emp" /> : <AdminSetup key="admin" />;
      break;
    case "agents":
      page = seg[1] ? <AgentDetail key={seg[1]} id={seg[1]} query={query} /> : <AgentsPage query={query} />;
      break;
    case "flows":
      page = <FlowsPage id={seg[1]} query={query} />;
      break;
    case "contract":
      page = <ContractPage query={query} />;
      break;
    case "playground":
      page = <Playground key={role} />;
      break;
    case "gateway":
      page = role === "admin" ? <Gateway /> : <Locked what={meta.fabric ? "Gateway" : "MCP gateway"} />;
      break;
    case "approvals":
      page = <Approvals />;
      break;
    case "evidence":
      page = <Evidence query={query} />;
      break;
    case "settings":
      page = <SettingsPage />;
      break;
    case "team":
      page = role === "admin" ? <Team /> : <Locked what="Team & devices" />;
      break;
    default:
      page = meta.fabric ? <Fleet /> : <Overview />;
  }

  return (
    <MotionConfig reducedMotion="user">
      <Shell current={path || "/"} focus={seg[0] === "onboarding"}>
        <motion.div key={(seg[0] === "onboarding" ? path : path + role) + workspace} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          {page}
        </motion.div>
      </Shell>
    </MotionConfig>
  );
}
