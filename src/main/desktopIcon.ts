import { readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, nativeImage } from "electron";

/**
 * Keep the Linux desktop integration's icon in step with the app.
 *
 * The AppImage self-update swaps the binary in place, but the desktop integration —
 * `~/.local/share/applications/lambert.desktop` pointing `Icon=lambert` at hicolor theme
 * copies under `~/.local/share/icons/hicolor/<size>/apps/lambert.png` — is a one-time
 * install (AppImageLauncher or by hand). Nothing refreshes those copies, so a logo change
 * shipped by auto-update leaves the launcher/taskbar painting the old icon forever.
 *
 * On every packaged Linux startup: if the integration exists, re-render the bundled icon
 * (extraResources icon.png) at each installed size and overwrite copies whose bytes differ,
 * then bump the theme dir's mtime so GTK/KDE icon caches notice. Only sizes the integration
 * already installed are touched — this maintains an existing install, it never creates one.
 * Best-effort: any failure is logged and ignored (a stale icon must never block launch).
 */
export async function syncLinuxDesktopIcon(): Promise<void> {
  if (process.platform !== "linux" || !app.isPackaged) return;
  try {
    const home = app.getPath("home");
    const share = join(home, ".local", "share");
    // no .desktop entry = no integration to maintain
    await readFile(join(share, "applications", "lambert.desktop"));

    const source = nativeImage.createFromPath(join(process.resourcesPath, "icon.png"));
    if (source.isEmpty()) return;

    const themeRoot = join(share, "icons", "hicolor");
    let changed = 0;
    for (const dir of await readdir(themeRoot)) {
      const m = /^(\d+)x\1$/.exec(dir);
      if (!m) continue;
      const size = Number(m[1]);
      const target = join(themeRoot, dir, "apps", "lambert.png");
      const have = await readFile(target).catch(() => null);
      if (!have) continue; // this size was never installed
      const want = source.resize({ width: size, height: size }).toPNG();
      if (have.equals(want)) continue;
      await writeFile(target, want);
      changed += 1;
    }
    if (changed > 0) {
      // Icon caches key off the theme directory mtime (icon-theme.spec); a touch is the
      // portable nudge. gtk-update-icon-cache isn't guaranteed present, so don't shell out.
      const now = new Date();
      await utimes(themeRoot, now, now).catch(() => undefined);
      console.log(`desktop icon refreshed (${changed} size${changed === 1 ? "" : "s"})`);
    }
  } catch {
    // unintegrated install, sandboxed paths, read-only home — all fine, just skip
  }
}
