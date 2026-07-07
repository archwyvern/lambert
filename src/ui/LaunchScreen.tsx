import { DismissRegular, FolderRegular } from "@fluentui/react-icons";
import type { RecentProject } from "../document/recents";
import { Button, ICON } from "./kit";
import { LambertMark } from "./LambertMark";

interface LaunchScreenProps {
  recents: RecentProject[];
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => void;
  onNew: () => void;
  onOpen: () => void;
  /** Clone Remote Project (WebDAV) — opens the clone dialog. */
  onRemote: () => void;
}

/**
 * The no-project landing screen, laid out like a JetBrains welcome window: a left rail (the Lambert
 * identity on top, a Projects nav entry) beside a content pane whose top bar carries the New/Open
 * actions, with the one-click recent-projects list filling the space directly beneath it.
 */
export function LaunchScreen(props: LaunchScreenProps): React.JSX.Element {
  const { recents, onOpenRecent, onRemoveRecent, onNew, onOpen, onRemote } = props;
  return (
    <div className="flex h-full w-full overflow-hidden bg-[var(--color-viewport-bg)]">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-bg p-4">
        <header className="mb-5 flex items-center gap-3">
          <LambertMark className="h-11 w-11 shrink-0" />
          <div className="min-w-0">
            <div className="text-lg font-semibold leading-tight text-fg">Lambert</div>
            <div className="text-base leading-tight text-fg-mid">Height-field normal map editor</div>
          </div>
        </header>
        <nav className="flex flex-col gap-0.5">
          <div className="rounded-sm bg-list-active px-3 py-1.5 text-base font-medium text-fg">Projects</div>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col p-4">
        <div className="mb-3 flex items-center justify-end gap-2 border-b border-border pb-3">
          <Button variant="primary" onClick={onNew}>
            New Project
          </Button>
          <Button variant="ghost" onClick={onOpen}>
            Open Project…
          </Button>
          <Button variant="ghost" onClick={onRemote}>
            Clone Remote…
          </Button>
        </div>

        {recents.length === 0 ? (
          <div className="rounded-sm border border-border px-3 py-6 text-center text-sm text-fg-mid">
            No recent projects yet — create one or open an existing folder.
          </div>
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {recents.map((r) => (
              <li key={r.path} className="group relative">
                <button
                  onClick={() => onOpenRecent(r.path)}
                  className="flex w-full items-center gap-3 rounded-sm px-3 py-2 pr-9 text-left hover:bg-hover"
                  title={`Open ${r.path}`}
                >
                  <FolderRegular className="shrink-0 text-fg-mid" style={{ fontSize: ICON.lg }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-fg">{r.name}</span>
                    <span className="block truncate font-mono text-sm text-fg-mid">{r.path}</span>
                  </span>
                </button>
                <button
                  onClick={() => onRemoveRecent(r.path)}
                  className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-sm p-1 text-fg-mid hover:bg-surface3 hover:text-fg group-hover:block"
                  title="Remove from recent projects"
                  aria-label={`Remove ${r.name} from recent projects`}
                >
                  <DismissRegular style={{ fontSize: ICON.md }} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
