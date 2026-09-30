// Token Vault — reversible tokens created by CONSTRAIN. The outside AI only
// ever sees the token; Wrapbox swaps it back to the real value only for
// someone inside the company. Every restore attempt is logged. Raw values are
// never displayed — originals are masked on screen.
import React, { useMemo, useState } from "react";
import { useAppState, restoreToken } from "../state/store";
import { PageHead, Chip, SimNote, SectionHead, MetricBar, Avatar, DestMark, PageTabs, usePaged, Pager, EntityCard, CardGrid, Select, FilterBar, useCardFilters } from "../ui/kit";
import { DEST_LOGOS } from "../ui/logos";
import { EventDetail } from "../ui/event-detail";
import { destById } from "../model/registries";
import type { RestoreRecord, SimulationEvent } from "../model/types";
import { Vault, ShieldCheck, ShieldX, Globe, KeyRound, History } from "lucide-react";
import { ORG } from "../model/org";

/** Show enough to recognise a value without revealing it. */
function mask(v: string): string {
  if (v.includes("@")) {
    const [name, domain] = v.split("@");
    return `${name[0]}•••${name.length > 1 ? name[name.length - 1] : ""}@${domain}`;
  }
  const digits = v.replace(/\D/g, "");
  if (digits.length >= 7) return v.replace(/\d(?=(?:\D*\d){2})/g, "•");
  return v.length > 4 ? `${v.slice(0, 2)}•••${v.slice(-2)}` : "••••";
}

const scopeLabel = (scope: string) =>
  scope === "veridian-internal" || scope.startsWith("restore:") ? `${ORG.short} internal only` : scope;

