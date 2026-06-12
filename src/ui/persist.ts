import { useState } from "react";

/**
 * localStorage-backed state — the "memory" pattern from the Space2D editor's workspace
 * persistence, reduced to a hook. Survives restarts; bad/missing entries fall back.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const storageKey = `lambert:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      // fall back to the pre-rename "flatland:" key so migrated settings survive
      const raw = localStorage.getItem(storageKey) ?? localStorage.getItem(`flatland:${key}`);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = (v: T | ((p: T) => T)): void => {
    setValue((prev) => {
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // storage full/denied: state still works for the session
      }
      return next;
    });
  };
  return [value, set];
}
