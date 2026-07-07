import { useState } from "react";
import { useConfirm } from "@carapace/shell";
import { Button } from "./kit";
import { getHost } from "./host";
import { makeDavClient, newServerId, type RemoteServer } from "../remote/servers";
import { davTransport } from "./remoteGlue";

/**
 * Preferences > Remote Servers — the WebDAV endpoints Clone Remote Project can pull from.
 * App-level (localStorage via App's usePersistentState), never part of a project; the sidecar
 * references entries by id so credential edits apply to every clone at once.
 */
interface Draft {
  /** Existing server id being edited, or null for a new entry. */
  id: string | null;
  name: string;
  baseUrl: string;
  username: string;
  password: string;
}

const emptyDraft = (): Draft => ({ id: null, name: "", baseUrl: "", username: "", password: "" });

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secret?: boolean;
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-base text-fg-mid">{props.label}</span>
      <input
        type={props.secret ? "password" : "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        spellCheck={false}
        className="w-full rounded-sm border border-border bg-bg px-2 py-1.5 text-base text-fg outline-none focus:border-accent"
      />
    </label>
  );
}

export function RemoteServersScreen(props: {
  servers: RemoteServer[];
  onServers: (fn: (prev: RemoteServer[]) => RemoteServer[]) => void;
}): React.JSX.Element {
  const { servers, onServers } = props;
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  // per-server test-connection outcome; transient UI state only
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const canSave = draft !== null && draft.name.trim() !== "" && /^https?:\/\//.test(draft.baseUrl.trim());

  const save = (): void => {
    if (!draft || !canSave) return;
    const entry: RemoteServer = {
      id: draft.id ?? newServerId(),
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      username: draft.username,
      password: draft.password,
    };
    onServers((prev) => (draft.id ? prev.map((s) => (s.id === draft.id ? entry : s)) : [...prev, entry]));
    setDraft(null);
  };

  const remove = async (server: RemoteServer): Promise<void> => {
    const r = await confirm({
      title: `Remove ${server.name}?`,
      message: "Projects cloned from it keep working locally, but Sync and Export will fail until it's re-added.",
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (r === "confirm") onServers((prev) => prev.filter((s) => s.id !== server.id));
  };

  const testConnection = (server: RemoteServer): void => {
    setTestResult((prev) => ({ ...prev, [server.id]: "Testing…" }));
    makeDavClient(davTransport(getHost()), server)
      .listProjects()
      .then((projects) =>
        setTestResult((prev) => ({
          ...prev,
          [server.id]: `Connected — ${projects.length} project${projects.length === 1 ? "" : "s"}`,
        })),
      )
      .catch((err: unknown) =>
        setTestResult((prev) => ({ ...prev, [server.id]: err instanceof Error ? err.message : String(err) })),
      );
  };

  return (
    <div className="flex max-w-lg flex-col gap-3">
      <p className="max-w-lg text-base leading-snug text-fg-mid">
        WebDAV servers for remote projects. File &gt; Clone Remote Project pulls a project from one
        of these into a local folder; Sync and Export keep the two in step. Stored per-machine, not
        in the project.
      </p>

      {servers.length === 0 && draft === null ? (
        <div className="rounded-sm border border-border px-3 py-4 text-center text-base text-fg-mid">
          No servers yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {servers.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-sm border border-border px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-base text-fg">{s.name}</div>
                <div className="truncate font-mono text-sm text-fg-mid">{s.baseUrl}</div>
                {testResult[s.id] ? <div className="truncate text-sm text-fg-mid">{testResult[s.id]}</div> : null}
              </div>
              <Button onClick={() => testConnection(s)}>Test</Button>
              <Button onClick={() => setDraft({ id: s.id, name: s.name, baseUrl: s.baseUrl, username: s.username, password: s.password })}>
                Edit
              </Button>
              <Button variant="danger" onClick={() => void remove(s)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {draft ? (
        <div className="flex flex-col gap-2 rounded-sm border border-border-light bg-surface2 p-3">
          {/* The example server is named after the skyrat (the common pigeon): nature's original
              file-sync service — store-and-forward delivery, no auth, lossy transport, occasionally
              shits on the payload. See RFC 1149. Any WebDAV server is a strict upgrade, but we
              honor the lineage. */}
          <Field label="Name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} placeholder="Skyrat" />
          <Field label="Base URL" value={draft.baseUrl} onChange={(baseUrl) => setDraft({ ...draft, baseUrl })} placeholder="https://skyrat.example.com/dav/" />
          <Field label="Username" value={draft.username} onChange={(username) => setDraft({ ...draft, username })} />
          <Field label="Password" value={draft.password} onChange={(password) => setDraft({ ...draft, password })} secret />
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" disabled={!canSave} onClick={save}>
              {draft.id ? "Save" : "Add Server"}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button variant="primary" onClick={() => setDraft(emptyDraft())}>
            Add Server…
          </Button>
        </div>
      )}
    </div>
  );
}
