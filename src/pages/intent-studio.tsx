// Intent Studio — natural-language Intent Contracts plus compiled machine view,
// coverage status, simulation and activation. Includes Policy Autopilot
// (recommend only — never silently activates wider authority).
import { useState } from "react";
import { useAppState, upsertContract, setContractStatus, setAutopilotStatus, acceptAutopilot, markAutopilotModified } from "../state/store";
import { PageHead, SectionHead, Chip, StatusChip, SimNote, Drawer, DecisionChip, MetricBar, Avatar, PageTabs, EntityCard, CardGrid, FilterBar, Pager, useCardFilters, usePaged } from "../ui/kit";
import { CAPABILITIES } from "../model/registries";
import { userById } from "../model/org";
import type { ContractClause } from "../model/types";
import { draftClauses, coverageRollup } from "../engine/drafter";
import { contractCoverage, destinationText } from "../engine/coverage";
import { FileText, Sparkles, Wand2, ArrowRight } from "lucide-react";


/** A rule's conditions in plain words: what, where to, and only-in (context). */
function ClauseFacts({ cl }: { cl: ContractClause }) {
  const env = cl.environments?.length ? cl.environments.join(", ") : "any environment";
  return (
    <dl className="clause-facts">
      <dt>What</dt>
      <dd className="row" style={{ gap: 4 }}>
        {cl.dataClasses.length ? cl.dataClasses.map((d) => <Chip key={d} tone="violet">{d}</Chip>) : <span className="faint">any data</span>}
        <span className="faint">· {cl.actions === "ANY" ? "any action" : cl.actions.join(" / ")}</span>
      </dd>
      <dt>Where to</dt><dd>{cl.destinations === "ANY" ? <span className="faint">anywhere</span> : destinationText(cl.destinations)}</dd>
      <dt>Only in</dt>
      <dd>{cl.environments?.length ? <Chip tone="review">{env}</Chip> : <span className="faint">{env}</span>}</dd>
      {cl.mcp && (
        <>
          <dt>MCP tool</dt>
          <dd className="row" style={{ gap: 4 }}>
            {cl.mcp.registered === false && <Chip tone="critical">unregistered servers</Chip>}
            {cl.mcp.tools?.map((t) => <Chip key={t} tone="neutral"><span className="mono">{t}</span></Chip>)}
            {Object.entries(cl.mcp.args ?? {}).map(([k, v]) => <span key={k} className="mono small">{k} ~ /{v}/</span>)}
          </dd>
        </>
      )}
      {(cl.transform || cl.failClosed) && (
        <>
          <dt>Also</dt>
          <dd className="row" style={{ gap: 4 }}>
            {cl.transform && <Chip tone="constrain">{cl.transform}</Chip>}
            {cl.failClosed && <Chip tone="critical">fail closed</Chip>}
          </dd>
        </>
      )}
    </dl>
  );
}

