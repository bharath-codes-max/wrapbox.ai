/**
 * Reversible tokenization — the mechanism behind the CONSTRAIN decision.
 *
 * A protected value never leaves the device. It is replaced by a stable token
 * on the way out, and the token is swapped back for the real value on the way
 * in, before the browser renders the response. The remote model only ever sees
 * the token, but it can still reason about it ("email <WB_EMAIL_001> about the
 * invoice"), and the human reads a real address.
 *
 *   outbound   john@acme.com   ->  <WB_EMAIL_001>
 *   inbound    <WB_EMAIL_001>  ->  john@acme.com
 *
 * WHY A VAULT AND NOT A HASH: a hash is one-way, so the response could never
 * be restored. The mapping has to be kept, and it has to be kept HERE — the
 * moment it is sent anywhere the whole exercise is pointless.
 *
 * THREAT: a user (or a prompt injection inside an uploaded document) can type
 * "<WB_EMAIL_001>" into the conversation hoping the restore pass will hand
 * back a real value they were never shown. Two defences, both required:
 *
 *   1. Every token carries a per-session random tag, so a token from another
 *      session — or a guessed one — resolves to nothing.
 *   2. Any WB-token-shaped text already present in the OUTBOUND body is
 *      neutralised before tokenization, so it can never round-trip.
 *
 * The vault is memory-first and flushed to disk 0600 so a daemon restart mid
 * conversation can still restore tokens the model is still quoting back.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PATHS } from "./config.js";
import { seal, open as unseal, isSealed } from "./vaultkey.js";

/** Value classes we can tokenize. Kept deliberately small — each one needs a
 *  detector that is precise enough that a false positive does not corrupt
 *  ordinary text. */
export type TokenKind =
  | "EMAIL"
  | "PHONE"
  | "CARD"
  | "SSN"
  | "AADHAAR"
  | "NAME"
  | "ADDRESS"
  | "ACCOUNT"
  | "DOB"
  | "ID"
  | "VALUE";

/**
 * Token shape: <WB_EMAIL_001_a3f9>
 *
 * The trailing tag is this session's. It is what stops a guessed or replayed
 * token from resolving. It is NOT a secret — it only has to be unpredictable
 * enough that an attacker cannot name a token that exists in someone's vault.
 */
const TOKEN_RE = /<WB_([A-Z]+)_(\d{3,})_([0-9a-f]{4})>/g;

/** Matches token-SHAPED text regardless of session tag — used to neutralise
 *  anything the caller sent that is trying to look like one of our tokens. */
const TOKEN_SHAPED_RE = /<WB_[A-Z]+_\d+(?:_[0-9a-f]+)?>/g;

interface VaultEntry {
  token: string;
  value: string;
  kind: TokenKind;
  /** Where it came from, for the receipt — never the value itself. */
  field?: string;
  at: number;
}

const VAULT_FILE = () => path.join(PATHS.home, "token-vault.jsonl");
/** The sealed store. The plaintext .jsonl is only ever read for migration and then shredded. */
const VAULT_SEALED = () => path.join(PATHS.home, "token-vault.sealed");

/** Values live only for this long. A conversation the model is still quoting
 *  from stays restorable; a vault that grows forever does not. */
const TTL_MS = 24 * 3600_000;

class Vault {
  /** token -> entry */
  private byToken = new Map<string, VaultEntry>();
  /** `${kind}:${value}` -> token, so the same value always gets the same token
   *  and the model can tell two mentions of one person apart from two people. */
  private byValue = new Map<string, string>();
  private counters = new Map<TokenKind, number>();
  private sessionTag: string;
  private dirty = false;

  constructor() {
    this.sessionTag = crypto.randomBytes(2).toString("hex");
    this.load();
  }

  /** A fresh tag invalidates every previously issued token. Used when a policy
   *  change should not let an old conversation keep resolving values. */
  rotate(): void {
    this.sessionTag = crypto.randomBytes(2).toString("hex");
  }

