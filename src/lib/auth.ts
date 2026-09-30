import { useSyncExternalStore } from "react";

// Prototype sign-in. Any email works; the password is a shared access code.
const ACCESS_CODE = "96183";
const KEY = "wbx-auth";

export interface Account {
  email: string;
  name?: string;
  company?: string;
}

let account: Account | null = (() => {
  // Local screenshots only: the dev server accepts ?shot=1 to skip sign-in. Never active in a build.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("shot")) return { email: "priya@wrapbox.ai", name: "Priya Menon" };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
})();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const checkPassword = (pw: string) => pw.trim() === ACCESS_CODE;

export function signIn(a: Account) {
  account = a;
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* storage blocked — signed in for this visit only */
  }
  emit();
}

export function signOut() {
  account = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
  emit();
}

export function useAccount(): Account | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => account,
  );
}