export function IntentStudio({ nav }: { nav: (r: string) => void; route: string }) {
  const s = useAppState();
  const [open, setOpen] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftName, setDraftName] = useState("New contract");
  const [draftText, setDraftText] = useState(
    "Employees may use approved AI services for normal business work. Customer email addresses and phone numbers must be reversibly tokenized before transmission to external AI. Credentials must never be transmitted externally."
  );
  const [preview, setPreview] = useState<ContractClause[] | null>(null);
  const [modifyFrom, setModifyFrom] = useState<string | null>(null); // autopilot rec being edited
  const contract = open ? s.contracts.find((c) => c.id === open) : null;

  const activeCount = s.contracts.filter((c) => c.status === "ACTIVE").length;
  const draftCount = s.contracts.filter((c) => c.status === "DRAFT").length;
  const enforcedCount = s.contracts.filter((c) => contractCoverage(c) === "ENFORCED").length;
  const openRecs = s.autopilot.filter((a) => a.status === "open");
  const acceptedRecs = s.autopilot.filter((a) => a.status === "accepted").length;
  const dismissedRecs = s.autopilot.filter((a) => a.status === "dismissed").length;
  const cf = useCardFilters(s.contracts, {
    search: (c) => `${c.name} ${c.sourceText} ${userById(c.author)?.name ?? ""}`,
    filters: [
      { id: "status", label: "Status", get: (c) => c.status },
      { id: "coverage", label: "Coverage", get: (c) => contractCoverage(c), format: (v) => v.replaceAll("_", " ") },
      { id: "author", label: "Author", get: (c) => c.author, format: (v) => userById(v)?.name ?? v },
    ],
  });
  const cpg = usePaged(cf.filtered, 8, cf.resetKey);

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow="Policy"
        title="Intent Studio"
        sub="Enterprise intent in natural language, compiled to an enforceable machine representation. A contract only claims the coverage its required capabilities truthfully provide."
        right={<button className="btn btn-primary" onClick={() => { setModifyFrom(null); setDrafting(true); setPreview(null); }}>+ Draft contract</button>}
      />

      {/* Hero — the natural-language drafter is the lead of the page */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="grid g2" style={{ gap: 0 }}>
          <div style={{ padding: "28px 30px" }}>
            <div className="row" style={{ gap: 9, marginBottom: 14 }}>
              <span className="plane-icon" style={{ color: "var(--accent)", background: "var(--accent-soft)" }}><Wand2 size={16} strokeWidth={1.9} /></span>
              <span className="eyebrow">Compose</span>
            </div>
            <h2 style={{ fontSize: 21, letterSpacing: "-0.02em", lineHeight: 1.22 }}>
              Describe intent in plain English. Wrapbox compiles it to enforceable policy.
            </h2>
            <p className="dim" style={{ marginTop: 11, fontSize: 14, lineHeight: 1.62, maxWidth: 470 }}>
              Write a rule the way you'd explain it to a colleague. The drafter extracts the data
              classes, destinations and required action, then shows the exact machine clauses — and
              only claims the coverage your live capabilities can truthfully deliver.
            </p>
            <div className="row" style={{ marginTop: 20 }}>
              <button className="btn btn-primary" onClick={() => { setModifyFrom(null); setDrafting(true); setPreview(null); }}>
                Open drafter <ArrowRight size={14} />
              </button>
              <SimNote>Deterministic pattern compiler — the product compiles via Policy IR</SimNote>
            </div>
          </div>
          <div style={{ padding: "28px 30px", background: "var(--surface-2)", borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="payload-title dim">Draft intent</div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r)", padding: "15px 17px", fontSize: 13.5, lineHeight: 1.62, color: "var(--fg-2)", fontStyle: "italic" }}>
              “{draftText}”
            </div>
            <div className="row faint small" style={{ gap: 6, marginTop: "auto" }}>
              <ArrowRight size={13} /> compiles to clauses with effect, transform and required skills
            </div>
          </div>
        </div>
      </div>

      {/* KPI strip — refined, not a row of number boxes */}
      <div className="card">
        <MetricBar band items={[
          { label: "Contracts", value: s.contracts.length, note: "natural-language intent, compiled" },
          { label: "Active", value: activeCount, tone: "good", note: draftCount > 0 ? `${draftCount} draft(s) pending` : "no drafts pending" },
          { label: "Fully enforced", value: enforcedCount, tone: enforcedCount === s.contracts.length ? "good" : "info", note: "coverage backed by live capabilities" },
          { label: "Open recommendations", value: openRecs.length, tone: openRecs.length > 0 ? "warn" : "good", note: "from Policy Autopilot" },
        ]} />
      </div>

      <PageTabs storageKey="intent" tabs={[
        { id: "contracts", label: "Intent contracts", count: s.contracts.length, content: (
      <>
        <SectionHead
          title="Intent Contracts"
          sub="Each card is authored intent compiled to enforceable clauses — open one to inspect its machine representation"
          right={<span className="small faint tnum">{s.contracts.length} total · {activeCount} active</span>}
        />
        {s.contracts.length === 0 ? (
          <div className="card empty"><FileText size={18} className="dim" /><div>No contracts yet. Describe a rule in plain English above, then <b>Use this draft</b> to compile your first one.</div></div>
        ) : (
        <>
        <FilterBar {...cf.bar} placeholder="Search contracts…" />
        {cf.filtered.length === 0 ? (
          <div className="card empty"><FileText size={18} className="dim" /><div>No contracts match these filters.</div></div>
        ) : (
        <CardGrid>
          {cpg.rows.map((c) => {
            const effects = [...new Set(c.clauses.map((cl) => cl.effect))];
            return (
              <EntityCard
                key={c.id}
                icon={<Avatar userId={c.author} size={26} />}
                eyebrow={userById(c.author)?.name ?? c.author}
                title={c.name}
                status={<Chip tone={c.status === "ACTIVE" ? "allow" : c.status === "DRAFT" ? "neutral" : "block"}>{c.status}</Chip>}
                onClick={() => setOpen(c.id)}
                fields={[
                  { label: "Clauses", value: <span className="row" style={{ gap: 6 }}><span className="mono tnum" style={{ fontWeight: 600 }}>{c.clauses.length}</span>{effects.map((eff) => <DecisionChip key={eff} d={eff} small />)}</span> },
                  { label: "Coverage", value: <StatusChip s={contractCoverage(c)} /> },
                  { label: "Version", value: <span className="mono tnum">v{c.version}</span> },
                  { label: "Source text", value: <span className="dim" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c.sourceText}</span> },
                ]}
              />
            );
          })}
        </CardGrid>
        )}
        <Pager page={cpg.page} pages={cpg.pages} setPage={cpg.setPage} total={cpg.total} size={cpg.size} />
        </>
        )}
      </>
        ) },
        { id: "autopilot", label: "Policy Autopilot", count: openRecs.length, content: (
      <>
        <SectionHead
          title="Policy Autopilot"
          sub="Suggestions based on what Wrapbox has seen. Accepting creates a draft rule (switched off) or narrows a permission — never switches anything on by itself."
          right={openRecs.length > 0 ? <Chip tone="review">{openRecs.length} open</Chip> : <Chip tone="allow">all handled</Chip>}
        />
        {openRecs.length === 0 && (
          <div className="card empty"><Wand2 size={18} className="dim" /><div>No open recommendations.</div></div>
        )}
        {openRecs.length > 0 && (
          <CardGrid>
            {openRecs.map((a) => (
              <EntityCard
                key={a.id}
                icon={<span className="plane-icon" style={{ color: "var(--accent)", background: "var(--accent-soft)" }}><Sparkles size={15} strokeWidth={1.9} /></span>}
                eyebrow="Observed pattern"
                title={a.observation}
                status={
                  <Chip tone={a.proposes?.kind === "draft" ? "review" : a.proposes?.kind === "narrow-standing" ? "constrain" : "neutral"}>
                    {a.proposes?.kind === "draft" ? "new draft rule" : a.proposes?.kind === "narrow-standing" ? "narrow permission" : "no change"}
                  </Chip>
                }
                fields={[
                  { label: "Observed", value: <span className="tnum">{a.basedOnEvents.toLocaleString()} events</span> },
                  { label: "Recommendation", value: a.recommendation },
                  { label: "If you accept", value: a.proposes?.kind === "draft"
                    ? <>a new <b>draft</b> rule is created — switched off until you activate it.</>
                    : a.proposes?.kind === "narrow-standing"
                      ? <>a standing permission is <b>narrowed</b> ("{a.proposes.from}" → "{a.proposes.to}").</>
                      : "nothing is created." },
                ]}
              >
                <div className="row">
                  <button className="btn btn-sm btn-good" onClick={() => acceptAutopilot(a.id)}>Accept</button>
                  {a.proposes?.kind === "draft" && (
                    <button className="btn btn-sm" onClick={() => {
                      if (a.proposes?.kind !== "draft") return;
                      setModifyFrom(a.id); setDraftName(a.proposes.name); setDraftText(a.proposes.sourceText);
                      setPreview(null); setDrafting(true);
                    }}>Modify</button>
                  )}
                  <button className="btn btn-sm btn-ghost" onClick={() => setAutopilotStatus(a.id, "dismissed")}>Dismiss</button>
                </div>
              </EntityCard>
            ))}
          </CardGrid>
        )}
        {s.autopilot.some((a) => a.status !== "open") && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="small" style={{ fontWeight: 600, marginBottom: 10 }}>
              Handled · {acceptedRecs} accepted · {s.autopilot.filter((a) => a.status === "modified").length} modified · {dismissedRecs} dismissed
            </div>
            {s.autopilot.filter((a) => a.status !== "open").map((a) => (
              <div key={a.id} className="row small" style={{ gap: 8, padding: "7px 0", flexWrap: "nowrap", alignItems: "flex-start", borderTop: "1px solid var(--line)" }}>
                <Chip tone={a.status === "dismissed" ? "neutral" : "allow"}>{a.status.toUpperCase()}</Chip>
                <span className="dim">
                  {a.status === "dismissed" ? `Dismissed: ${a.recommendation}` : a.result ?? a.recommendation}
                  {a.contractId && s.contracts.some((c) => c.id === a.contractId) && (
                    <> <a onClick={() => setOpen(a.contractId!)}>Open draft</a></>
                  )}
                </span>
              </div>
            ))}
            <div className="small faint" style={{ marginTop: 10 }}>Autopilot never switches a rule on or widens anyone's authority by itself.</div>
          </div>
        )}
      </>
        ) },
      ]} />

      {/* Contract detail */}
      {contract && (
        <Drawer onClose={() => setOpen(null)}>
          <div className="spread">
            <h2 style={{ fontSize: 16 }}>{contract.name}</h2>
            <div className="row">
              <StatusChip s={contractCoverage(contract)} />
              <Chip tone={contract.status === "ACTIVE" ? "allow" : "neutral"}>{contract.status}</Chip>
            </div>
          </div>
          <div className="row small dim" style={{ gap: 8, margin: "10px 0 14px" }}>
            <Avatar userId={contract.author} size={20} />
            <span>v{contract.version} · {userById(contract.author)?.name} · {new Date(contract.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="card" style={{ background: "var(--bg-inset)", fontStyle: "italic" }}>
            “{contract.sourceText}”
          </div>
          <h3 style={{ fontSize: 13, margin: "18px 0 8px" }}>Compiled clauses</h3>
          {contract.clauses.map((cl) => (
            <div className="card" key={cl.id} style={{ marginBottom: 8, padding: "10px 12px" }}>
              <div className="spread">
                <span className="small">“{cl.text}”</span>
                <DecisionChip d={cl.effect} small />
              </div>
              <ClauseFacts cl={cl} />
              <div className="row small faint" style={{ marginTop: 8, gap: 8 }}>
                requires:{" "}
                {cl.requiredCapabilities.map((cap) => {
                  const c = CAPABILITIES.find((x) => x.id === cap);
                  return <span key={cap} className="row" style={{ gap: 5 }}>{c?.label ?? cap} <StatusChip s={c?.status ?? "PENDING"} /></span>;
                })}
              </div>
            </div>
          ))}
          <div className="row" style={{ marginTop: 14 }}>
            {contract.status !== "ACTIVE" && (
              <button
                className="btn btn-good btn-sm"
                onClick={() => setContractStatus(contract.id, "ACTIVE")}
                disabled={contractCoverage(contract) === "PENDING"}
                title={contractCoverage(contract) === "PENDING" ? "Required capability is PENDING — activation would create a false security claim" : ""}
              >
                Activate
              </button>
            )}
            {contract.status === "ACTIVE" && (
              <button className="btn btn-danger btn-sm" onClick={() => setContractStatus(contract.id, "DEACTIVATED")}>Deactivate</button>
            )}
            <button className="btn btn-sm" onClick={() => { setOpen(null); nav("simulator"); }}>Simulate impact <ArrowRight size={13} /></button>
          </div>
          {(() => {
            const cov = contractCoverage(contract);
            if (cov === "ENFORCED") return null;
            const weak = [...new Set(contract.clauses.flatMap((cl) => cl.requiredCapabilities))]
              .map((id) => CAPABILITIES.find((c) => c.id === id))
              .filter((c) => c && c.status !== "ENFORCED")
              .map((c) => `${c!.label} (${c!.status.replaceAll("_", " ").toLowerCase()})`);
            return (
              <div className="small" style={{ color: "var(--warn)", marginTop: 10 }}>
                {cov === "PENDING"
                  ? contract.status === "ACTIVE"
                    ? "A required skill is missing — this contract cannot be fully kept."
                    : "Can't be switched on: a required skill is missing. Wrapbox will not claim protection it cannot deliver."
                  : "Enforced with reduced confidence — shown honestly, not hidden."}
                {weak.length > 0 && <> Weak skills: {weak.join(", ")}.</>}
              </div>
            );
          })()}
        </Drawer>
      )}

      {/* Drafting */}
      {drafting && (
        <Drawer onClose={() => setDrafting(false)}>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>Draft Intent Contract</h2>
          <div className="field" style={{ marginBottom: 12 }}>
            <label className="field-label">Name</label>
            <input className="input" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Intent (natural language)</label>
            <textarea className="input" rows={5} value={draftText} onChange={(e) => setDraftText(e.target.value)} />
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={() => setPreview(draftClauses(draftText))}>Compile</button>
            <SimNote>Deterministic pattern compiler — the product compiles via Policy IR</SimNote>
          </div>
          {preview && (
            <>
              <h3 style={{ fontSize: 13, margin: "18px 0 8px" }}>Compiled preview</h3>
              {preview.map((cl) => (
                <div className="card" key={cl.id} style={{ marginBottom: 8, padding: "10px 12px" }}>
                  <div className="spread">
                    <span className="small">“{cl.text}”</span>
                    <DecisionChip d={cl.effect} small />
                  </div>
                  <div className="row small" style={{ marginTop: 8, gap: 4 }}>
                    {cl.dataClasses.map((d) => <Chip key={d} tone="violet">{d}</Chip>)}
                    {cl.transform && <Chip tone="constrain">{cl.transform}</Chip>}
                    {cl.failClosed && <Chip tone="critical">fail closed</Chip>}
                  </div>
                </div>
              ))}
              <div className="row small dim" style={{ margin: "12px 0", gap: 8 }}>
                Coverage rollup: <StatusChip s={coverageRollup(preview)} />
              </div>
              <button
                className="btn btn-good"
                onClick={() => {
                  const newId = `ic-${Date.now().toString(36)}`;
                  upsertContract({
                    id: newId,
                    name: draftName,
                    author: "u-priya",
                    createdAt: Date.now(),
                    version: 1,
                    status: "DRAFT",
                    sourceText: draftText,
                    clauses: preview,
                    coverage: coverageRollup(preview),
                  });
                  if (modifyFrom) markAutopilotModified(modifyFrom, newId, draftName);
                  setModifyFrom(null);
                  setDrafting(false);
                }}
              >
                Save as draft
              </button>
            </>
          )}
        </Drawer>
      )}
    </div>
  );
}
