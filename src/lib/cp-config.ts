/**
 * Control Plane connection config, kept in localStorage only.
 * Server URL, admin key and org id are typed by an admin on the Settings screen —
 * they are never bundled, never written to any log/rule/YAML, never sent to the
 * browser DOM outside the Settings card that owns them (the admin-key input is
 * a password field there).
 */

import { useSyncExternalStore } from "react";

export interface CpConfig {
  server: string;
  adminKey: string;
  orgId: string;
}

const KEY = "wbx-cp-config";
const EMPTY: CpConfig = { server: "", adminKey: "", orgId: "" };

function read(): CpConfig {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<CpConfig>;
    return {
      server: typeof parsed.server === "string" ? parsed.server.trim() : "",
      adminKey: typeof parsed.adminKey === "string" ? parsed.adminKey : "",
      orgId: typeof parsed.orgId === "string" ? parsed.orgId.trim() : "",
    };
  } catch {
    return { ...EMPTY };
  }
}

let current: CpConfig = read();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getCpConfig(): CpConfig {
  return current;
}

export function setCpConfig(patch: Partial<CpConfig>) {
  const next: CpConfig = {
    server: (patch.server ?? current.server ?? "").trim(),
    adminKey: patch.adminKey ?? current.adminKey ?? "",
    orgId: (patch.orgId ?? current.orgId ?? "").trim(),
  };
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: keep it in-memory */
  }
  emit();
}

export function clearCpConfig() {
  current = { ...EMPTY };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
}

export function cpConfigComplete(c: CpConfig = current): boolean {
  return !!(c.server && c.adminKey && c.orgId);
}

/** Cross-tab: another tab wrote our key, keep the in-memory copy in sync. */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    current = read();
    emit();
  });
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export const subscribeCpConfig = subscribe;

export function useCpConfig(): CpConfig {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
