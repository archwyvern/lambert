import { useEffect } from "react";
import { DocumentStore } from "../document/store";
import { emptyDoc } from "../document/schema";
import { findNode } from "../document/layerOps";
import { Tab, Workspace } from "../document/workspace";
import type { ViewState } from "./App";
import { VIEW_MODES, type ViewMode } from "./preview";
import { TOOL_KEYS, type ToolMode } from "./tools";

/**
 * Demo bootstrap for automated captures (QC-CARRY-2 extraction from App): `?demo` builds a one-tab
 * in-memory project from the golden/masked/mesh fixtures, applies the `mode/swap/newdoc/select/tool/
 * cmenu` capture aids, and flags `window.__lambertDemoReady` once the scene is interactable — the
 * `--capture` readiness probe gates the screenshot on it.
 */
export function useDemoBootstrap(opts: {
  setWorkspace: (ws: Workspace) => void;
  setViews: (views: Record<string, ViewState>) => void;
  setSwapped: (fn: boolean | ((sw: boolean) => boolean)) => void;
  setNewDocPath: (p: string | null) => void;
  setSelVerts: (v: number[]) => void;
  setTool: (t: ToolMode) => void;
  /** Passed in (not imported) so this hook keeps a type-only dependency on App. */
  defaultView: ViewState;
}): void {
  const { setWorkspace, setViews, setSwapped, setNewDocPath, setSelVerts, setTool, defaultView } = opts;
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (!q.has("demo")) return;
    void Promise.all([import("fast-png"), import("../field/fixtures")])
      .then(([{ encode }, { goldenObjects, maskedObjects, meshObjects, pipeObjects, vectorFillObjects }]) => {
        const w = 96;
        const h = 96;
        const data = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          data[i * 4] = 96;
          data[i * 4 + 1] = 104;
          data[i * 4 + 2] = 118;
          data[i * 4 + 3] = 255;
        }
        const objects = q.has("masked") ? maskedObjects() : q.has("mesh") ? meshObjects() : q.has("paths") ? [...pipeObjects(), ...vectorFillObjects()] : goldenObjects();
        const doc = { ...emptyDoc("file:///demo/demo.df.png", w, h), layers: objects };
        const ws = new Workspace("/demo", { schemaVersion: 1, normalDirs: { red: "right", green: "up" } });
        const tab: Tab = {
          id: crypto.randomUUID(),
          docPath: null,
          store: new DocumentStore(doc, null),
          diffuse: { bytes: encode({ width: w, height: h, data }) },
        };
        ws.openTab(tab);
        const mode = q.get("mode");
        const v: ViewState = { ...defaultView };
        if (mode && (VIEW_MODES as string[]).includes(mode)) v.mode = mode as ViewMode;
        if (q.has("swap")) setSwapped(true);
        if (q.has("newdoc")) setNewDocPath("/demo/untitled.lmb"); // capture aid: open the source modal
        setWorkspace(ws);
        setViews({ [tab.id]: v });
        const select = q.get("select");
        if (select) tab.store.select(findNode(doc.layers, select)?.id ?? doc.layers[0]?.id ?? null);
        const t = q.get("tool");
        if (t && t in TOOL_KEYS) setTool(TOOL_KEYS[t]!);
        const markReady = (): void => {
          (window as unknown as { __lambertDemoReady?: boolean }).__lambertDemoReady = true;
        };
        if (q.has("drag")) {
          // capture aid: synthesize a left-button pointer drag `drag=x0,y0,x1,y1` (window px) on the
          // element under the start point — drives marquee/move flows for automated visual checks
          const [x0, y0, x1, y1] = q.get("drag")!.split(",").map(Number) as [number, number, number, number];
          setTimeout(() => {
            const target = document.elementFromPoint(x0, y0);
            if (target) {
              const ev = (type: string, x: number, y: number): PointerEvent =>
                new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 7, isPrimary: true, clientX: x, clientY: y });
              target.dispatchEvent(ev("pointerdown", x0, y0));
              const steps = 8;
              for (let s = 1; s <= steps; s++) {
                target.dispatchEvent(ev("pointermove", x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps));
              }
              target.dispatchEvent(ev("pointerup", x1, y1));
            }
            markReady();
          }, 300);
        } else if (q.has("cmenu")) {
          const onEdge = q.get("cmenu") === "edge";
          setTimeout(() => {
            if (!onEdge) setSelVerts([0, 2]);
            setTimeout(() => {
              const sel = onEdge ? "svg line.cursor-context-menu" : "svg circle.cursor-move";
              const c = document.querySelector<SVGElement>(sel);
              if (c) {
                const r = c.getBoundingClientRect();
                c.dispatchEvent(
                  new MouseEvent("contextmenu", { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }),
                );
              }
              markReady();
            }, 150);
          }, 150);
        } else {
          markReady();
        }
      })
      .catch((err: unknown) => console.error("demo bootstrap failed", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
