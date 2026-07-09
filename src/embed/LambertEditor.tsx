import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Vector2, Vector3 } from "@carapace/primitives";
import { DocumentStore } from "../document/store";
import { addInstanceNear } from "../document/docOps";
import { createFromPreset } from "../field/presets";
import { bakeRings, bezierAnchor } from "../field/bezier";
import { ObjectTypeId } from "../field/registry";
import type { ObjectInstance } from "../field/types";
import { emptyProjectConfig, effectiveOutput, type ProjectConfig } from "../document/schema";
import { nxExtension } from "../document/exports";
import { renderNxBytes } from "../document/io";
import { v2 } from "../field/vec";
import { DocEditor } from "../ui/DocEditor";
import { ToolPalette } from "../ui/ToolPalette";
import { Library } from "../ui/Library";
import { Layers } from "../ui/Layers";
import { use3DCamera } from "../ui/use3DCamera";
import { DEFAULT_VIEW, type ViewState } from "../ui/viewState";
import type { ToolMode } from "../ui/tools";
import type { Viewport } from "../ui/viewport";
import type { DocTab } from "../document/workspace";
import { buildEmbedDoc, serializeEmbedDoc } from "./doc";
import type { EmbedHost } from "./EmbedHost";

const clampPanel = (w: number): number => Math.min(480, Math.max(160, w));
const clampCorner = (h: number): number => Math.min(800, Math.max(120, h));

