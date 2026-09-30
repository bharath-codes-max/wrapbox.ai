import { useSyncExternalStore } from "react";

/** Top bar style: matte black (default) or off-white. Kept per browser. */
export type NavStyle = "black" | "light";

const KEY = "wbx-nav";
let current: NavStyle = (() => {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "black";
  } catch {
    return "black";
  }
})();
const subs = new Set<() => void>();

export function setNavStyle(v: NavStyle) {
  current = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* storage blocked — the choice lasts for this visit */
  }
  subs.forEach((f) => f());
}

export function useNavStyle(): NavStyle {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
  );
}
