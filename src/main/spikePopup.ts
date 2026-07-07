import { BrowserWindow, Menu, MessageChannelMain, ipcMain } from "electron";
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
/** autoRun chains its phase 2 off the native menu's dismissal. */
let onMenuDismissed: (() => void) | null = null;

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

  // native Menu.popup — Chromium renders these as xdg_popup, the ONE positioned surface Wayland
  // allows. A representative feature spread so the look can be judged against carapace's menus.
  ipcMain.handle("spike:native-menu", (_e, at: { x: number; y: number }) => {
    const parent = getParent();
    if (!parent) return;
    const menu = Menu.buildFromTemplate([
      { label: "Close", accelerator: "Ctrl+W", click: () => log("native menu click", { item: "close" }) },
      { label: "Close Others", accelerator: "Ctrl+Alt+P", enabled: false },
      { type: "separator" },
      { label: "Pinned", type: "checkbox", checked: true, click: () => log("native menu click", { item: "pinned" }) },
      { label: "View Mode", submenu: [
        { label: "Diffuse", type: "radio", checked: false },
        { label: "Normal", type: "radio", checked: true },
        { label: "Coverage", type: "radio", checked: false },
      ] },
      { type: "separator" },
      { label: "Reveal in Explorer View", click: () => log("native menu click", { item: "reveal" }) },
    ]);
    log("native menu popup at", at);
    menu.popup({
      window: parent,
      x: at.x,
      y: at.y,
      callback: () => {
        log("native menu closed", {});
        onMenuDismissed?.();
      },
    });
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
    // phase 1 (2s): native Menu.popup at (300,200) window-relative — judge position + LOOK.
    // It stays up until dismissed (click an item / click away), then phase 2 (transient window)
    // runs 2s later; everything tears down 10s after that.
    setTimeout(() => {
      void parent.webContents.executeJavaScript(`window.lambertHost.spikeNativeMenu({ x: 300, y: 200 })`);
    }, 2000);
    let phase2 = false;
    onMenuDismissed = () => {
      if (phase2) return;
      phase2 = true;
      setTimeout(() => {
        void parent.webContents.executeJavaScript(
          `window.lambertHost.spikePopupOpen({ dx: 300, dy: 200, w: 320, h: 240, payload: "hello-from-query" })`,
        );
      }, 2000);
      setTimeout(() => {
        console.log("[spike] auto-run complete, exiting");
        parent.destroy();
      }, 12000);
    };
  });
}
