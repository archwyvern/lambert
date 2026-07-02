/**
 * Minimal path helpers for the renderer (no node:path there). Separator-agnostic: they accept BOTH
 * posix `/` and Windows `\`, and preserve drive-letter roots (`C:\`, `C:/`) — on Windows the main process
 * hands the renderer backslash paths, so posix-only slicing broke dirname/basename/join there.
 */

const SEP_RE = /[/\\]/;

/** The separator a path is written with (Windows `\` if it uses any, else posix `/`). */
function sepOf(p: string): string {
  return p.includes("\\") ? "\\" : "/";
}

/** Split an absolute path's root prefix from the rest: `"/"` (posix), `"C:\\"`/`"C:/"` (drive), or `""`
 *  (relative). */
function splitRoot(p: string): { root: string; rest: string } {
  const drive = /^[a-zA-Z]:[/\\]?/.exec(p);
  if (drive) return { root: drive[0], rest: p.slice(drive[0].length) };
  if (SEP_RE.test(p[0] ?? "")) return { root: p.slice(0, 1), rest: p.slice(1) };
  return { root: "", rest: p };
}

export function dirname(p: string): string {
  const { root, rest } = splitRoot(p);
  const segs = rest.split(SEP_RE).filter(Boolean);
  if (segs.length <= 1) return root || "."; // a bare root, or a single relative segment
  return (root || "") + segs.slice(0, -1).join(sepOf(p));
}

export function basename(p: string): string {
  const segs = splitRoot(p).rest.split(SEP_RE).filter(Boolean);
  return segs.length ? segs[segs.length - 1]! : "";
}

export function joinPath(dir: string, rel: string): string {
  const sep = sepOf(dir);
  const { root, rest } = splitRoot(dir);
  const out: string[] = [];
  for (const part of [...rest.split(SEP_RE), ...rel.split(SEP_RE)]) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return (root || sep) + out.join(sep);
}
