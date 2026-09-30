// Policy Simulator / Shadow Mode — "if this policy had been in force during
// these events, what would have happened?" Replays the company's own recorded
// history (and the scenario library) through the real Core Brain under the
// current rules and under a proposed set. A preview only: nothing is enforced
// or recorded from this page — changes become real in Intent Studio.
import { useMemo, useState, type ReactNode } from "react";
import { useAppState, shadowEvaluate } from "../state/store";
import { PageHead, DecisionChip, Chip, SimNote, Avatar, timeAgo, PageTabs, usePaged, Pager, EntityCard, CardGrid, FilterBar, useCardFilters } from "../ui/kit";
import { SCENARIOS, scenarioById, type Scenario } from "../engine/scenarios";
import { canActivate } from "../engine/coverage";
import { describe } from "../ui/describe";
import { userById } from "../model/org";
import type { Decision, IntentContract, SimulationEvent } from "../model/types";
import { History, Library, GitCompare, ShieldAlert, ArrowRight, Info } from "lucide-react";
import { DESKTOP_SHELL } from "../ui/shell";

type Source = "history" | "library";

interface Row {
  key: string;
  title: string;
  sub: string;
  user?: string;
  current: Decision;
  prop: Decision;
}

const DECS = ["ALLOW", "CONSTRAIN", "REVIEW", "BLOCK"] as Decision[];
const DTONE: Record<string, string> = { ALLOW: "allow", CONSTRAIN: "constrain", REVIEW: "review", BLOCK: "block" };

