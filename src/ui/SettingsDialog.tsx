import { FormToggle, humanizeLabel, Segmented, SettingsModal, ShortcutEditor, SpinSlider } from "@carapace/shell";
import type { SettingsScreen, ShortcutRow } from "@carapace/shell";
import { allComponentBindings, effectiveComponentKeys } from "@carapace/shell";
import { ADJUSTMENT_KINDS } from "../field/adjustments";
import type { DocumentStore, EditorState } from "../document/store";
import { BindingOverrides, COMMANDS, effectiveKeys } from "./commands";
import {
  DEFAULT_NORMAL_DIRS,
  type NormalDirs,
  type OutputChannels,
  type OutputFormat,
  type OutputSettings,
  type ProjectConfig,
} from "../document/schema";
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

const CHANNEL_OPTIONS: Array<{ value: OutputChannels; label: string }> = [
  { value: "rgba", label: "RGBA" },
  { value: "rgb", label: "RGB" },
  { value: "rg", label: "RG" },
  { value: "rga", label: "RGA" },
];

const CHANNEL_HINTS: Record<OutputChannels, string> = {
  rgba: "X, Y, Z and the alpha gate — the full contract.",
  rgb: "X, Y, Z; no alpha gate (the consumer applies the override everywhere).",
  rg: "X and Y only; the consumer reconstructs Z. No alpha gate.",
  rga: "X, Y, and the alpha gate in the third slot; the consumer reconstructs Z.",
};

/** The channels/depth/format triple, shared by the project screen and the per-doc override. */
function OutputFormatEditor(props: { value: OutputSettings; onChange: (o: OutputSettings) => void }): React.JSX.Element {
  const { value, onChange } = props;
  const setFormat = (format: OutputFormat): void =>
    // RGBE has no alpha and exactly three mantissas — entering hdr coerces the layout to rgb
    onChange(format === "hdr" ? { ...value, format, channels: "rgb" } : { ...value, format });
  return (
    <div>
      <Row label="File format">
        <Segmented
          label="File format"
          options={[
            { value: "png", label: "PNG" },
            { value: "exr", label: "EXR" },
            { value: "hdr", label: "HDR" },
          ]}
          value={value.format}
          onChange={setFormat}
        />
      </Row>
      <Row label="Channels">
        {value.format === "hdr" ? (
          <span className="text-base text-fg-mid">RGB — Radiance RGBE has no alpha channel</span>
        ) : (
          <Segmented label="Channels" options={CHANNEL_OPTIONS} value={value.channels} onChange={(channels) => onChange({ ...value, channels })} />
        )}
      </Row>
      {value.format !== "hdr" ? (
        <p className="mb-1 ml-[9.75rem] max-w-md text-sm leading-snug text-fg-mid">{CHANNEL_HINTS[value.channels]}</p>
      ) : null}
      <Row label="Bit depth">
        {value.format === "png" ? (
          <Segmented
            label="Bit depth"
            options={[
              { value: "8", label: "8-bit" },
              { value: "16", label: "16-bit" },
            ]}
            value={String(value.depth) as "8" | "16"}
            onChange={(d) => onChange({ ...value, depth: d === "8" ? 8 : 16 })}
          />
        ) : (
          <span className="text-base text-fg-mid">
            {value.format === "exr" ? "float32 scanlines (uncompressed)" : "RGBE — 8-bit mantissas + shared exponent"}
          </span>
        )}
      </Row>
    </div>
  );
}

/**
 * The three settings dialogs, each a SettingsModal instance over its own screen set. All
 * instant-apply, but with different persistence stories: Preferences screens are per-machine
 * (localStorage), Project Settings persist straight to project.lambert, and Document Settings
 * edit the active doc through its store (undoable, saved with the .lmb).
 */
