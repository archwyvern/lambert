import { Sash } from "@carapace/shell";
import { Vector2 } from "@carapace/primitives";
import { CanvasView } from "./CanvasView";
import { Inspector } from "./Inspector";
import { Preview3D } from "./Preview3D";
import { ViewControls } from "./ViewControls";
import type { Viewport } from "./viewport";
import type { ViewState } from "./viewState";
import type { EditorState } from "../document/store";
import type { DocTab } from "../document/workspace";
import type { ToolMode } from "./tools";
import type { ObjectInstance } from "../field/types";
import type { use3DCamera } from "./use3DCamera";
import { effectiveNormalDirs, type ProjectConfig } from "../document/schema";

/**
 * The per-document editing surface: the center canvas, the inspector, and the 3D preview box, laid
 * out in one grid. A controlled component — it owns no document/view state, driving everything from
 * props, so the desktop shell (App) and the embedded host (LambertEditor) can both render it around
 * their own state and chrome. See the skybert plan phase 3.
 *
 * This is step 1 of the extraction: the center grid only. The view-controls strip and the
 * left rail (Library/Layers/tools) move in behind here in the following steps.
 */
export interface DocEditorProps {
  /** The active document tab (store, id, resolved diffuse bytes). */
  tab: DocTab;
  /** The tab's live editor state (tab.store.state) — passed explicitly so re-renders track it. */
  state: EditorState;
  view: ViewState;
  onView: (fn: (v: ViewState) => ViewState) => void;
  tool: ToolMode;
  onTool: (t: ToolMode) => void;
  selVerts: number[];
  onSelVerts: React.Dispatch<React.SetStateAction<number[]>>;
  /** Persisted 2D pan/zoom for this tab (undefined = default framing). */
  viewport: Viewport | undefined;
  onViewport: (vp: Viewport) => void;
  /** "Select this mask in the editor" — App bumps a seq so MaskGizmo re-applies for the same mask. */
  onSelectMask: (nodeId: string, maskId: string) => void;
  maskFocus: { nodeId: string; maskId: string; seq: number } | null;
  resolvePaletteObject: (presetId: string, pos: Vector2) => ObjectInstance;
  cam3d: ReturnType<typeof use3DCamera>;
  canvas3dRef: React.RefObject<HTMLCanvasElement | null>;
  preview3dOn: boolean;
  onPreview3dToggle: () => void;
  boxMode: "3d" | "lit";
  onBoxMode: (m: "3d" | "lit") => void;
  boxLitViewport: Viewport | null;
  onBoxLitViewport: (vp: Viewport | null) => void;
  swapped: boolean;
  onSwapToggle: () => void;
  /** Project config — supplies the effective normal-direction encode + adjustment defaults. */
  config: ProjectConfig;
  snap: boolean;
  onSnap: (fn: (s: boolean) => boolean) => void;
  rulers: boolean;
  pixelGrid: boolean;
  normalAlphaGate: boolean;
  onNormalAlphaGate: (fn: (g: boolean) => boolean) => void;
  deleteKeys: string | null;
  openSettings: (screen: string) => void;
  /** Right (inspector) column width + a drag delta handler (App clamps). */
  rightWidth: number;
  onRightResize: (dx: number) => void;
  /** Bottom (3D box) row height + a drag delta handler (App clamps). */
  cornerHeight: number;
  onCornerResize: (dy: number) => void;
  /** Nudge a re-render (Preview3D canvas resize). */
  onRender: () => void;
}