export interface LambertEditorProps {
  host: EmbedHost;
  /** Fires whenever the document's dirty state flips, so the host can gate navigation away. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * The Lambert editor as an embeddable component: the full editing surface (tool rail, object
 * library, layers, canvas, inspector, 3D preview) for ONE document, with no shell — no file
 * explorer, no tabs, no project settings. State it would get from the desktop workspace it owns
 * locally instead; persistence goes through {@link EmbedHost}. See the skybert plan phase 3.
 *
 * The project config is hardcoded (embed hosts have their own conventions): Ctrl+S saves the doc
 * back to the host, Ctrl+E renders + hands back the NX. The doc is treated as opaque JSON by the
 * host — the editor validates/migrates it on load and emits the current schema on save.
 */
export function LambertEditor({ host, onDirtyChange }: LambertEditorProps): React.JSX.Element {
  // Build the doc + store once, from the host's diffuse + any stored document. The diffuse bytes are
  // injected directly into the tab, so the file-resolver is never consulted.
  const store = useMemo(() => new DocumentStore(buildEmbedDoc(host.diffuse, host.initialDoc), null), [host]);
  const tab = useMemo<DocTab>(
    () => ({ kind: "doc", id: "embed", docPath: null, store, diffuse: { bytes: host.diffuse } }),
    [store, host.diffuse],
  );
  // Embed hosts carry their own encode/output conventions; hardcode Lambert's defaults for now.
  // NOTE (skybert): confirm this matches the host's normal-direction convention and, if not, set
  // normalDirs/output here — this is the single place embed conventions live.
  const config = useMemo<ProjectConfig>(() => emptyProjectConfig(), []);

  const [view, setView] = useState<ViewState>({ ...DEFAULT_VIEW });
  const [tool, setTool] = useState<ToolMode>("select");
  const [selVerts, setSelVerts] = useState<number[]>([]);
  const [viewport, setViewport] = useState<Viewport | undefined>(undefined);
  const [preview3dOn, setPreview3dOn] = useState(false);
  const [boxMode, setBoxMode] = useState<"3d" | "lit">("lit");
  const [boxLitViewport, setBoxLitViewport] = useState<Viewport | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [snap, setSnap] = useState(true);
  const [rulers, setRulers] = useState(true);
  const [pixelGrid, setPixelGrid] = useState(true);
  const [normalAlphaGate, setNormalAlphaGate] = useState(true);
  const [maskFocus, setMaskFocus] = useState<{ nodeId: string; maskId: string; seq: number } | null>(null);
  const [rightWidth, setRightWidth] = useState(288);
  const [cornerHeight, setCornerHeight] = useState(300);
  const [, bumpRender] = useReducer((x: number) => x + 1, 0);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  void rulers; // reserved for a future guides toggle; kept in state for parity with the desktop

  const cam3d = use3DCamera();
  const canvas3dRef = useRef<HTMLCanvasElement>(null);

  // re-render on store changes + forward the dirty flag to the host (route-guard hook)
  useEffect(() => store.subscribe(forceUpdate), [store]);
  const dirtyRef = useRef(false);
  useEffect(() =>
    store.subscribe(() => {
      const d = store.state.dirty;
      if (d !== dirtyRef.current) {
        dirtyRef.current = d;
        onDirtyChange?.(d);
      }
    }), [store, onDirtyChange]);

  const state = store.state;

  // Palette id -> a fresh instance (built-in identity tiles; embed hosts have no saved presets).
  // Adjustment layers default to the full image bounds, like the desktop.
  const resolvePaletteObject = (presetId: string, pos: Vector2): ObjectInstance => {
    const o = createFromPreset(presetId, pos);
    if (o.typeId === ObjectTypeId.Adjust) {
      const d = store.state.doc;
      const hw = d.source.width / 2;
      const hh = d.source.height / 2;
      o.transform = { ...o.transform, pos: new Vector3(hw, hh, o.transform.pos.z) };
      const c = (x: number, y: number) => bezierAnchor(v2(x, y), v2(0, 0), v2(0, 0), "manual");
      const box = [c(-hw, -hh), c(hw, -hh), c(hw, hh), c(-hw, hh)];
      const baked = bakeRings(box, undefined);
      o.bezier = box;
      o.closed = true;
      o.controlPoints = baked.controlPoints;
      o.ringSplit = baked.ringSplit;
      o.contourCounts = baked.contourCounts;
    }
    return o;
  };

  const pickObject = (presetId: string): void => {
    const o = resolvePaletteObject(presetId, v2(state.doc.canvas.origin.x, state.doc.canvas.origin.y));
    store.update((d) => addInstanceNear(d, o, store.state.selectedId));
    store.select(o.id);
    store.endGesture();
  };

  const save = async (): Promise<void> => {
    await host.onSave(serializeEmbedDoc(store.state.doc));
    store.markSaved(""); // clears dirty; the embed has no path
  };

  const exportNx = async (): Promise<void> => {
    const doc = store.state.doc;
    const out = "normal" + nxExtension(effectiveOutput(doc, config));
    const file = await renderNxBytes(doc, host.diffuse, config, out);
    await host.onExportNx(file.bytes, serializeEmbedDoc(doc));
  };

  // familiar shortcuts — the embed has no application menu, so Ctrl+S / Ctrl+E trigger here
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void save();
      } else if (k === "e") {
        e.preventDefault();
        void exportNx();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  return (
    <div className="flex h-full min-h-0 w-full bg-bg text-base text-fg">
      <aside className="flex w-[220px] shrink-0 flex-col bg-bg">
        <div className="p-3 pb-0">
          <Library enabled onPick={pickObject} />
        </div>
        <div className="min-h-0 flex-1 px-3 pt-3">
          <Layers store={store} state={state} />
        </div>
      </aside>
      <ToolPalette tool={tool} setTool={setTool} keyFor={() => undefined} />
      <DocEditor
        tab={tab}
        state={state}
        view={view}
        onView={setView}
        tool={tool}
        onTool={setTool}
        selVerts={selVerts}
        onSelVerts={setSelVerts}
        viewport={viewport}
        onViewport={setViewport}
        onSelectMask={(nodeId, maskId) => setMaskFocus((f) => ({ nodeId, maskId, seq: (f?.seq ?? 0) + 1 }))}
        maskFocus={maskFocus}
        resolvePaletteObject={resolvePaletteObject}
        cam3d={cam3d}
        canvas3dRef={canvas3dRef}
        preview3dOn={preview3dOn}
        onPreview3dToggle={() => setPreview3dOn((v) => !v)}
        boxMode={boxMode}
        onBoxMode={setBoxMode}
        boxLitViewport={boxLitViewport}
        onBoxLitViewport={setBoxLitViewport}
        swapped={swapped}
        onSwapToggle={() => setSwapped((s) => !s)}
        config={config}
        snap={snap}
        onSnap={setSnap}
        rulers={rulers}
        pixelGrid={pixelGrid}
        normalAlphaGate={normalAlphaGate}
        onNormalAlphaGate={setNormalAlphaGate}
        deleteKeys={null}
        openSettings={() => {}}
        rightWidth={rightWidth}
        onRightResize={(dx) => setRightWidth((w) => clampPanel(w - dx))}
        cornerHeight={cornerHeight}
        onCornerResize={(dy) => setCornerHeight((h) => clampCorner(h - dy))}
        onRender={bumpRender}
      />
    </div>
  );
}