export function TokenVaultPage({ nav }: { nav: (r: string) => void }) {
  const s = useAppState();
  const [openEvt, setOpenEvt] = useState<SimulationEvent | null>(null);
  const tokens = useMemo(() => [...s.tokens].reverse(), [s.tokens]);
  const [picked, setPicked] = useState<string>(() => tokens.find((t) => t.dataClass === "PII.EMAIL")?.id ?? tokens[0]?.id ?? "");
  const [last, setLast] = useState<Record<string, RestoreRecord | undefined>>({});

  // Where each token came from: the event and the original value it replaced.
  const originOf = (tokenId: string) => {
    for (const e of s.events) {
      const step = e.transformation?.find((t) => t.tokenId === tokenId);
      if (step) return { event: e, original: step.before };
    }
    return undefined;
  };

  const token = s.tokens.find((t) => t.id === picked);
  const origin = token ? originOf(token.id) : undefined;
  // The outside party is the AI that actually received this token.
  const outsider = origin?.event.destination ? destById(origin.event.destination)?.host ?? "the outside AI" : "the outside AI";
  const allowedCount = s.restorations.filter((r) => r.allowed).length;
  const deniedCount = s.restorations.length - allowedCount;
  // The AI's reply, with whatever stands in for the customer's value.
  const reply = (value: React.ReactNode) => <>Hi {value}, thanks for being a {ORG.short} customer — your renewal quote is attached.</>;

  const ask = (who: "inside" | "outside") => {
    if (!token) return;
    const rec = who === "inside"
      ? restoreToken(token.id, `Priya Menon (inside ${ORG.short})`, true)
      : restoreToken(token.id, `${outsider} (outside ${ORG.short})`, false);
    setLast((m) => ({ ...m, [who]: rec }));
  };

  // Presentation only: newest-first log, filters and page slices for the two card lists.
  const logRows = useMemo(() => [...s.restorations].reverse(), [s.restorations]);
  const classOf = (tokenId: string) => s.tokens.find((t) => t.id === tokenId)?.dataClass;
  const resultLabel = (allowed: boolean) => (allowed ? "Allowed" : "Denied");
  const restoresOf = (tokenId: string) => s.restorations.filter((r) => r.tokenId === tokenId);
  const lf = useCardFilters(logRows, {
    search: (r) => `${r.tokenId} ${r.requester} ${r.reason}`,
    filters: [
      { id: "class", label: "Data class", get: (r) => classOf(r.tokenId) },
      { id: "scope", label: "Scope", get: (r) => (r.inside ? `Inside ${ORG.short}` : `Outside ${ORG.short}`) },
      { id: "result", label: "Result", get: (r) => resultLabel(r.allowed) },
    ],
  });
  const logPaged = usePaged(lf.filtered, 8, lf.resetKey);
  const vf = useCardFilters(tokens, {
    search: (t) => `${t.id} ${t.dataClass} ${t.eventId}`,
    filters: [
      { id: "class", label: "Data class", get: (t) => t.dataClass },
      { id: "scope", label: "Scope", get: (t) => scopeLabel(t.scope) },
      {
        id: "result", label: "Result",
        get: (t) => {
          const rs = restoresOf(t.id);
          return rs.length === 0 ? "Never restored" : [...new Set(rs.map((r) => resultLabel(r.allowed)))];
        },
      },
    ],
  });
  const vaultPaged = usePaged(vf.filtered, 8, vf.resetKey);

  // One token picker, shown on both round-trip tabs — `picked` lives at page level.
  const picker = tokens.length > 0 ? (
    <Select
      value={picked}
      onChange={(v) => { setPicked(v); setLast({}); }}
      options={tokens.map((t) => ({ value: t.id, label: `${t.id} · ${t.dataClass}` }))}
      allLabel={null}
    />
  ) : undefined;

  const vaultEmpty = (
    <div className="card empty">
      <Vault size={26} className="dim" />
      <div style={{ fontWeight: 600, fontSize: 15, marginTop: 10 }}>The vault is empty</div>
      <div className="small dim" style={{ maxWidth: 460, margin: "6px auto 0", lineHeight: 1.55 }}>
        Run “Customer PII → approved AI” in the Simulation Lab to mint the first reversible token.
      </div>
    </div>
  );

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow="System"
        title="Token Vault"
        sub="When Wrapbox hides private data, it swaps each value for a token. The outside AI only ever sees the token; Wrapbox swaps it back only for people inside the company. Real values are never shown on this page."
        right={<SimNote>Vault storage simulated · restore rules and log real</SimNote>}
      />

      {/* Vault at a glance — one refined strip, never a wall of number-boxes */}
      <div className="card">
        <MetricBar
          band
          items={[
            { label: "Tokens in vault", value: s.tokens.length, note: "private values swapped out" },
            { label: "Restores allowed", value: allowedCount, tone: "good", note: `inside ${ORG.short}` },
            { label: "Restores denied", value: deniedCount, tone: deniedCount ? "bad" : undefined, note: "asked from outside" },
            { label: "Data types", value: new Set(s.tokens.map((t) => t.dataClass)).size, note: "kinds of private data" },
          ]}
        />
      </div>

      <PageTabs
        storageKey="vault"
        tabs={[
          {
            id: "round-trip",
            label: "The round trip",
            content: (
              <>
                <SectionHead
                  title="The round trip"
                  sub="The AI writes its answer using the token. On the way back, who gets the real value?"
                  right={picker}
                />
                {!token || !origin ? vaultEmpty : (
                  <div className="card">
                    {/* Steps 1 · 2 · 3 — a left-to-right journey of the same token */}
                    {/* Inner steps sit one surface up so they read on the black canvas (tokens only — both themes hold) */}
                    <div className="grid g3">
                      <div className="card" style={{ background: "var(--surface-2)" }}>
                        <div className="eyebrow">1 · Sent to the AI</div>
                        <div className="row small dim" style={{ gap: 7, marginTop: 8, flexWrap: "nowrap", minWidth: 0 }}>
                          {origin.event.destination && DEST_LOGOS[origin.event.destination] && <DestMark destId={origin.event.destination} size={15} />}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{outsider}</span>
                        </div>
                        <div className="payload" style={{ marginTop: 10 }}>… <span className="hl-tok">{token.id}</span> …</div>
                        <div className="small faint" style={{ marginTop: 8 }}>The real value never left {ORG.short}.</div>
                      </div>
                      <div className="card" style={{ background: "var(--surface-2)" }}>
                        <div className="eyebrow">2 · The AI's reply</div>
                        <div className="payload" style={{ marginTop: 10 }}>{reply(<span className="hl-tok">{token.id}</span>)}</div>
                        <div className="small faint" style={{ marginTop: 8 }}>The AI wrote its answer with the token — it never knew the real value.</div>
                      </div>
                      <div className="card" style={{ background: "var(--surface-2)" }}>
                        <div className="eyebrow">3 · Coming back through Wrapbox</div>
                        <div className="small dim" style={{ marginTop: 10, lineHeight: 1.55 }}>
                          Wrapbox can swap <span className="mono">{token.id}</span> back for the real value — but only for someone inside the company.
                        </div>
                        <div className="small faint" style={{ marginTop: 8 }}>
                          From: <a onClick={() => setOpenEvt(origin.event)}>{origin.event.id}</a>
                        </div>
                      </div>
                    </div>
                    <div className="small faint" style={{ marginTop: 14 }}>
                      Try both requesters in “Who gets it back” — the same token, two different answers.
                    </div>
                  </div>
                )}
              </>
            ),
          },
          {
            id: "restore",
            label: "Who gets it back",
            content: (
              <>
                <SectionHead
                  title="Who gets the real value back?"
                  sub="Same token, two requesters — Wrapbox decides who is inside the company."
                  right={picker}
                />
                {!token || !origin ? vaultEmpty : (
                  <div className="card">
                    <CardGrid>
                      {([
                        { who: "inside" as const, title: "Priya Menon asks", sub: `inside ${ORG.short}, reading the AI's reply` },
                        { who: "outside" as const, title: `${outsider} asks`, sub: "the AI that received the token tries to learn the real value" },
                      ]).map((c) => {
                        const r = last[c.who];
                        return (
                          <EntityCard
                            key={c.who}
                            tone={r ? (r.allowed ? "allow" : "block") : undefined}
                            icon={c.who === "inside"
                              ? <Avatar userId="u-priya" size={26} />
                              : origin.event.destination && DEST_LOGOS[origin.event.destination]
                                ? <DestMark destId={origin.event.destination} size={20} />
                                : <Globe size={18} className="faint" />}
                            eyebrow={c.who === "inside" ? `Inside ${ORG.short}` : `Outside ${ORG.short}`}
                            title={c.title}
                            status={r ? (r.allowed
                              ? <Chip tone="allow"><ShieldCheck size={11} /> ALLOWED</Chip>
                              : <Chip tone="block"><ShieldX size={11} /> DENIED</Chip>) : undefined}
                            action={<button className="btn btn-sm" onClick={() => ask(c.who)}>Restore</button>}
                            fields={[
                              { label: "Requester", value: <span className="dim">{c.sub}</span> },
                              { label: "Token", value: <span className="mono hl-tok">{token.id}</span> },
                              ...(r ? [{ label: "Why", value: <span className="dim">{r.reason}</span> }] : []),
                            ]}
                          >
                            {r && (
                              <>
                                <div className="payload">
                                  {r.allowed
                                    ? reply(<span className="hl-red">{mask(origin.original)}</span>)
                                    : reply(<span className="hl-tok">{token.id}</span>)}
                                </div>
                                <div className="small faint" style={{ marginTop: 6 }}>
                                  {r.allowed
                                    ? "Priya sees the real value in her app. It's masked here so this page never displays it."
                                    : `${outsider} keeps seeing only the token. The attempt is written to the restore log.`}
                                </div>
                              </>
                            )}
                          </EntityCard>
                        );
                      })}
                    </CardGrid>
                    <div className="small faint row" style={{ gap: 6, marginTop: 14 }}>
                      <History size={13} /> Every attempt — allowed or denied — is recorded in the Restore log tab.
                    </div>
                  </div>
                )}
              </>
            ),
          },
          {
            id: "log",
            label: "Restore log",
            count: s.restorations.length,
            content: (
              <>
                <SectionHead title="Restore log" sub="Who asked to see a real value, and what Wrapbox said" />
                {s.restorations.length === 0 ? (
                  <div className="card empty">No restore attempts yet — try one in “Who gets it back”.</div>
                ) : (
                  <>
                    <FilterBar {...lf.bar} placeholder="Search token, requester or reason…" />
                    {lf.filtered.length === 0 ? (
                      <div className="card empty">No restore attempts match these filters.</div>
                    ) : (
                      <CardGrid>
                        {logPaged.rows.map((r) => (
                          <EntityCard
                            key={r.id}
                            tone={r.allowed ? undefined : "block"}
                            icon={<KeyRound size={18} className="faint" />}
                            eyebrow={classOf(r.tokenId) ?? "Token"}
                            title={<span className="mono hl-tok">{r.tokenId}</span>}
                            status={r.allowed
                              ? <Chip tone="allow"><ShieldCheck size={11} /> ALLOWED</Chip>
                              : <Chip tone="block"><ShieldX size={11} /> DENIED</Chip>}
                            fields={[
                              { label: "When", value: <span className="tnum">{new Date(r.at).toLocaleTimeString()}</span> },
                              {
                                label: "Who asked",
                                value: <>{r.inside ? <Avatar userId="u-priya" size={16} /> : <Globe size={13} className="faint" />} {r.requester}</>,
                              },
                              { label: "Scope", value: r.inside ? `Inside ${ORG.short}` : `Outside ${ORG.short}` },
                              { label: "Why", value: <span className="dim">{r.reason}</span> },
                            ]}
                          />
                        ))}
                      </CardGrid>
                    )}
                    <Pager {...logPaged} />
                  </>
                )}
              </>
            ),
          },
          {
            id: "contents",
            label: "Vault contents",
            count: tokens.length,
            content: (
              <>
                <SectionHead title="Vault contents" sub="Every private value Wrapbox has swapped out, and where it came from" />
                {tokens.length === 0 ? (
                  <div className="card empty">No tokens yet — run "Customer PII → approved AI" in the Simulation Lab.</div>
                ) : (
                  <>
                    <FilterBar {...vf.bar} placeholder="Search token or event…" />
                    {vf.filtered.length === 0 ? (
                      <div className="card empty">No tokens match these filters.</div>
                    ) : (
                      <CardGrid>
                        {vaultPaged.rows.map((t) => {
                          const o = originOf(t.id);
                          const rs = restoresOf(t.id);
                          const ok = rs.filter((r) => r.allowed).length;
                          const no = rs.length - ok;
                          return (
                            <EntityCard
                              key={t.id + t.eventId}
                              icon={<KeyRound size={18} className="faint" />}
                              eyebrow={t.dataClass}
                              title={<span className="mono hl-tok">{t.id}</span>}
                              status={<Chip tone={t.restorable ? "violet" : "neutral"}>{t.restorable ? "RESTORABLE" : "NOT RESTORABLE"}</Chip>}
                              fields={[
                                { label: "Original", value: o ? <span className="mono">{mask(o.original)}</span> : <span className="faint">—</span> },
                                { label: "Scope", value: <span className="chip c-constrain"><ShieldCheck size={11} /> {scopeLabel(t.scope)}</span> },
                                {
                                  label: "Created by",
                                  value: <>
                                    {o?.event.destination && DEST_LOGOS[o.event.destination] && <DestMark destId={o.event.destination} size={14} />}{" "}
                                    <span className="mono">{o ? <a onClick={() => setOpenEvt(o.event)}>{t.eventId}</a> : t.eventId}</span>
                                    <span className="faint tnum"> · {new Date(t.createdAt).toLocaleString()}</span>
                                  </>,
                                },
                                { label: "Expires", value: <span className="tnum">{new Date(t.expiresAt).toLocaleDateString()}</span> },
                                {
                                  label: "Restores",
                                  value: rs.length === 0 ? <span className="faint">Never restored</span> : <>
                                    {ok > 0 && <Chip tone="allow"><ShieldCheck size={11} /> Allowed · {ok}</Chip>}{" "}
                                    {no > 0 && <Chip tone="block"><ShieldX size={11} /> Denied · {no}</Chip>}
                                  </>,
                                },
                              ]}
                            />
                          );
                        })}
                      </CardGrid>
                    )}
                    <Pager {...vaultPaged} />
                  </>
                )}
              </>
            ),
          },
        ]}
      />

      {openEvt && <EventDetail e={s.events.find((x) => x.id === openEvt.id) ?? openEvt} onClose={() => setOpenEvt(null)} onNavigate={(r) => { setOpenEvt(null); nav(r); }} />}
    </div>
  );
}
