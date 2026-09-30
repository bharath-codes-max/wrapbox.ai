import { useEffect, useRef, useState, type FormEvent } from "react";
import { WrapboxWordmark } from "./logo";

// A friction gate for a shared preview link — not real authentication. It runs
// entirely in the visitor's browser with no server to ask, so anyone reading the
// bundled JavaScript can find the check and the correct answer; this only keeps
// the link from being casually browsable, the same as any client-only password
// screen. Say so plainly if asked how it's protected.
const PASSWORD_HASH = "233deb2454c36fa9cb4f0a792ed0d137193c8ccc36271b9bd23c65c6b5731543"; // sha256("96183")
const BRAND_GREEN = "#1ea76a";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function PasswordGate({ id, label, sub, children }: { id: string; label: string; sub?: string; children: React.ReactNode }) {
  const storageKey = `wrapbox-gate-${id}`;
  const [unlocked, setUnlocked] = useState(() => {
    try { return localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [shake, setShake] = useState(false);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!unlocked) inputRef.current?.focus(); }, [unlocked]);

  if (unlocked) return <>{children}</>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value || checking) return;
    setChecking(true);
    const ok = (await sha256Hex(value.trim())) === PASSWORD_HASH;
    setChecking(false);
    if (ok) {
      try { localStorage.setItem(storageKey, "1"); } catch { /* private mode — re-asks next visit */ }
      setUnlocked(true);
    } else {
      setShake(true);
      setValue("");
      window.setTimeout(() => setShake(false), 420);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 999999, display: "grid", placeItems: "center",
      background: "radial-gradient(120% 130% at 50% -10%, #14231b 0%, #05070a 46%, #000000 100%)",
      fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      <style>{`
        @keyframes wb-gate-shake { 10%,90%{transform:translateX(-1px)} 20%,80%{transform:translateX(2px)} 30%,50%,70%{transform:translateX(-4px)} 40%,60%{transform:translateX(4px)} }
        @keyframes wb-gate-in { from{opacity:0;transform:translateY(6px) scale(.985)} to{opacity:1;transform:none} }
        .wb-gate-card{animation:wb-gate-in .5s cubic-bezier(.2,.8,.2,1)}
        .wb-gate-card.shake{animation:wb-gate-shake .42s cubic-bezier(.36,.07,.19,.97)}
        .wb-gate-input:focus{border-color:${BRAND_GREEN} !important;box-shadow:0 0 0 3px ${BRAND_GREEN}33 !important}
        .wb-gate-btn:hover:not(:disabled){filter:brightness(1.08)}
        .wb-gate-btn:active:not(:disabled){transform:scale(.98)}
        .wb-gate-eye:hover{color:#e7e9ec !important}
      `}</style>
      <form onSubmit={submit} className={`wb-gate-card${shake ? " shake" : ""}`} style={{
        width: "min(380px, calc(100vw - 40px))", padding: "36px 32px 30px", borderRadius: 16,
        background: "linear-gradient(180deg, #131417 0%, #0c0d0f 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 30px 80px -20px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.05) inset",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center",
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14, display: "grid", placeItems: "center", marginBottom: 18,
          background: `linear-gradient(160deg, ${BRAND_GREEN}, #0f7a4a)`, boxShadow: `0 8px 22px -8px ${BRAND_GREEN}88, inset 0 1px 0 rgba(255,255,255,0.25)`,
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>
        <div style={{ marginBottom: 6 }}><WrapboxWordmark tone="dark" height={22} /></div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#f2f3f4", marginTop: 8 }}>{label}</div>
        <div style={{ fontSize: 13, color: "#8a8f98", lineHeight: 1.5, margin: "4px 0 22px", maxWidth: 300 }}>
          {sub ?? "This preview is private. Enter the password to continue."}
        </div>
        <div style={{ position: "relative", width: "100%" }}>
          <input
            ref={inputRef}
            className="wb-gate-input"
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Password"
            autoComplete="off"
            spellCheck={false}
            style={{
              width: "100%", height: 44, padding: "0 42px 0 14px", borderRadius: 9, boxSizing: "border-box",
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
              color: "#f2f3f4", fontSize: 14, outline: "none", transition: "border-color .15s, box-shadow .15s",
            }}
          />
          <button
            type="button"
            className="wb-gate-eye"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            style={{ position: "absolute", right: 4, top: 4, width: 36, height: 36, display: "grid", placeItems: "center", background: "none", border: 0, color: "#62666d", cursor: "pointer" }}
          >
            {show ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M6.5 6.7C4 8.3 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.2M9.9 4.2A10.6 10.6 0 0 1 12 4c6.5 0 10 7 10 7a15.6 15.6 0 0 1-3.1 4" /></svg>
            )}
          </button>
        </div>
        <button
          type="submit"
          className="wb-gate-btn"
          disabled={!value || checking}
          style={{
            width: "100%", height: 44, marginTop: 12, borderRadius: 9, border: 0, cursor: value ? "pointer" : "default",
            background: value ? BRAND_GREEN : "rgba(255,255,255,0.06)", color: value ? "#04170d" : "#62666d",
            fontSize: 14, fontWeight: 600, transition: "filter .12s, transform .06s, background-color .15s, color .15s",
          }}
        >
          {checking ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