export function PreferencesDialog(props: {
  /** User keybinding overrides (app-level, not per-project). */
  bindingOverrides: BindingOverrides;
  onBindingOverrides: (fn: (prev: BindingOverrides) => BindingOverrides) => void;
  /** App-level "check for updates automatically" toggle (per-machine). */
  autoUpdateCheck: boolean;
  onAutoUpdateCheck: (v: boolean) => void;
  initialScreen?: string;
  onScreenChange?: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { bindingOverrides, onBindingOverrides, autoUpdateCheck, onAutoUpdateCheck, initialScreen, onScreenChange, onClose } = props;

  const shortcutRows: ShortcutRow[] = [
    ...COMMANDS.map((c) => ({
      id: c.id,
      command: `${c.category}: ${c.label.replace(/…$/, "")}`,
      keys: effectiveKeys(c, bindingOverrides),
      when: c.scope === "editor" ? ("editor" as const) : undefined,
      source: (c.id in bindingOverrides ? "user" : "default") as ShortcutRow["source"],
      mouse: c.mouse,
    })),
    // carapace component verbs (tree rename/delete, ...) — same override store, dotted ids
    ...allComponentBindings().map((b) => ({
      id: b.id,
      command: `Component: ${b.label}`,
      keys: effectiveComponentKeys(b.id, { overrides: bindingOverrides }),
      when: b.when,
      source: (b.id in bindingOverrides ? "user" : "default") as ShortcutRow["source"],
    })),
  ];

  const screens: SettingsScreen[] = [
    {
      id: "app-shortcuts",
      label: "Shortcuts",
      keywords: ["keyboard", "keybinding", "hotkey", "commands", "mouse"],
      render: () => (
        <div>
          <Blurb>
            Every command and its binding. Click a row's edit action to record a new chord ("editor"
            commands need an open document and fire only when focus is outside a text field). Stored
            per-machine, not in the project.
          </Blurb>
          <ShortcutEditor
            rows={shortcutRows}
            onChange={(id, keys) =>
              onBindingOverrides((prev) => {
                const def = COMMANDS.find((c) => c.id === id)?.keys ?? allComponentBindings().find((b) => b.id === id)?.keys ?? null;
                if (keys === def) {
                  // rebinding back to the default = no override
                  const { [id]: _drop, ...rest } = prev;
                  return rest;
                }
                return { ...prev, [id]: keys };
              })
            }
            onReset={(id) =>
              onBindingOverrides((prev) => {
                const { [id]: _drop, ...rest } = prev;
                return rest;
              })
            }
          />
        </div>
      ),
    },
    {
      id: "app-updates",
      label: "Updates",
      keywords: ["update", "auto-update", "version", "download", "release", "check", "startup"],
      render: () => (
        <div>
          <Blurb>
            When on, Lambert checks for a new release shortly after launch and offers it in a banner.
            Help › Check for Updates always works either way. Stored per-machine, not in the project.
          </Blurb>
          <FormToggle
            label="Check for updates automatically"
            value={autoUpdateCheck}
            onChange={onAutoUpdateCheck}
          />
        </div>
      ),
    },
  ];

  return <SettingsModal title="Preferences" screens={screens} initialScreen={initialScreen} onScreenChange={onScreenChange} onClose={onClose} />;
}

