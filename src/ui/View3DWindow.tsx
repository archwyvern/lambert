import { ArrowMinimizeRegular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import "../field/shapes";
import { parseDoc } from "../document/schema";
import { normalSigns } from "../document/schema";
import { getShapeType } from "../field/registry";
import type { ShapeInstance } from "../field/types";
import { getHost } from "./host";
import { PreviewRenderer } from "./preview";
import { use3DCamera } from "./use3DCamera";
import type { View3DState } from "./view3d";

interface Loaded {
  shapes: ShapeInstance[];
  normalDirs: { red: "right" | "left"; green: "up" | "down" };
  w: number;
  h: number;
  lightDir: [number, number, number];
}

/**
 * The pop-out 3D window. A separate OS window = separate renderer process = its own WebGPU
 * device, so it cannot share the main window's fold textures — it runs its own
 * PreviewRenderer and re-folds the field from doc + diffuse pushed over IPC.
 */
export function View3DWindow(): React.JSX.Element {
  const hiddenRef = useRef<HTMLCanvasElement>(null); // composite target (unused, off-screen)
  const canvasRef = useRef<HTMLCanvasElement>(null); // visible 3D view
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [size, setSize] = useState({ w: 480, h: 480 });
  const cam = use3DCamera();

  // init renderer (own device); diffuse uploads happen on the first state with bytes
  useEffect(() => {
    const hidden = hiddenRef.current!;
    void PreviewRenderer.create(hidden)
      .then((r) => {
        rendererRef.current = r;
        setReady(true);
        getHost().view3dReady(); // ask the main window to push current state
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  // attach the visible canvas + track the window size for the camera/backing store. The
  // canvas is absolutely positioned and sized in explicit px (not height:100%) so it can't
  // feed its backing-store height back into the flex layout — that loop ran the size away.
  useEffect(() => {
    if (!ready) return;
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const fit = (): void => {
      const r = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.floor(r.width));
      const h = Math.max(1, Math.floor(r.height));
      setSize({ w, h });
      canvas.width = Math.max(1, Math.floor(w * devicePixelRatio));
      canvas.height = Math.max(1, Math.floor(h * devicePixelRatio));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    rendererRef.current!.attach3D(canvas);
    return () => ro.disconnect();
  }, [ready]);

  // receive doc + diffuse from the main window; re-fold on every push
  useEffect(() => {
    return getHost().onView3dState((s: View3DState) => {
      const doc = parseDoc(s.docJson);
      setLoaded({
        shapes: doc.shapes,
        normalDirs: doc.normalDirs,
        w: doc.source.width,
        h: doc.source.height,
        lightDir: s.lightDir,
      });
      const r = rendererRef.current;
      if (r && s.diffuse) r.setDiffuse(s.diffuse, doc.source.width, doc.source.height);
    });
  }, []);

  // render whenever state, camera, or size changes
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !ready || !loaded) return;
    const maxH = loaded.shapes.reduce(
      (m, s) =>
        Math.max(m, Math.abs(s.transform.pos.z) + (getShapeType(s.typeId).nominalHeight ?? 0) * Math.abs(s.transform.scale.z)),
      8,
    );
    r.requestRender(loaded.w, loaded.h, {
      shapes: loaded.shapes,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      mode: "lit",
      opacity: 1,
      lightDir: loaded.lightDir,
      heightRange: [-maxH, maxH],
      normalSigns: normalSigns(loaded.normalDirs),
      orbit3d: cam.orbit,
    });
  });

  const focal = loaded ? cam.focal(loaded.w, loaded.h, size.w, size.h) : null;

  return (
    <div className="flex h-screen w-screen flex-col bg-bg text-fg">
      <canvas ref={hiddenRef} style={{ display: "none" }} />
      <div className="flex h-[26px] shrink-0 items-center justify-between border-b border-border bg-surface2 px-2">
        <span className="text-sm font-semibold uppercase tracking-wide text-fg-mid">3D Preview</span>
        <button
          title="Dock back into the editor"
          className="flex h-[18px] w-[18px] items-center justify-center text-fg-mid hover:text-fg"
          onClick={() => getHost().redockView3d()}
        >
          <ArrowMinimizeRegular style={{ fontSize: 12 }} />
        </button>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        {err ? (
          <div className="absolute inset-0 grid place-items-center text-sm text-error">GPU unavailable: {err}</div>
        ) : null}
        {!loaded && !err ? (
          <div className="absolute inset-0 grid place-items-center text-sm text-fg-mid">Waiting for document…</div>
        ) : null}
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", top: 0, left: 0, width: size.w, height: size.h, display: "block" }}
          className="cursor-grab active:cursor-grabbing"
          onPointerDown={loaded ? cam.onCanvasDown(loaded.w, loaded.h, size.w) : undefined}
          onWheel={cam.onWheel}
          onContextMenu={(e) => e.preventDefault()}
        />
        {focal && focal.x >= 0 && focal.x <= size.w && focal.y >= 0 && focal.y <= size.h ? (
          <svg className="pointer-events-none absolute top-0 left-0" width={size.w} height={size.h} style={{ overflow: "visible" }}>
            <g stroke="var(--color-accent)" strokeWidth={1.25} style={{ filter: "drop-shadow(0 0 1.5px rgba(0,0,0,0.9))" }}>
              <line x1={focal.x - 7} y1={focal.y} x2={focal.x + 7} y2={focal.y} />
              <line x1={focal.x} y1={focal.y - 7} x2={focal.x} y2={focal.y + 7} />
              <circle cx={focal.x} cy={focal.y} r={3} fill="none" />
            </g>
          </svg>
        ) : null}
      </div>
    </div>
  );
}
