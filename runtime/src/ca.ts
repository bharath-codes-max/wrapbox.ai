/**
 * Wrapbox local certificate authority.
 *
 * To read what an agent or a browser is actually sending — the prompt text,
 * the attached file — the proxy has to terminate TLS itself. That means
 * presenting a certificate for whatever host was requested, signed by a root
 * the device already trusts.
 *
 * WHY THIS IS ALLOWED TO WORK: browsers deliberately exempt locally-installed
 * roots from certificate pinning. Pinning protects against a rogue public CA,
 * not against the machine's own administrator. That carve-out exists precisely
 * for corporate inspection, and it is why this approach works in Chrome,
 * Safari and Edge without warnings once the root is trusted.
 *
 * TOOLING: shells out to /usr/bin/openssl — the LibreSSL that ships with every
 * macOS. Deliberately NOT Homebrew's openssl, which exists on this developer's
 * Mac but not on a customer's. Verified working on LibreSSL 3.3.6.
 *
 * KEYS: EC P-256, because RSA-2048 keygen costs ~100ms per host and P-256
 * costs ~1ms. Every browser has accepted EC server certificates for years.
 *
 * SECURITY: the CA private key is the crown jewel — anyone holding it can
 * impersonate any site to this device. It is written 0600 and never leaves
 * the device. In production it belongs in the Keychain or a TPM/Secure
 * Enclave, which is noted as a known gap for the prototype.
 */

import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import { PATHS } from "./config.js";

const run = promisify(execFile);

/** The system openssl. Guaranteed present on macOS; never Homebrew's. */
const OPENSSL = "/usr/bin/openssl";

export const CA_PATHS = {
  dir: path.join(PATHS.home, "ca"),
  key: path.join(PATHS.home, "ca", "wrapbox-ca.key"),
  cert: path.join(PATHS.home, "ca", "wrapbox-ca.crt"),
  leaves: path.join(PATHS.home, "ca", "leaves"),
} as const;

const CA_SUBJECT_CN = "Wrapbox Root CA";
const CA_DAYS = 3650;
const LEAF_DAYS = 30;

/* ------------------------------------------------------------------ *
 * Root CA
 * ------------------------------------------------------------------ */

export function caExists(): boolean {
  return fs.existsSync(CA_PATHS.key) && fs.existsSync(CA_PATHS.cert);
}

function caConfig(): string {
  return [
    "[req]",
    "distinguished_name=dn",
    "x509_extensions=v3",
    "prompt=no",
    "[dn]",
    `CN=${CA_SUBJECT_CN}`,
    "O=Wrapbox",
    "OU=Endpoint Runtime",
    "[v3]",
    // pathlen:0 — this CA may sign server certificates but may NOT sign
    // another CA. It limits the blast radius if the key ever leaks.
    "basicConstraints=critical,CA:TRUE,pathlen:0",
    "keyUsage=critical,keyCertSign,cRLSign",
    "subjectKeyIdentifier=hash",
    "",
  ].join("\n");
}

