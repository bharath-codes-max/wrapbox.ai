import { AGENTS, CATEGORIES, agentsIn, type Agent } from "../data/agents";
import { SCENARIOS, scenarioFor } from "../data/scenarios";
import { FlowRunner } from "../components/runner";
import { Logo, PageHeader, cn } from "../components/ui";
import { go } from "../lib/router";
import { useStore } from "../lib/store";

export function FlowsPage({ id, query }: { id?: string; query: URLSearchParams }) {
  const connected = useStore((s) => s.connected);
  const scenario = SCENARIOS[id ?? "cli"] ?? SCENARIOS.cli;
  const cat = CATEGORIES.find((c) => c.id === scenario.category)!;
  const pool = agentsIn(cat.id).filter((a) => (cat.id === "mcp" ? scenarioFor(a).id === scenario.id : true));
  const agent: Agent = AGENTS.find((a) => a.id === query.get("agent") && pool.includes(a)) ?? pool.find((a) => connected[a.id]) ?? pool[0];

  return (
    <div className="mx-auto max-w-[1280px] px-4 lg:px-8 py-8">
      <PageHeader
        eyebrow="End-to-end, per platform"
        title="Happy flows"
        sub="One story per agent platform. Pick a platform, pick the agent that performs it, press Run — then approve, tamper and replay to see the permit hold."
      />
      <div className="-mx-1 mb-5 overflow-x-auto scroll-thin">
        <div className="flex gap-2 px-1 pb-1 min-w-max">
          {CATEGORIES.map((c) => {
            const active = c.id === cat.id;
            return (
              <button
                key={c.id}
                onClick={() => go(`/flows/${c.scenario}`)}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all",
                  active ? "border-fg bg-surface shadow-card" : "border-line bg-surface hover:border-line-strong",
                )}
              >
                <div className="flex -space-x-1.5">
                  {agentsIn(c.id)
                    .slice(0, 3)
                    .map((a) => (
                      <Logo key={a.id} name={a.logo} bleed={a.bleed} size={20} rounded="rounded-full" className="ring-2 ring-surface" />
                    ))}
                </div>
                <div>
                  <div className="font-mono text-[10px] text-fg-3">0{c.n}</div>
                  <div className={cn("text-[12.5px] font-medium whitespace-nowrap", active ? "text-fg" : "text-fg-2")}>{c.name}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {cat.id === "mcp" && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-fg-3 mr-1">MCP server:</span>
          {agentsIn("mcp").map((a) => {
            const s = scenarioFor(a);
            return (
              <button
                key={a.id}
                onClick={() => go(`/flows/${s.id}?agent=${a.id}`)}
                className={cn("flex items-center gap-1.5 rounded-full border h-7 pl-1 pr-2.5 text-[12px]", s.id === scenario.id ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-2 hover:border-line-strong")}
              >
                <Logo name={a.logo} size={20} rounded="rounded-full" /> {a.vendor}
              </button>
            );
          })}
        </div>
      )}

      <FlowRunner
        key={scenario.id + agent.id}
        scenario={scenario}
        agent={agent}
        picker={
          cat.id !== "mcp" && pool.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-fg-3 mr-1">Performed by:</span>
              {pool.map((a) => (
                <button
                  key={a.id}
                  onClick={() => go(`/flows/${scenario.id}?agent=${a.id}`)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border h-7 pl-1 pr-2.5 text-[12px] transition-colors",
                    a.id === agent.id ? "border-accent bg-accent-soft text-accent" : "border-line text-fg-2 hover:border-line-strong",
                  )}
                >
                  <Logo name={a.logo} bleed={a.bleed} size={20} rounded="rounded-full" /> {a.name}
                  {!connected[a.id] && <span className="text-[10.5px] text-fg-3">· not connected</span>}
                </button>
              ))}
              <span className="text-[11.5px] text-fg-3">Same rule, same decision — each agent receives it in its own format.</span>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
