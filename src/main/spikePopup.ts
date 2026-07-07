import { BrowserWindow, MessageChannelMain, ipcMain } from "electron";
import path from "node:path";

/**
 * #2 SPIKE — transient (parented, frameless) windows on Wayland. Throwaway: lives on the
 * transient-windows branch to answer, with stdout evidence:
 *  1. does a frameless transparent child window render (transparency incl.)?
 *  2. what positioning does the compositor honor (creation x/y, setPosition, getBounds readback)?
 *  3. does blur-dismissal fire?
 *  4. data passing: query payload in, ipc out, and a DIRECT renderer<->renderer MessagePort.
 * Run: `electron . --spike` (after a build). Every finding logs as [spike] lines on stdout.
 */
export function registerPopupSpike(getParent: () => BrowserWindow | null): void {
  let popup: BrowserWindow | null = null;

  const log = (label: string, data: unknown): void => console.log(`[spike] ${label} ${JSON.stringify(data)}`);

  ipcMain.handle("spike:popup-open", async (_e, opts: { dx: number; dy: number; w: number; h: number; payload: string }) => {
    const parent = getParent();
    if (!parent) return null;
    popup?.destroy();
    const pb = parent.getBounds();
    const requested = { x: pb.x + opts.dx, y: pb.y + opts.dy, width: opts.w, height: opts.h };
    log("parent bounds", pb);
    log("requested child bounds", requested);
    const win = new BrowserWindow({
      parent,
      ...requested,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      show: false,
      // sandbox off to match the main window: the ESM preload (.mjs) requires it
      webPreferences: { preload: path.join(import.meta.dirname, "../preload/index.mjs"), sandbox: false },
    });
    popup = win;
    win.webContents.on("console-message", (_e, _level, message) => {
      if (message.startsWith("[spike")) console.log(message);
    });
    win.on("blur", () => {
      log("popup blur", { dismissing: true });
      win.close();
    });
    win.on("closed", () => {
      log("popup closed", {});
      popup = null;
    });
    const q = `popupspike=1&payload=${encodeURIComponent(opts.payload)}`;
    const devUrl = process.env["ELECTRON_RENDERER_URL"];
    if (devUrl) void win.loadURL(`${devUrl}?${q}`);
    else void win.loadFile(path.join(import.meta.dirname, "../renderer/index.html"), { search: `?${q}` });

    await new Promise<void>((resolve) => win.once("ready-to-show", () => resolve()));
    win.show();
    log("bounds after show", win.getBounds());

    // direct renderer<->renderer channel — the state-bridging mechanism a real modal would use
    const { port1, port2 } = new MessageChannelMain();
    parent.webContents.postMessage("spike:port", { role: "parent" }, [port1]);
    win.webContents.postMessage("spike:port", { role: "popup" }, [port2]);

    // does the compositor honor a post-show move?
    setTimeout(() => {
      if (win.isDestroyed()) return;
      win.setPosition(requested.x + 120, requested.y + 80);
      log("bounds after setPosition(+120,+80)", win.getBounds());
    }, 600);
    return win.getBounds();
  });

  ipcMain.handle("spike:popup-close", () => popup?.close());
  // classic via-main relay, both directions (the boring path that always works)
  ipcMain.on("spike:relay-to-parent", (_e, data: unknown) => {
    log("relay popup->parent", data);
    getParent()?.webContents.send("spike:event", { from: "popup", data });
  });
  ipcMain.on("spike:relay-to-popup", (_e, data: unknown) => {
    log("relay parent->popup", data);
    popup?.webContents.send("spike:event", { from: "parent", data });
  });
}

/** --spike auto-run: open the popup 1.5s after the parent loads, close everything at +8s. */
export function autoRunPopupSpike(parent: BrowserWindow): void {
  // renderer console lines land on stdout so the whole experiment reads from one terminal
  for (const wc of [parent.webContents]) {
    wc.on("console-message", (_e, _level, message) => {
      if (message.startsWith("[spike")) console.log(message);
    });
  }
  parent.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      void parent.webContents.executeJavaScript(
        `window.lambertHost.spikePopupOpen({ dx: 300, dy: 200, w: 320, h: 240, payload: "hello-from-query" })`,
      );
    }, 1500);
    setTimeout(() => {
      console.log("[spike] auto-run complete, exiting");
      parent.destroy();
    }, 9000);
  });
}