export function ProjectSettingsDialog(props: {
  config: ProjectConfig;
  onConfig: (config: ProjectConfig) => void;
  initialScreen?: string;
  onScreenChange?: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { config, onConfig, initialScreen, onScreenChange, onClose } = props;

  const screens: SettingsScreen[] = [
    {
      id: "project-normals",
      label: "Normal Directions",
      keywords: ["red", "green", "rotation", "opengl", "directx", "channels", "convention"],
      render: () => (
        <div>
          <Blurb>
            Which way the encoded red/green channels point. Project-wide: every document renders and
            exports with this convention unless it sets its own override (Document Settings › Normal
            Directions).
          </Blurb>
          <NormalDirsEditor dirs={config.normalDirs} onChange={(d) => onConfig({ ...config, normalDirs: d })} />
        </div>
      ),
    },
    {
      id: "project-output",
      label: "Output Format",
      keywords: ["export", "png", "exr", "hdr", "bit depth", "channels", "rgba"],
      render: () => (
        <div>
          <Blurb>
            What Export NX writes: channel layout, bit depth, and file container. Project-wide, stored
            in project.lambert so exports are reproducible; a document can override it (Document
            Settings › Output Format). The default is 16-bit RGBA PNG.
          </Blurb>
          <OutputFormatEditor value={config.output} onChange={(output) => onConfig({ ...config, output })} />
        </div>
      ),
    },
    {
      id: "project-adjustments",
      label: "Adjustment Defaults",
      keywords: ["adjustment", "emboss", "detail", "ramp", "curve", "clamp", "multiply", "raise", "lower", "defaults"],
      render: () => (
        <div>
          <Blurb>
            Default parameters for each adjustment kind, stored in project.lambert. New adjustment
            entries follow these live; flip an entry's override switch to keep its own values
            instead (stored in the .lmb).
          </Blurb>
          {ADJUSTMENT_KINDS.map((kind) => {
            const stored = config.adjustmentDefaults?.[kind.id];
            const resetKind = (): void => {
              const { [kind.id]: _drop, ...rest } = config.adjustmentDefaults ?? {};
              onConfig({ ...config, adjustmentDefaults: Object.keys(rest).length ? rest : undefined });
            };
            const setDefault = (key: string, v: number): void =>
              onConfig({
                ...config,
                adjustmentDefaults: { ...config.adjustmentDefaults, [kind.id]: { ...config.adjustmentDefaults?.[kind.id], [key]: v } },
              });
            return (
              <div key={kind.id} className="mb-4">
                <div className="mb-1 flex items-center gap-3">
                  <span className="text-base font-semibold text-fg">{kind.name}</span>
                  {stored ? <Button onClick={resetKind}>Reset</Button> : null}
                </div>
                {Object.entries(kind.params).map(([key, spec]) => (
                  <Row key={key} label={humanizeLabel(key).toLowerCase()}>
                    <div className="w-28">
                      <SpinSlider
                        value={stored?.[key] ?? spec.default}
                        min={spec.min}
                        max={spec.max}
                        integer={!spec.float}
                        hideSlider={spec.min === undefined || spec.max === undefined}
                        onChange={(v) => setDefault(key, v)}
                      />
                    </div>
                  </Row>
                ))}
              </div>
            );
          })}
        </div>
      ),
    },
  ];

  return <SettingsModal title="Project Settings" screens={screens} initialScreen={initialScreen} onScreenChange={onScreenChange} onClose={onClose} />;
}

export function DocumentSettingsDialog(props: {
  /** Project config, for the inherited values the override screens display. */
  config: ProjectConfig;
  /** The active document — the dialog only renders while a tab is open. */
  store: DocumentStore;
  state: EditorState;
  initialScreen?: string;
  onScreenChange?: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { config, store, state, initialScreen, onScreenChange, onClose } = props;

  const doc = state.doc;
  const setOrigin = (origin: { x: number; y: number }, coalesce?: string): void => {
    store.update((d) => ({ ...d, canvas: { ...d.canvas, origin } }), coalesce ? { coalesce } : undefined);
    if (!coalesce) store.endGesture();
  };
  const setDocDirs = (dirs: NormalDirs | undefined): void => {
    store.update((d) => ({ ...d, normalDirs: dirs }));
    store.endGesture();
  };
  const setDocOutput = (output: OutputSettings | undefined): void => {
    store.update((d) => ({ ...d, output }));
    store.endGesture();
  };

  const screens: SettingsScreen[] = [
    {
      id: "doc-canvas",
      label: "Canvas",
      keywords: ["origin", "centre", "position"],
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
      keywords: ["red", "green", "rotation", "override"],
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
    {
      id: "doc-output",
      label: "Output Format",
      keywords: ["export", "png", "exr", "hdr", "bit depth", "override"],
      render: () => (
        <div>
          <Blurb>
            Override the project's output format for this document only. Stored in the .lmb, so it
            travels with the file.
          </Blurb>
          <div className="mb-3">
            <FormToggle
              label="Override project setting"
              value={doc.output !== undefined}
              onChange={(on) => setDocOutput(on ? { ...(doc.output ?? config.output) } : undefined)}
            />
          </div>
          {doc.output !== undefined ? (
            <OutputFormatEditor value={doc.output} onChange={(o) => setDocOutput(o)} />
          ) : (
            <p className="max-w-lg text-base text-fg-mid">
              Using the project setting: {config.output.channels.toUpperCase()},{" "}
              {config.output.format === "png" ? `${config.output.depth}-bit ` : ""}
              {config.output.format.toUpperCase()}.
            </p>
          )}
        </div>
      ),
    },
  ];

  return <SettingsModal title="Document Settings" screens={screens} initialScreen={initialScreen} onScreenChange={onScreenChange} onClose={onClose} />;
}