export function PolicySimulator({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  const [source, setSource] = useState<Source>("history");
  const [removed, setRemoved] = useState<Set<string>>(new Set()); // clause ids dropped from ACTIVE contracts
  const [added, setAdded] = useState<Set<string>>(new Set()); // inactive contract ids switched on in the preview

  const flip = (set: Set<string>, id: string, apply: (n: Set<string>) => void) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    apply(n);
  };

  const active = s.contracts.filter((c) => c.status === "ACTIVE");
  const inactive = s.contracts.filter((c) => c.status !== "ACTIVE");

  // The proposed rule set: active contracts minus unticked rules, plus any
  // switched-off contracts the admin wants to try switching on.
  const proposed: IntentContract[] = useMemo(
    () =>
      s.contracts.map((c) => {
        if (c.status === "ACTIVE") return { ...c, clauses: c.clauses.filter((cl) => !removed.has(cl.id)) };
        return added.has(c.id) ? { ...c, status: "ACTIVE" as const } : c;
      }),
    [s.contracts, removed, added]
  );

  // Your own history: every recorded action that came from a known scenario.
  const history = useMemo(
    () => s.events.filter((e) => e.scenario && scenarioById(e.scenario)).sort((a, b) => b.timestamp - a.timestamp),
    [s.events]
  );

  const rows: Row[] = useMemo(() => {
    if (source === "history") {
      return history.map((e: SimulationEvent) => {
        const sc = scenarioById(e.scenario!) as Scenario;
        return {
          key: e.id,
          title: describe(e),
          sub: `${userById(e.user)?.name ?? e.user} · ${timeAgo(e.timestamp)}`,
          user: e.user,
          current: shadowEvaluate(sc, s.contracts),
          prop: shadowEvaluate(sc, proposed),
        };
      });
    }
    return SCENARIOS.map((sc) => ({
      key: sc.id,
      title: sc.title,
      sub: sc.narrative,
      current: shadowEvaluate(sc, s.contracts),
      prop: shadowEvaluate(sc, proposed),
    }));
  }, [source, history, s.contracts, s.kernel, proposed]);

  const count = (which: "current" | "prop", d: Decision) => rows.filter((r) => r[which] === d).length;
  const changed = rows.filter((r) => r.current !== r.prop);
  const weakened = changed.filter((r) => r.prop === "ALLOW" && r.current !== "ALLOW");
  const edits = removed.size + added.size;

  const orderedRows = [...changed, ...rows.filter((r) => r.current === r.prop)];

  // Replay table pagination — back to page 1 whenever the source or the proposal changes.
  const pageKey = `${source}|${[...removed].sort().join(",")}|${[...added].sort().join(",")}`;
  const decOpts = DECS.map((d) => ({ value: d, label: d }));
  const rf = useCardFilters(orderedRows, {
    search: (r) => `${r.title} ${r.sub}`,
    filters: [
      { id: "change", label: "Change", get: (r) => (r.current !== r.prop ? "changed" : "unchanged"),
        options: [{ value: "changed", label: "Changed" }, { value: "unchanged", label: "Unchanged" }] },
      { id: "today", label: "Decision today", get: (r) => r.current, options: decOpts },
      { id: "prop", label: "With proposal", get: (r) => r.prop, options: decOpts },
    ],
  });
  const paged = usePaged(rf.filtered, 8, `${pageKey}|${rf.resetKey}`);

  // One-line intro at the top of each tab (the tab label carries the act number and title).
  const tabIntro = (sub: string, right?: ReactNode) => (
    <div className="section-head" style={{ alignItems: "center" }}>
      <div className="section-sub" style={{ marginTop: 0 }}>{sub}</div>
      {right && <div className="row" style={{ flexShrink: 0 }}>{right}</div>}
    </div>
  );

  // Proportional decision-mix bar + legend — the visual before/after contrast.
  const renderDist = (which: "current" | "prop") => (
    <>
      <div className="decision-track" style={{ height: 34, borderRadius: 9 }}>
        {rows.length === 0 ? (
          <div className="decision-seg" style={{ flex: 1, background: "var(--surface-3)" }} />
        ) : (
          DECS.map((d) => {
            const n = count(which, d);
            return n ? (
              <div
                key={d}
                className="decision-seg"
                title={`${d} · ${n}`}
                style={{ flex: `${n} 0 0`, background: `var(--${DTONE[d]})` }}
              />
            ) : null;
          })
        )}
      </div>
      <div className="decision-legend" style={{ gap: "8px 22px", marginTop: 12 }}>
        {DECS.map((d) => (
          <div key={d} className="decision-leg" style={{ cursor: "default" }}>
            <span className="dot" style={{ background: `var(--${DTONE[d]})` }} />
            <span className="n tnum">{count(which, d)}</span>
            <span className="lbl">{d}</span>
          </div>
        ))}
      </div>
    </>
  );

  // The prototype lays the three acts out as columns (propose · impact · apply); the
  // decks keep them as tabs, so the tab markup below is unchanged.
  const narrow = DESKTOP_SHELL;
  const proposeIntro = "Untick a rule to try switching it off. Tick a switched-off contract to try switching it on.";
  const impactIntro = "Every action replayed under your rules today and under your proposal.";
  const applyIntro = "This page never changes enforcement. When you're happy with the result, switch the rules on or off in Intent Studio.";
  const editsChip = edits ? (
    <Chip tone="review">
      {edits} change{edits === 1 ? "" : "s"} staged
    </Chip>
  ) : (
    <span className="faint small">No changes staged</span>
  );
  const sourceTabs = (
    <div className="tabs" style={{ marginBottom: 0, borderBottom: "none" }}>
      <button className={`tab ${source === "history" ? "active" : ""}`} onClick={() => setSource("history")}>
        <History size={14} /> Your history <span className="tab-count tnum">{history.length}</span>
      </button>
      <button className={`tab ${source === "library" ? "active" : ""}`} onClick={() => setSource("library")}>
        <Library size={14} /> Scenario library <span className="tab-count tnum">{SCENARIOS.length}</span>
      </button>
    </div>
  );

  const proposeBody = (
      <div>
        {!narrow && tabIntro(proposeIntro, editsChip)}

        {active.length === 0 && inactive.length === 0 && (
          <div className="card empty">
            No contracts to compare yet. Write one in Intent Studio, then return here to test changes against your history.
          </div>
        )}

        <CardGrid cols={narrow ? 1 : 2}>
          {active.map((c) => (
            <EntityCard
              key={c.id}
              eyebrow="Active contract"
              title={c.name}
              status={<Chip tone="allow">ACTIVE</Chip>}
              fields={[
                { label: "Rules", value: <span className="tnum">{c.clauses.length - c.clauses.filter((cl) => removed.has(cl.id)).length} of {c.clauses.length} on in preview</span> },
              ]}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {c.clauses.map((cl) => {
                  const off = removed.has(cl.id);
                  return (
                    <label
                      key={cl.id}
                      className="rule-item"
                      style={{ cursor: "pointer", gap: 10, opacity: off ? 0.6 : 1, flexWrap: "nowrap", alignItems: "flex-start" }}
                    >
                      <input
                        type="checkbox"
                        checked={!off}
                        onChange={() => flip(removed, cl.id, setRemoved)}
                        style={{ marginTop: 2, flexShrink: 0 }}
                      />
                      <span
                        className="rule-text"
                        style={off ? { flex: 1, textDecoration: "line-through", color: "var(--fg-3)" } : { flex: 1 }}
                      >
                        {cl.text}
                      </span>
                      <DecisionChip d={cl.effect} small />
                    </label>
                  );
                })}
              </div>
            </EntityCard>
          ))}

          {inactive.map((c) => (
            <EntityCard
              key={c.id}
              selected={added.has(c.id)}
              eyebrow="Switched-off contract"
              title={c.name}
              status={<Chip tone={added.has(c.id) ? "constrain" : "neutral"}>{added.has(c.id) ? "ON IN PREVIEW" : c.status}</Chip>}
              action={
                <label className="row small" style={{ gap: 6, cursor: "pointer", flexWrap: "nowrap" }}>
                  <input type="checkbox" checked={added.has(c.id)} onChange={() => flip(added, c.id, setAdded)} />
                  Try on
                </label>
              }
              fields={[
                { label: "Rules", value: <span className="tnum">{c.clauses.length}</span> },
              ]}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {c.clauses.map((cl) => (
                  <div
                    key={cl.id}
                    className="row small faint"
                    style={{ gap: 8, alignItems: "flex-start", flexWrap: "nowrap" }}
                  >
                    <span style={{ flex: 1 }}>{cl.text}</span>
                    <DecisionChip d={cl.effect} small />
                  </div>
                ))}
              </div>
              {!canActivate(c) && (
                <div
                  className="row small"
                  style={{ gap: 7, marginTop: 12, color: "var(--warn)", alignItems: "flex-start", flexWrap: "nowrap" }}
                >
                  <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>Preview only — this contract can't really be switched on yet (a skill it needs is missing).</span>
                </div>
              )}
            </EntityCard>
          ))}
        </CardGrid>
      </div>
  );

  const impactBody = (
      <div>
        {!narrow && tabIntro(impactIntro, sourceTabs)}

        {/* Before / after decision-mix — same width, side by side, for a clean diff */}
        <div className="card">
          <div className="spread" style={{ marginBottom: 20 }}>
            <div className="row" style={{ gap: 9 }}>
              <GitCompare size={16} style={{ color: "var(--accent)" }} />
              <b>Impact preview</b>
              <span className="faint small">
                {source === "history" ? "across your recorded history" : "across the scenario library"}
              </span>
            </div>
            <span className={`chip ${changed.length ? "c-review" : "c-allow"}`} style={{ fontSize: 11 }}>
              {changed.length} of {rows.length} outcomes change
            </span>
          </div>

          <div className={narrow ? "grid" : "grid g2"} style={{ gap: narrow ? "20px" : "24px 40px" }}>
            <div>
              <div className="spread" style={{ marginBottom: 10 }}>
                <b className="small">Your rules today</b>
                <span className="faint small">what Wrapbox enforces now</span>
              </div>
              {renderDist("current")}
            </div>
            <div>
              <div className="spread" style={{ marginBottom: 10 }}>
                <b className="small">With your proposal</b>
                <Chip tone={changed.length ? "review" : "allow"}>{changed.length} would change</Chip>
              </div>
              {renderDist("prop")}
            </div>
          </div>
        </div>

        {weakened.length > 0 && (
          <div className="card" style={{ marginTop: 16, borderColor: "var(--bad)" }}>
            <div className="row" style={{ alignItems: "flex-start", gap: 10, flexWrap: "nowrap" }}>
              <ShieldAlert size={18} style={{ color: "var(--bad)", flexShrink: 0, marginTop: 1 }} />
              <div className="small dim" style={{ lineHeight: 1.55 }}>
                <b style={{ color: "var(--bad)" }}>Heads up:</b> {weakened.length} action{weakened.length === 1 ? " that is" : "s that are"}{" "}
                protected today would simply be <b>allowed</b>. Safety Kernel rules still apply either way — for example, secret
                keys stay blocked even if every company rule is switched off.{" "}
                <a onClick={() => nav("safety")}>Safety Kernel</a>
              </div>
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="card empty" style={{ marginTop: 16 }}>
            No recorded actions to replay yet — run something in the Simulation Lab.
          </div>
        ) : (
        <>
        <div style={{ marginTop: 16 }}>
          <FilterBar {...rf.bar} placeholder={source === "history" ? "Search what happened…" : "Search scenarios…"} />
        </div>
        {rf.filtered.length === 0 ? (
          <div className="card empty">No replayed actions match these filters.</div>
        ) : (
          <CardGrid cols={narrow ? 1 : 2}>
            {paged.rows.map((r) => {
              const isChanged = r.current !== r.prop;
              const isWeakened = isChanged && r.prop === "ALLOW" && r.current !== "ALLOW";
              return (
                <EntityCard
                  key={r.key}
                  tone={isWeakened ? "block" : isChanged ? "review" : undefined}
                  icon={r.user ? <Avatar userId={r.user} size={26} /> : <span className="stat-icon"><Library size={15} /></span>}
                  eyebrow={r.user ? r.sub : "Scenario library"}
                  title={r.title}
                  status={
                    <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <DecisionChip d={r.current} small />
                      {isChanged ? <ArrowRight size={14} style={{ color: "var(--review)" }} /> : <span className="faint">=</span>}
                      <DecisionChip d={r.prop} small />
                    </span>
                  }
                  fields={[
                    { label: "Today", value: <DecisionChip d={r.current} small /> },
                    { label: "With proposal", value: <DecisionChip d={r.prop} small /> },
                    { label: "Change", value: isWeakened
                      ? <Chip tone="block">weakened — would be allowed</Chip>
                      : isChanged ? <Chip tone="review">changes</Chip> : <span className="faint">no change</span> },
                    ...(r.user ? [] : [{ label: "Scenario", value: <span className="dim">{r.sub}</span> }]),
                  ]}
                />
              );
            })}
          </CardGrid>
        )}
        <Pager {...paged} />
        <div className="small faint" style={{ marginTop: 8 }}>Actions that would change are listed first.</div>
        </>
        )}
      </div>
  );

  const applyLegacy = (
      <div>
        {tabIntro(applyIntro)}
        <div className="card">
          <div className="spread" style={{ gap: 16 }}>
            <div className="small dim" style={{ lineHeight: 1.55, maxWidth: 620 }}>
              Nothing here is enforced or recorded. Intent Studio is where a proposed change becomes a real rule.
            </div>
            <button className="btn btn-primary" onClick={() => nav("intent")}>
              Open Intent Studio <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
  );

  if (narrow) {
    // Column 3 summarises exactly what is staged in the preview — every line is read
    // from the same removed/added sets the replay above runs on.
    const stagedOff = active.flatMap((c) => c.clauses.filter((cl) => removed.has(cl.id)).map((cl) => ({ c, cl })));
    const stagedOn = inactive.filter((c) => added.has(c.id));
    const colHead = (n: number, title: string, sub: string, right?: ReactNode, count?: ReactNode) => (
      <div className="sim-col-head">
        <div className="sim-col-title">
          <span className="sim-col-n">{n}</span>
          {title}
          {count !== undefined && <span className="tab-count tnum">{count}</span>}
        </div>
        <div className="section-sub">{sub}</div>
        {right && <div className="sim-col-right">{right}</div>}
      </div>
    );
    return (
      <div className="page page-wide">
        <PageHead
          eyebrow="Policy"
          title="Policy Simulator"
          sub="Try a rule change safely: see what would have happened across your company's real history before you switch anything on or off. This page is a preview — nothing is enforced or recorded here."
          right={<SimNote>Replays run through the live Core Brain — nothing is recorded</SimNote>}
        />
        <div className="sim-cols">
          <section className="sim-col" aria-label="1 · Propose a change">
            {colHead(1, "Propose a change", proposeIntro, editsChip, edits)}
            {proposeBody}
          </section>
          <section className="sim-col" aria-label="2 · See what would happen">
            {colHead(2, "See what would happen", impactIntro, sourceTabs, changed.length)}
            {impactBody}
          </section>
          <section className="sim-col sim-col-apply" aria-label="3 · Make it real">
            {colHead(3, "Make it real", applyIntro)}
            <div className="card sim-apply">
              <div className="sim-apply-label">Staged in this preview</div>
              {edits === 0 ? (
                <div className="small dim" style={{ lineHeight: 1.55 }}>Nothing staged yet — untick a rule or try a switched-off contract in column 1.</div>
              ) : (
                <ul className="sim-staged">
                  {stagedOff.map(({ c, cl }) => (
                    <li key={cl.id}>
                      <Chip tone="neutral">Off</Chip>
                      <span>{cl.text}<span className="faint"> · {c.name}</span></span>
                    </li>
                  ))}
                  {stagedOn.map((c) => (
                    <li key={c.id}>
                      <Chip tone="constrain">On</Chip>
                      <span>{c.name}<span className="faint"> · {c.clauses.length} rule{c.clauses.length === 1 ? "" : "s"}</span></span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="divider" style={{ margin: "16px 0" }} />
              <dl className="kv sim-apply-kv">
                <dt>Outcomes that change</dt><dd className="tnum">{changed.length} of {rows.length}</dd>
                <dt>Protection weakened</dt><dd className="tnum" style={weakened.length ? { color: "var(--bad)" } : undefined}>{weakened.length}</dd>
              </dl>
              <div className="small dim" style={{ lineHeight: 1.55, marginTop: 16 }}>
                Nothing here is enforced or recorded. Intent Studio is where a proposed change becomes a real rule.
              </div>
              <button className="btn btn-primary" style={{ marginTop: 14, width: "100%" }} onClick={() => nav("intent")}>
                Open Intent Studio <ArrowRight size={14} />
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow="Policy"
        title="Policy Simulator"
        sub="Try a rule change safely: see what would have happened across your company's real history before you switch anything on or off. This page is a preview — nothing is enforced or recorded here."
        right={<SimNote>Replays run through the live Core Brain — nothing is recorded</SimNote>}
      />

      <PageTabs
        storageKey="simulator"
        tabs={[
          { id: "propose", label: "1 · Propose a change", count: edits, content: proposeBody },
          { id: "impact", label: "2 · See what would happen", count: changed.length, content: impactBody },
          { id: "apply", label: "3 · Make it real", content: applyLegacy },
        ]}
      />
    </div>
  );
}