export function DocEditor(props: DocEditorProps): React.JSX.Element {
  const { tab, state, view, onView, config } = props;
  const store = tab.store;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* view/snap/mode controls — a strip above the canvas (embed + desktop share it here) */}
      <div className="flex shrink-0 items-center justify-end border-b border-border bg-bg px-2 py-1">
        <ViewControls
          store={store}
          state={state}
          view={view}
          setView={onView}
          snap={props.snap}
          setSnap={props.onSnap}
          normalAlphaGate={props.normalAlphaGate}
          setNormalAlphaGate={props.onNormalAlphaGate}
        />
      </div>
      <div
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: `minmax(0, 1fr) auto ${props.rightWidth}px`,
          gridTemplateRows: `minmax(0, 1fr) auto ${props.cornerHeight}px`,
          gridTemplateAreas: '"big sash inspector" "big sash rsash" "big sash corner"',
        }}
      >
      <main className="relative min-w-0 overflow-hidden bg-[var(--color-viewport-bg)]" style={{ gridArea: "big" }}>
        <CanvasView
          store={store}
          state={state}
          view={view}
          tool={props.tool}
          diffuseBytes={tab.diffuse.bytes}
          resolvePaletteObject={props.resolvePaletteObject}
          selVerts={props.selVerts}
          setSelVerts={props.onSelVerts}
          maskFocus={props.maskFocus}
          onLightChange={(d) => onView((v) => ({ ...v, lightDir: d }))}
          onEnergyChange={(en) => onView((v) => ({ ...v, lightEnergy: en }))}
          canvas3dRef={props.canvas3dRef}
          orbit3d={props.preview3dOn ? props.cam3d.orbit : null}
          boxMode={props.boxMode}
          boxLitViewport={props.boxLitViewport}
          normalDirs={effectiveNormalDirs(state.doc, config)}
          adjustmentDefaults={config.adjustmentDefaults}
          deleteKeys={props.deleteKeys}
          overridesNormalDirs={state.doc.normalDirs !== undefined}
          openSettings={props.openSettings}
          swapped={props.swapped}
          tabId={tab.id}
          savedViewport={props.viewport}
          onViewportChange={props.onViewport}
          setTool={props.onTool}
          snap={props.snap}
          rulers={props.rulers}
          pixelGrid={props.pixelGrid}
          normalAlphaGate={props.normalAlphaGate}
        />
      </main>
      <div className="flex" style={{ gridArea: "sash" }}>
        <Sash orientation="vertical" onDrag={(dx) => props.onRightResize(dx)} />
      </div>
      <aside className="overflow-y-auto bg-bg p-3" style={{ gridArea: "inspector" }}>
        <Inspector
          store={store}
          state={state}
          selVerts={props.selVerts}
          openSettings={props.openSettings}
          setTool={props.onTool}
          snap={props.snap}
          adjustmentDefaults={config.adjustmentDefaults}
          onSelectMask={(nodeId, maskId) => {
            store.select(nodeId);
            props.onSelectMask(nodeId, maskId);
          }}
        />
      </aside>
      <div style={{ gridArea: "rsash" }}>
        <Sash orientation="horizontal" onDrag={(dy) => props.onCornerResize(dy)} />
      </div>
      <div className="border-t border-border bg-[var(--color-viewport-bg)]" style={{ gridArea: "corner" }} />
      <div
        className="relative overflow-hidden border-t border-border bg-[var(--color-viewport-bg)]"
        style={{ gridArea: props.swapped ? "big" : "corner" }}
      >
        <Preview3D
          cam={props.cam3d}
          canvasRef={props.canvas3dRef}
          docW={state.doc.source.width}
          docH={state.doc.source.height}
          enabled={props.preview3dOn}
          onToggle={props.onPreview3dToggle}
          onResize={props.onRender}
          big={props.swapped}
          onSwap={props.onSwapToggle}
          mode={props.boxMode}
          onModeChange={props.onBoxMode}
          onLitViewport={props.onBoxLitViewport}
          lightDir={view.lightDir}
          onLightChange={(d) => onView((v) => ({ ...v, lightDir: d }))}
          pointLights={view.pointLights}
          onPointLightsChange={(pls) => onView((v) => ({ ...v, pointLights: pls }))}
        />
      </div>
      </div>
    </div>
  );
}
