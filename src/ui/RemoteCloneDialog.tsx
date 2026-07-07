import { useState } from "react";
import { Modal } from "@carapace/shell";
import { Button } from "./kit";
import { carapaceHost, getHost } from "./host";
import { makeDavClient, type RemoteServer } from "../remote/servers";
import { cloneProject } from "../remote/runner";
import { saveSidecar } from "../remote/sidecar";
import { davTransport, localIo, sidecarIo } from "./remoteGlue";
import { initProject } from "../document/io";
import { PROJECT_FILE } from "../document/workspace";

/**
 * Clone Remote Project: pick a server -> pick one of its projects -> pick an EMPTY local folder ->
 * download everything -> open. The folder-must-be-empty rule is deliberate (spec): cloning into an
 * existing project would clash with fresh sync state; re-cloning into a fresh folder is the
 * recovery path. Downloads that fail are listed and resumed by the next Sync (etag skip).
 */
type Phase =
  | { kind: "pick" }
  | { kind: "loading"; server: RemoteServer }
  | { kind: "projects"; server: RemoteServer; projects: string[]; selected: string | null; error: string | null }
  | { kind: "cloning"; file: string; done: number; total: number }
  | { kind: "done"; dir: string; failed: string[] };

export function RemoteCloneDialog(props: {
  servers: RemoteServer[];
  /** Open Preferences > Remote Servers (no servers configured yet). */
  onAddServer: () => void;
  onCloned: (dir: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { servers, onAddServer, onCloned, onClose } = props;
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const [folderError, setFolderError] = useState<string | null>(null);

  const loadProjects = (server: RemoteServer): void => {
    setPhase({ kind: "loading", server });
    makeDavClient(davTransport(getHost()), server)
      .listProjects()
      .then((projects) => setPhase({ kind: "projects", server, projects, selected: null, error: null }))
      .catch((err: unknown) =>
        setPhase({
          kind: "projects", server, projects: [], selected: null,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
  };

  const chooseFolderAndClone = async (server: RemoteServer, project: string): Promise<void> => {
    setFolderError(null);
    const host = getHost();
    const dir = await host.openFolderDialog({ title: `Clone "${project}" into folder` });
    if (!dir) return;
    const entries = await carapaceHost.fs!.list(dir).catch(() => []);
    if (entries.length > 0) {
      setFolderError("Folder must be empty — pick or create a fresh folder.");
      return;
    }
    const dav = makeDavClient(davTransport(host), server);
    const io = localIo(host, (d) => carapaceHost.fs!.list(d), dir);
    setPhase({ kind: "cloning", file: "", done: 0, total: 0 });
    try {
      const { sidecar, failed } = await cloneProject(dav, project, server.id, io, {
        progress: (file, done, total) => setPhase({ kind: "cloning", file, done, total }),
        confirmOverwriteLocal: () => Promise.resolve(false), // unreachable: clone targets an empty folder
        info: () => {},
      });
      // a project never touched by lambert has no remote project.lambert — create the local marker
      if (!(await host.pathExists(`${dir}/${PROJECT_FILE}`))) await initProject(host, dir);
      await saveSidecar(sidecarIo(host), dir, sidecar);
      setPhase({ kind: "done", dir, failed });
    } catch (err) {
      setPhase({
        kind: "projects", server, projects: [], selected: project,
        error: err instanceof Error ? err.message : String(err),
      });
      loadProjects(server);
    }
  };

  return (
    <Modal
      title="Clone Remote Project"
      onClose={onClose}
      closeOnBackdrop={false}
      className="w-[28rem] max-w-[calc(100vw-2rem)] border border-border bg-surface-raised p-5 outline-none"
    >
      <div className="flex flex-col gap-4">
        {phase.kind === "pick" ? (
          servers.length === 0 ? (
            <>
              <p className="text-base text-fg-mid">
                No remote servers configured yet. Add one first — you need its URL and credentials.
              </p>
              <div className="flex justify-end gap-2">
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="primary" onClick={onAddServer}>
                  Open Remote Servers…
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-base text-fg-mid">Pick the server to clone from.</p>
              <ul className="flex flex-col gap-1">
                {servers.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => loadProjects(s)}
                      className="flex w-full flex-col rounded-sm border border-border px-3 py-2 text-left hover:bg-hover"
                    >
                      <span className="text-base text-fg">{s.name}</span>
                      <span className="truncate font-mono text-sm text-fg-mid">{s.baseUrl}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <Button onClick={onClose}>Cancel</Button>
              </div>
            </>
          )
        ) : null}

        {phase.kind === "loading" ? (
          <p className="text-base text-fg-mid">Listing projects on {phase.server.name}…</p>
        ) : null}

        {phase.kind === "projects" ? (
          <>
            {phase.error ? (
              <p className="text-base text-error">{phase.error}</p>
            ) : (
              <p className="text-base text-fg-mid">
                Pick a project on {phase.server.name}, then choose an empty local folder for it.
              </p>
            )}
            {phase.projects.length > 0 ? (
              <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {phase.projects.map((p) => (
                  <li key={p}>
                    <button
                      onClick={() => setPhase({ ...phase, selected: p })}
                      className={`w-full rounded-sm border px-3 py-2 text-left text-base ${
                        phase.selected === p
                          ? "border-accent bg-accent-dim text-fg"
                          : "border-border text-fg hover:bg-hover"
                      }`}
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            ) : !phase.error ? (
              <p className="text-base text-fg-mid">The server has no projects.</p>
            ) : null}
            {folderError ? <p className="text-base text-error">{folderError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setPhase({ kind: "pick" })}>Back</Button>
              <Button onClick={onClose}>Cancel</Button>
              <Button
                variant="primary"
                disabled={phase.selected === null}
                onClick={() => void chooseFolderAndClone(phase.server, phase.selected!)}
              >
                Choose Folder…
              </Button>
            </div>
          </>
        ) : null}

        {phase.kind === "cloning" ? (
          <div className="flex flex-col gap-2">
            <p className="text-base text-fg-mid">
              Downloading {phase.file || "…"} ({phase.done}/{phase.total || "?"})
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-sm bg-surface-sunken">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: phase.total ? `${Math.round((phase.done / phase.total) * 100)}%` : "0%" }}
              />
            </div>
          </div>
        ) : null}

        {phase.kind === "done" ? (
          <>
            {phase.failed.length === 0 ? (
              <p className="text-base text-fg">Clone complete.</p>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="text-base text-warning">
                  Clone finished with {phase.failed.length} failed download{phase.failed.length === 1 ? "" : "s"} —
                  Sync will resume these:
                </p>
                <ul className="max-h-32 overflow-y-auto font-mono text-sm text-fg-mid">
                  {phase.failed.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={onClose}>Close</Button>
              <Button variant="primary" onClick={() => onCloned(phase.dir)}>
                Open Project
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