/** Create the root CA if it does not exist. Returns the PEM certificate. */
export function ensureCA(): { certPem: string; created: boolean } {
  if (caExists()) {
    return { certPem: fs.readFileSync(CA_PATHS.cert, "utf-8"), created: false };
  }

  fs.mkdirSync(CA_PATHS.dir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(CA_PATHS.leaves, { recursive: true, mode: 0o700 });

  const cnfPath = path.join(CA_PATHS.dir, "ca.cnf");
  fs.writeFileSync(cnfPath, caConfig(), { mode: 0o600 });

  try {
    execFileSync(OPENSSL, ["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", CA_PATHS.key], { stdio: "pipe" });
    fs.chmodSync(CA_PATHS.key, 0o600);

    execFileSync(OPENSSL, [
      "req", "-x509", "-new",
      "-key", CA_PATHS.key,
      "-sha256",
      "-days", String(CA_DAYS),
      "-out", CA_PATHS.cert,
      "-config", cnfPath,
    ], { stdio: "pipe" });
    fs.chmodSync(CA_PATHS.cert, 0o644);
  } finally {
    try { fs.unlinkSync(cnfPath); } catch { /* best effort */ }
  }

  return { certPem: fs.readFileSync(CA_PATHS.cert, "utf-8"), created: true };
}

/** SHA-256 fingerprint of the CA certificate, for display and verification. */
export function caFingerprint(): string | null {
  if (!fs.existsSync(CA_PATHS.cert)) return null;
  try {
    const out = execFileSync(OPENSSL, ["x509", "-in", CA_PATHS.cert, "-noout", "-fingerprint", "-sha256"], {
      stdio: "pipe", encoding: "utf-8",
    });
    return out.split("=")[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Leaf certificates
 * ------------------------------------------------------------------ */

/**
 * A hostname is safe to put in a certificate SAN only if it is a plain DNS
 * name or an IP. Anything else is rejected rather than escaped — the host
 * string comes from the CONNECT line, which is attacker-influenced, and it
 * ends up inside an openssl config file.
 */
function sanEntryFor(host: string): string | null {
  if (net.isIP(host)) return `IP:${host}`;
  // DNS label rules: letters, digits, hyphen, dots. No wildcards — we mint per
  // exact host, so a wildcard would only widen what this cert can impersonate.
  if (/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(host) && host.length <= 253) {
    return `DNS:${host}`;
  }
  return null;
}

function leafConfig(host: string, san: string): string {
  return [
    "[req]",
    "distinguished_name=dn",
    "prompt=no",
    "[dn]",
    `CN=${host.slice(0, 64)}`, // CN is capped at 64 chars; SAN is what browsers actually read
    "[v3]",
    "basicConstraints=critical,CA:FALSE",
    "keyUsage=critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage=serverAuth",
    `subjectAltName=${san}`,
    "",
  ].join("\n");
}

/** Disk path for a host's cached leaf material. Hashed so odd hosts can't escape the dir. */
function leafPathFor(host: string): string {
  const safe = crypto.createHash("sha256").update(host).digest("hex").slice(0, 32);
  return path.join(CA_PATHS.leaves, safe);
}

export interface Leaf {
  key: string;
  cert: string;
}

/** Mint (or load from cache) a server certificate for `host`, signed by our CA. */
export function mintLeaf(host: string): Leaf {
  ensureCA();

  const san = sanEntryFor(host);
  if (!san) throw new Error(`refusing to mint a certificate for an invalid hostname: ${JSON.stringify(host)}`);

  const base = leafPathFor(host);
  const keyPath = `${base}.key`;
  const crtPath = `${base}.crt`;

  // Reuse a cached leaf while it is still valid. `-checkend` exits non-zero
  // when the certificate expires within the given window.
  if (fs.existsSync(keyPath) && fs.existsSync(crtPath)) {
    try {
      execFileSync(OPENSSL, ["x509", "-in", crtPath, "-noout", "-checkend", "86400"], { stdio: "pipe" });
      return { key: fs.readFileSync(keyPath, "utf-8"), cert: fs.readFileSync(crtPath, "utf-8") };
    } catch {
      // Expired or unreadable — fall through and mint a fresh one.
    }
  }

  fs.mkdirSync(CA_PATHS.leaves, { recursive: true, mode: 0o700 });
  const cnfPath = `${base}.cnf`;
  const csrPath = `${base}.csr`;
  fs.writeFileSync(cnfPath, leafConfig(host, san), { mode: 0o600 });

  try {
    execFileSync(OPENSSL, ["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", keyPath], { stdio: "pipe" });
    fs.chmodSync(keyPath, 0o600);

    execFileSync(OPENSSL, ["req", "-new", "-key", keyPath, "-out", csrPath, "-config", cnfPath], { stdio: "pipe" });

    // Random serial rather than -CAcreateserial: two connections to two new
    // hosts can mint concurrently, and a shared .srl file is a race.
    const serial = crypto.randomBytes(16).toString("hex");

    execFileSync(OPENSSL, [
      "x509", "-req",
      "-in", csrPath,
      "-CA", CA_PATHS.cert,
      "-CAkey", CA_PATHS.key,
      "-set_serial", `0x${serial}`,
      "-out", crtPath,
      "-days", String(LEAF_DAYS),
      "-sha256",
      "-extfile", cnfPath,
      "-extensions", "v3",
    ], { stdio: "pipe" });
  } finally {
    try { fs.unlinkSync(cnfPath); } catch { /* best effort */ }
    try { fs.unlinkSync(csrPath); } catch { /* best effort */ }
  }

  return { key: fs.readFileSync(keyPath, "utf-8"), cert: fs.readFileSync(crtPath, "utf-8") };
}

/**
 * SecureContext cache. Building a context is far more expensive than the
 * cache lookup, and a busy browser opens many connections to the same host.
 */
const contexts = new Map<string, tls.SecureContext>();

export function secureContextFor(host: string): tls.SecureContext {
  let ctx = contexts.get(host);
  if (ctx) return ctx;
  const leaf = mintLeaf(host);
  ctx = tls.createSecureContext({ key: leaf.key, cert: leaf.cert });
  contexts.set(host, ctx);
  return ctx;
}

/** Drop cached contexts (used by `unprotect-network` and tests). */
export function clearContextCache(): void {
  contexts.clear();
}

/* ------------------------------------------------------------------ *
 * Trust store
 * ------------------------------------------------------------------ */

const SYSTEM_KEYCHAIN = "/Library/Keychains/System.keychain";

/**
 * Is our CA trusted as a root on this device?
 *
 * `security verify-cert` is the honest check — it asks the OS to evaluate the
 * certificate the way a TLS client would, rather than merely checking that the
 * file was imported somewhere.
 */
export async function isTrusted(): Promise<boolean> {
  if (!fs.existsSync(CA_PATHS.cert)) return false;
  try {
    await run("security", ["verify-cert", "-c", CA_PATHS.cert, "-p", "ssl"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Install the CA as a trusted root in the SYSTEM keychain.
 *
 * Requires administrator rights, so this prompts for a password. That prompt
 * is correct and should not be engineered away: adding a root certificate is
 * exactly the kind of change a person should have to approve.
 *
 * In a managed fleet this same certificate arrives as an MDM configuration
 * profile instead — silent, and the production path.
 */
export async function installTrust(): Promise<void> {
  ensureCA();
  await run("sudo", [
    "security", "add-trusted-cert",
    "-d",                       // add to the admin (system-wide) trust domain
    "-r", "trustRoot",          // trust it as a root, not merely as a leaf
    "-p", "ssl",                // ...for SSL/TLS specifically, nothing else
    "-k", SYSTEM_KEYCHAIN,
    CA_PATHS.cert,
  ]);
}

/**
 * Remove the CA from the system trust store.
 *
 * `remove-trusted-cert` drops the trust setting; `delete-certificate` removes
 * the certificate itself. Both are attempted so an uninstall leaves nothing
 * behind — a security tool that cannot fully uninstall itself is a liability.
 */
export async function uninstallTrust(): Promise<void> {
  if (!fs.existsSync(CA_PATHS.cert)) return;
  try {
    await run("sudo", ["security", "remove-trusted-cert", "-d", CA_PATHS.cert]);
  } catch { /* was not trusted */ }
  try {
    await run("sudo", ["security", "delete-certificate", "-c", CA_SUBJECT_CN, SYSTEM_KEYCHAIN]);
  } catch { /* was not present */ }
  clearContextCache();
}

export interface CaStatus {
  exists: boolean;
  trusted: boolean;
  fingerprint: string | null;
  certPath: string;
  leafCount: number;
}

export async function caStatus(): Promise<CaStatus> {
  let leafCount = 0;
  try {
    leafCount = fs.readdirSync(CA_PATHS.leaves).filter((f) => f.endsWith(".crt")).length;
  } catch { /* no leaves yet */ }

  return {
    exists: caExists(),
    trusted: await isTrusted(),
    fingerprint: caFingerprint(),
    certPath: CA_PATHS.cert,
    leafCount,
  };
}