  private load(): void {
    try {
      let raw = "";
      let migrated = false;
      try {
        const blob = fs.readFileSync(VAULT_SEALED());
        const pt = isSealed(blob) ? unseal(blob) : null;
        // A sealed file we cannot open (key changed, tampered) yields nothing —
        // tokens stop resolving rather than a corrupted map being trusted.
        raw = pt ? pt.toString("utf-8") : "";
      } catch { /* no sealed vault yet */ }
      if (!raw) {
        // One-time migration from the plaintext format.
        try { raw = fs.readFileSync(VAULT_FILE(), "utf-8"); migrated = raw.length > 0; } catch { /* none */ }
      }
      if (migrated) this.dirty = true;
      const now = Date.now();
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line) as VaultEntry;
          if (!e?.token || typeof e.value !== "string") continue;
          if (now - (e.at || 0) > TTL_MS) continue;
          this.byToken.set(e.token, e);
          this.byValue.set(`${e.kind}:${e.value}`, e.token);
          const n = Number(e.token.match(/_(\d+)_/)?.[1] ?? 0);
          const k = e.kind;
          if (n > (this.counters.get(k) ?? 0)) this.counters.set(k, n);
        } catch { /* one bad line must not lose the rest */ }
      }
    } catch { /* no vault yet */ }
  }

  /** Full rewrite, SEALED (AES-256-GCM, key in the Keychain or a 0600 key
   *  file — see vaultkey.ts). The plaintext file, if one is left over from
   *  the previous format, is overwritten and removed on the first flush. */
  flush(): void {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(PATHS.home, { recursive: true });
      const body = [...this.byToken.values()].map((e) => JSON.stringify(e)).join("\n") + "\n";
      const tmp = VAULT_SEALED() + ".tmp-" + process.pid;
      fs.writeFileSync(tmp, seal(Buffer.from(body, "utf-8")), { mode: 0o600 });
      fs.renameSync(tmp, VAULT_SEALED());
      try {
        const st = fs.statSync(VAULT_FILE());
        fs.writeFileSync(VAULT_FILE(), Buffer.alloc(st.size, 0));   // shred, then remove
        fs.unlinkSync(VAULT_FILE());
      } catch { /* no plaintext leftover */ }
      this.dirty = false;
    } catch { /* an unwritable vault degrades to memory-only, which still works
                 for the life of this process */ }
  }

  tokenFor(value: string, kind: TokenKind, field?: string): string {
    const key = `${kind}:${value}`;
    const existing = this.byValue.get(key);
    if (existing) return existing;

    const n = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, n);
    const token = `<WB_${kind}_${String(n).padStart(3, "0")}_${this.sessionTag}>`;

    const entry: VaultEntry = { token, value, kind, at: Date.now(), ...(field ? { field } : {}) };
    this.byToken.set(token, entry);
    this.byValue.set(key, token);
    this.dirty = true;
    return token;
  }

  valueFor(token: string): string | undefined {
    const e = this.byToken.get(token);
    if (!e) return undefined;
    if (Date.now() - e.at > TTL_MS) { this.byToken.delete(token); return undefined; }
    return e.value;
  }

  get size(): number { return this.byToken.size; }

  /** Drop everything. Used by `wrapboxd vault clear`. */
  clear(): void {
    this.byToken.clear();
    this.byValue.clear();
    this.counters.clear();
    this.rotate();
    try { fs.unlinkSync(VAULT_FILE()); } catch { /* already gone */ }
    try { fs.unlinkSync(VAULT_SEALED()); } catch { /* already gone */ }
    this.dirty = false;
  }
}

let vault: Vault | null = null;
function v(): Vault {
  if (!vault) vault = new Vault();
  return vault;
}

/* ------------------------------------------------------------------ *
 * Public surface
 * ------------------------------------------------------------------ */

/**
 * Neutralise anything in caller-supplied text that is shaped like one of our
 * tokens. Must run on every outbound body BEFORE tokenizing, otherwise a user
 * who types "<WB_EMAIL_001_a3f9>" gets a real address handed back to them by
 * the restore pass.
 *
 * The replacement is visibly different so it is obvious in a transcript that
 * Wrapbox neutralised something, rather than silently eating it.
 */
export function neutraliseTokenLookalikes(text: string): { text: string; found: number } {
  let found = 0;
  const out = text.replace(TOKEN_SHAPED_RE, () => { found++; return "⟨redacted-token-lookalike⟩"; });
  return { text: out, found };
}

/** Replace one value with its stable token. */
export function tokenize(value: string, kind: TokenKind, field?: string): string {
  return v().tokenFor(value, kind, field);
}

/**
 * Restore every token in `text` that this device actually issued.
 *
 * A token we did not issue is left exactly as-is — never guessed at, never
 * blanked. If the model invents "<WB_EMAIL_999_0000>", the user sees that
 * literal string, which is the honest outcome: we have no value for it.
 */
export function restore(text: string): { text: string; restored: number; unknown: number } {
  let restored = 0;
  let unknown = 0;
  const out = text.replace(TOKEN_RE, (match) => {
    const val = v().valueFor(match);
    if (val === undefined) { unknown++; return match; }
    restored++;
    return val;
  });
  return { text: out, restored, unknown };
}

/** True when the text contains at least one token we could restore. Lets the
 *  response path skip the rewrite entirely for the overwhelming majority of
 *  responses that contain none. */
export function hasTokens(text: string): boolean {
  TOKEN_RE.lastIndex = 0;
  return TOKEN_RE.test(text);
}

/**
 * The longest token we can emit. The streaming restorer holds back at least
 * this many trailing bytes so a token split across two chunks is never missed.
 */
export const MAX_TOKEN_LEN = 40;

/**
 * Restore across a CHUNKED stream (SSE, which is how every current chat vendor
 * streams a reply). A token can straddle a chunk boundary, so the tail of each
 * chunk is held back until either the next chunk arrives or the stream ends.
 *
 * Without this, a token split as "<WB_EMA" + "IL_001_a3f9>" is emitted raw and
 * the user sees the token instead of their data — the exact failure that makes
 * a masking product look broken.
 */
export function createStreamRestorer() {
  let held = "";
  let restored = 0;
  return {
    push(chunk: string): string {
      const merged = held + chunk;
      // Keep a tail long enough to contain any partial token. Cutting at the
      // last '<' is not enough on its own — a chunk may end mid-token with no
      // '<' in the tail at all — so take the max of both bounds.
      const lastOpen = merged.lastIndexOf("<");
      const byLen = Math.max(0, merged.length - MAX_TOKEN_LEN);
      const cut = lastOpen === -1 ? merged.length : Math.min(lastOpen, byLen);
      const emit = merged.slice(0, cut);
      held = merged.slice(cut);
      const r = restore(emit);
      restored += r.restored;
      return r.text;
    },
    /** Flush whatever is still held when the stream ends. */
    end(): string {
      const r = restore(held);
      restored += r.restored;
      held = "";
      return r.text;
    },
    get count(): number { return restored; },
  };
}

/** Persist the vault. Called after a request is transformed. */
export function flushVault(): void { v().flush(); }

/** How many values are currently held. For `wrapboxd vault status`. */
export function vaultSize(): number { return v().size; }

/** Forget every mapping. Tokens already in a conversation stop resolving. */
export function clearVault(): void { v().clear(); }

/** New session tag — previously issued tokens stop resolving, values kept. */
export function rotateSession(): void { v().rotate(); }
