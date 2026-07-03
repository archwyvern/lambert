import { FormToggle, SettingsModal, SpinSlider } from "@carapace/shell";
import type { SettingsScreen } from "@carapace/shell";
import type { DocumentStore, EditorState } from "../document/store";
import { DEFAULT_NORMAL_DIRS, type NormalDirs, type ProjectConfig } from "../document/schema";
import { NormalDirsEditor } from "./NormalDirsEditor";
import { Button } from "./kit";

/** A labelled settings row: label column left, control right — the screens' shared rhythm. */
function Row(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-36 shrink-0 text-base text-fg-mid">{props.label}</div>
      <div className="flex min-w-0 items-center gap-2">{props.children}</div>
    </div>
  );
}

function Blurb(props: { children: React.ReactNode }): React.JSX.Element {
  return <p className="mb-3 max-w-lg text-base leading-snug text-fg-mid">{props.children}</p>;
}

/**
 * The Settings dialog (File > Settings): project-wide screens always, plus per-document screens
 * when a document is active. Instant-apply — project screens persist straight to project.lambert,
 * document screens edit the doc through its store (undoable, saved with the .lmb).
 */
export function SettingsDialog(props: {
  config: ProjectConfig;
  onConfig: (config: ProjectConfig) => void;
  /** Active document, or null when no tab is open (Document screens hidden). */
  store: DocumentStore | null;
  state: EditorState | null;
  initialScreen?: string;
  onScreenChange?: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { config, onConfig, store, state, initialScreen, onScreenChange, onClose } = props;

  const screens: SettingsScreen[] = [
    {
      id: "project-normals",
      label: "Normal Directions",
      group: "Project",
      render: () => (
        <div>
          <Blurb>
            Which way the encoded red/green channels point. Project-wide: every document renders and
            exports with this convention unless it sets its own override (Document › Normal Directions).
          </Blurb>
          <NormalDirsEditor dirs={config.normalDirs} onChange={(d) => onConfig({ ...config, normalDirs: d })} />
        </div>
      ),
    },
  ];

  if (store && state) {
    const doc = state.doc;
    const setOrigin = (origin: { x: number; y: number }, coalesce?: string): void => {
      store.update((d) => ({ ...d, canvas: { ...d.canvas, origin } }), coalesce ? { coalesce } : undefined);
      if (!coalesce) store.endGesture();
    };
    const setDocDirs = (dirs: NormalDirs | undefined): void => {
      store.update((d) => ({ ...d, normalDirs: dirs }));
      store.endGesture();
    };
    screens.push(
      {
        id: "doc-canvas",
        label: "Canvas",
        group: "Document",
        render: () => (
          <div>
            <Blurb>
              Where this document's origin sits, in image pixels. Positions in the inspector display
              relative to it.
            </Blurb>
            <Row label="Origin">
              <div className="w-24">
                <SpinSlider
                  value={doc.canvas.origin.x}
                  onChange={(x) => setOrigin({ x, y: doc.canvas.origin.y }, "origin")}
                  onCommit={() => store.endGesture()}
                />
              </div>
              <div className="w-24">
                <SpinSlider
                  value={doc.canvas.origin.y}
                  onChange={(y) => setOrigin({ x: doc.canvas.origin.x, y }, "origin")}
                  onCommit={() => store.endGesture()}
                />
              </div>
            </Row>
            <Row label="Presets">
              <Button onClick={() => setOrigin({ x: doc.source.width / 2, y: doc.source.height / 2 })}>Centre</Button>
              <Button onClick={() => setOrigin({ x: doc.source.width / 2, y: 0 })}>Top Centre</Button>
              <Button onClick={() => setOrigin({ x: 0, y: 0 })}>Top Left</Button>
            </Row>
          </div>
        ),
      },
      {
        id: "doc-normals",
        label: "Normal Directions",
        group: "Document",
        render: () => (
          <div>
            <Blurb>
              Override the project's channel convention for this document only. Stored in the .lmb, so
              it travels with the file.
            </Blurb>
            <div className="mb-3">
              <FormToggle
                label="Override project setting"
                value={doc.normalDirs !== undefined}
                onChange={(on) => setDocDirs(on ? { ...(doc.normalDirs ?? config.normalDirs ?? DEFAULT_NORMAL_DIRS) } : undefined)}
              />
            </div>
            <NormalDirsEditor
              dirs={doc.normalDirs ?? config.normalDirs}
              disabled={doc.normalDirs === undefined}
              onChange={(d) => setDocDirs(d)}
            />
          </div>
        ),
      },
    );
  }

  return (
    <SettingsModal
      screens={screens}
      initialScreen={initialScreen}
      onScreenChange={onScreenChange}
      onClose={onClose}
    />
  );
}
