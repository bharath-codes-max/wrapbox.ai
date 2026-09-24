/**
 * The token-vault key — where the secret that protects the reversible-token
 * vault lives, and how the vault file is sealed with it.
 *
 * On macOS the key is a random 32-byte value stored in the login Keychain
 * (`security add-generic-password`, service "io.wrapbox.vault"), so the
 * ciphertext on disk is useless without the user's Keychain. Elsewhere, or if
 * the Keychain is unavailable, the key is a 0600 file under WRAPBOX_HOME and
 * the capability snapshot says so ("vault.keychain: false") — a weaker but
 * honest fallback, never silent.
 *
 * Sealing: AES-256-GCM, random 12-byte IV per write, the version tag bound as
 * AAD. The plaintext vault format that existed before is migrated on first
 * load and then shredded.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PATHS } from "./config.js";

const SERVICE = "io.wrapbox.vault";
const KEY_FILE = () => path.join(PATHS.home, "vault.key");
const VERSION = "wbxv1";

let cached: { key: Buffer; source: "keychain" | "file" } | null = null;

function account(): string {
  // One key per WRAPBOX_HOME so two state dirs on one Mac never share a vault.
  return crypto.createHash("sha256").update(PATHS.home).digest("hex").slice(0, 16);
}

function keychainGet(): Buffer | null {
  if (process.platform !== "darwin") return null;
  try {
    const out = execFileSync("security", ["find-generic-password", "-s", SERVICE, "-a", account(), "-w"], { stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).toString().trim();
    const key = Buffer.from(out, "hex");
    return key.length === 32 ? key : null;
  } catch { return null; }
}

function keychainSet(key: Buffer): boolean {
  if (process.platform !== "darwin") return false;
  try {
    execFileSync("security", ["add-generic-password", "-s", SERVICE, "-a", account(), "-w", key.toString("hex"), "-U", "-T", ""], { stdio: "ignore", timeout: 3000 });
    return keychainGet() !== null;
  } catch { return false; }
}

function fileGet(): Buffer | null {
  try {
    const key = Buffer.from(fs.readFileSync(KEY_FILE(), "utf-8").trim(), "hex");
    return key.length === 32 ? key : null;
  } catch { return null; }
}

function fileSet(key: Buffer): void {
  fs.mkdirSync(PATHS.home, { recursive: true });
  fs.writeFileSync(KEY_FILE(), key.toString("hex") + "\n", { mode: 0o600 });
  fs.chmodSync(KEY_FILE(), 0o600);
}

/** Obtain (or create) the vault key. Keychain first, file fallback. */
export function vaultKey(): { key: Buffer; source: "keychain" | "file" } {
  if (cached) return cached;
  const allowKeychain = process.env.WRAPBOX_VAULT_KEYCHAIN !== "0";
  let key = allowKeychain ? keychainGet() : null;
  if (key) { cached = { key, source: "keychain" }; return cached; }
  key = fileGet();
  if (key) { cached = { key, source: "file" }; return cached; }
  key = crypto.randomBytes(32);
  if (allowKeychain && keychainSet(key)) { cached = { key, source: "keychain" }; return cached; }
  fileSet(key);
  cached = { key, source: "file" };
  return cached;
}

/** For the capability snapshot: is the vault key held by the OS keychain? */
export function vaultKeySource(): "keychain" | "file" { return vaultKey().source; }

export function seal(plaintext: Buffer): Buffer {
  const { key } = vaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(VERSION));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from(VERSION), iv, cipher.getAuthTag(), ct]);
}

/** Returns null when the blob is not ours, was tampered with, or the key does not match. */
export function open(blob: Buffer): Buffer | null {
  if (blob.length < VERSION.length + 12 + 16) return null;
  if (blob.subarray(0, VERSION.length).toString() !== VERSION) return null;
  const iv = blob.subarray(VERSION.length, VERSION.length + 12);
  const tag = blob.subarray(VERSION.length + 12, VERSION.length + 28);
  const ct = blob.subarray(VERSION.length + 28);
  try {
    const { key } = vaultKey();
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAAD(Buffer.from(VERSION));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  } catch { return null; }
}

export function isSealed(blob: Buffer): boolean {
  return blob.length >= VERSION.length && blob.subarray(0, VERSION.length).toString() === VERSION;
}

/** Test hook: forget the cached key (a fresh WRAPBOX_HOME gets a fresh key). */
export function resetVaultKeyCache(): void { cached = null; }
