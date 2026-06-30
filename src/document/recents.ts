/**
 * Recently-opened projects: a small most-recently-used list, persisted in localStorage (via the
 * renderer's usePersistentState hook) so the launch screen can offer one-click reopen. Pure list
 * ops — no storage or path concerns here, so they're trivially testable.
 */
export interface RecentProject {
  /** Absolute path of the project folder (the one holding project.lambert). */
  path: string;
  /** Display name — the folder's basename at the time it was opened. */
  name: string;
  /** Epoch ms of the most recent open; used only for ordering. */
  lastOpened: number;
}

/** How many projects the list keeps before evicting the oldest. */
export const RECENTS_CAP = 10;

/**
 * Record `path` as the most-recently-opened project: dedup by path (an existing entry moves to the
 * front with the fresh name/time), newest first, capped at `cap`.
 */
export function pushRecent(
  list: RecentProject[],
  path: string,
  name: string,
  now: number,
  cap = RECENTS_CAP,
): RecentProject[] {
  const without = list.filter((r) => r.path !== path);
  return [{ path, name, lastOpened: now }, ...without].slice(0, cap);
}

/** Drop a project from the list (e.g. its folder was moved or deleted). */
export function removeRecent(list: RecentProject[], path: string): RecentProject[] {
  return list.filter((r) => r.path !== path);
}
