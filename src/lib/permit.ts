// Real cryptography, simulated control plane: permits are signed with an
// in-browser ECDSA P-256 key and verified the way an executor would.

export interface Permit {
  id: string;
  kid: string;
  decision_id: string;
  subject_agent: string;
  on_behalf_of: string;
  action: string;
  resource: string;
  args_hash: string;
  environment: string;
  approved_by: string[];
  issued_at: number;
  expires_at: number;
  nonce: string;
  signature: string;
}

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

const enc = new TextEncoder();
let keys: Promise<CryptoKeyPair> | null = null;
const getKeys = () =>
  (keys ??= crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]) as Promise<CryptoKeyPair>);

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromB64url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]),
    );
  return v;
}
export const canonical = (v: unknown) => JSON.stringify(sortDeep(v));

export async function sha256(s: string) {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
export const newDecisionId = () => "d-" + rand(3);

const usedNonces = new Set<string>();
/** The control plane's current signing key id. Shown wherever a permit's provenance is. */
export const KID = "wbx-2026-09";

type PermitInput = Omit<Permit, "id" | "kid" | "args_hash" | "issued_at" | "expires_at" | "nonce" | "signature"> & {
  args: Record<string, unknown>;
  ttl?: number;
  /** The id assigned when the request was opened, so the evidence record and the permit agree. */
  id?: string;
};

export async function mintPermit(input: PermitInput): Promise<Permit> {
  const { args, ttl = 60, id, ...rest } = input;
  const issued = Date.now();
  const body = {
    ...rest,
    id: id ?? "wbp_" + rand(4),
    kid: KID,
    args_hash: "sha256:" + (await sha256(canonical(args))),
    issued_at: issued,
    expires_at: issued + ttl * 1000,
    nonce: rand(4),
  };
  const { privateKey } = await getKeys();
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, enc.encode(canonical(body)));
  return { ...body, signature: "es256:" + b64url(sig) };
}

/** What the payment service / executor runs before it performs the effect. */
export async function verifyPermit(
  p: Permit,
  attemptedArgs: Record<string, unknown>,
  opts: { consume?: boolean; probe?: boolean } = {},
): Promise<Check[]> {
  const { consume = true, probe = false } = opts;
  const { signature, ...body } = p;
  const { publicKey } = await getKeys();
  const sigOk = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    fromB64url(signature.replace("es256:", "")),
    enc.encode(canonical(body)),
  );
  const attemptedHash = "sha256:" + (await sha256(canonical(attemptedArgs)));
  const now = Date.now();
  const fresh = now < p.expires_at;
  const argsOk = attemptedHash === p.args_hash;
  // A tamper probe models the altered call arriving instead of the approved one.
  const nonceOk = probe || !usedNonces.has(p.nonce);
  const checks: Check[] = [
    { label: "Signature", ok: sigOk, detail: sigOk ? `valid · ${p.kid}` : "does not verify" },
    { label: "Not expired", ok: fresh, detail: fresh ? `${Math.ceil((p.expires_at - now) / 1000)}s left` : "expired" },
    {
      label: "Arguments match",
      ok: argsOk,
      detail: argsOk ? short(attemptedHash) : `${short(attemptedHash)} ≠ ${short(p.args_hash)}`,
    },
    { label: "Nonce unused", ok: nonceOk, detail: nonceOk ? p.nonce : "replay detected" },
  ];
  if (consume && checks.every((c) => c.ok)) usedNonces.add(p.nonce);
  return checks;
}

export const short = (h: string) => {
  const [alg, v] = h.includes(":") ? h.split(":") : ["", h];
  return (alg ? alg + ":" : "") + v.slice(0, 6) + "…" + v.slice(-4);
};

/* ---------- Approver passkeys: an approval is a signature, not a click ---------- */
const approverKeys = new Map<string, Promise<CryptoKeyPair>>();
const keyFor = (personId: string) => {
  if (!approverKeys.has(personId))
    approverKeys.set(personId, crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]) as Promise<CryptoKeyPair>);
  return approverKeys.get(personId)!;
};

/** Signs the exact action being approved with the approver's device-bound key. */
export async function signApproval(personId: string, payload: { gate: string; args: Record<string, unknown> }) {
  const body = canonical({ approver: personId, gate: payload.gate, args_hash: await sha256(canonical(payload.args)), at: Date.now() });
  const { privateKey } = await keyFor(personId);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, enc.encode(body));
  return "es256:" + b64url(sig).slice(0, 22);
}
