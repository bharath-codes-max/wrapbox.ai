// Onboarding shell — the same anatomy as the main Wrapbox prototype's setup
// wizards: a sticky step list on the left (done / current / locked), one step
// on the right, and a Back / Continue footer. Plus the small primitives the
// steps share: selectable choice cards, toggles, segmented pickers, modals,
// and "tick" lines that go from spinner to check.
import React from "react";
import { createPortal } from "react-dom";
import { Check, CircleCheck, Loader2, X } from "lucide-react";
import { Avatar } from "./kit";

export interface SetupStep { title: string; sub: string }

export function SetupLayout({
  title, persona, personaUserId, steps, step, reached, onStep, onExit, children,
}: {
  title: string;
  persona: string;
  personaUserId: string;
  steps: SetupStep[];
  step: number;
  reached: number;
  onStep: (i: number) => void;
  onExit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="setup">
      <aside className="setup-rail">
        <div className="setup-rail-head">
          <Avatar userId={personaUserId} size={30} />
          <div style={{ minWidth: 0 }}>
            <div className="setup-title">{title}</div>
            <div className="setup-persona">{persona}</div>
          </div>
        </div>
        <div className="setup-progress" aria-label={`Step ${step + 1} of ${steps.length}`}>
          <div style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
        </div>
        <ol className="setup-steps">
          {steps.map((s, i) => {
            const current = i === step;
            const done = i < reached && !current;
            return (
              <li key={s.title}>
                <button className={`setup-step ${current ? "current" : ""}`} disabled={i > reached} onClick={() => onStep(i)} aria-current={current ? "step" : undefined}>
                  <span className={`setup-num ${done ? "done" : current ? "current" : ""}`}>
                    {done ? <Check size={11} strokeWidth={3} /> : i + 1}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="setup-step-title">{s.title}</span>
                    <span className="setup-step-sub">{s.sub}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <button className="setup-exit" onClick={onExit}><X size={13} /> Exit setup</button>
      </aside>
      <section className="setup-main" key={step}>{children}</section>
    </div>
  );
}

export function StepHead({ n, total, title, sub }: { n: number; total: number; title: string; sub?: React.ReactNode }) {
  return (
    <div className="step-head">
      <div className="eyebrow">Step {n} of {total}</div>
      <h1 className="step-title">{title}</h1>
      {sub && <p className="step-sub">{sub}</p>}
    </div>
  );
}

export function StepFooter({
  onBack, onNext, nextLabel = "Continue", disabled, hint, busy,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: React.ReactNode;
  disabled?: boolean;
  hint?: React.ReactNode;
  busy?: boolean;
}) {
  return (
    <div className="step-footer">
      {onBack && <button className="btn btn-ghost" onClick={onBack}>← Back</button>}
      {hint && <span className="hint">{hint}</span>}
      <button className="btn btn-primary btn-lg next" disabled={disabled || busy} onClick={onNext}>
        {busy ? <Loader2 size={14} className="spin" /> : null}
        {nextLabel}{!busy && " →"}
      </button>
    </div>
  );
}

/** A line that spins while working and turns into a green check when done. */
export function Tick({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <div className="tick">
      {done ? <CircleCheck size={15} className="ok" /> : <Loader2 size={15} className="spin" />}
      <span className={done ? "" : "dim"}>{children}</span>
    </div>
  );
}

/** A selectable card (radio / checkbox idiom). */
export function Choice({
  selected, onClick, children, disabled, className = "",
}: { selected: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean; className?: string }) {
  return (
    <button type="button" className={`choice ${selected ? "selected" : ""} ${className}`} onClick={onClick} disabled={disabled} aria-pressed={selected}>
      {children}
    </button>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} />;
}

export function Segmented<T extends string | number>({
  value, options, onChange,
}: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Rendered at the document root, above the sticky top bars (see Drawer). */
export function Modal({ onClose, width = 520, children }: { onClose: () => void; width?: number; children: React.ReactNode }) {
  return createPortal(
    <>
      <div className="drawer-veil" onClick={onClose} />
      <div className="modal" role="dialog" style={{ width: `min(${width}px, 94vw)` }}>{children}</div>
    </>,
    document.body,
  );
}

/** Small async helper for staged, animated sequences inside steps. */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
