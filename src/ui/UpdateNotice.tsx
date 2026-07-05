import { useEffect, useReducer } from "react";
import { getHost } from "./host";
import { Button } from "./kit";
import { initialUpdateState, reduceUpdate } from "./updateState";

/** Bottom-right banner driving the update lifecycle: offer → download progress → restart, plus
 *  transient "up to date" / error messages for manual checks. Mounted once near the App root. */
export function UpdateNotice({ autoCheck }: { autoCheck: boolean }): React.JSX.Element | null {
  const [state, dispatch] = useReducer(reduceUpdate, initialUpdateState);

  useEffect(() => {
    const host = getHost();
    host.onUpdateEvent((ev) => dispatch(ev));
    host.onMenuAction((action) => {
      if (action === "check-updates") {
        dispatch({ type: "check", manual: true });
        void host.checkForUpdates();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Quiet startup check, gated on the "Check for updates automatically" setting. The renderer owns this
  // trigger (main can't read the localStorage-backed setting). manual stays false so "up to date" and
  // pre-download errors stay silent; the delay keeps it off the launch path. Fires once on mount —
  // toggling the setting takes effect next launch.
  useEffect(() => {
    if (!autoCheck) return;
    const t = setTimeout(() => void getHost().checkForUpdates(), 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.phase === "uptodate" || state.phase === "error") {
      const t = setTimeout(() => dispatch({ type: "dismiss" }), 4000);
      return () => clearTimeout(t);
    }
  }, [state.phase]);

  if (state.phase === "idle" || state.phase === "checking") return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-xs flex-col gap-2 border border-border-light bg-surface2 p-3 text-base text-fg shadow-[var(--shadow-popover)]">
      {state.phase === "available" && (
        <>
          <span>Lambert v{state.version} is available.</span>
          <div className="flex justify-end gap-2">
            <Button onClick={() => dispatch({ type: "dismiss" })}>Later</Button>
            <Button
              variant="primary"
              onClick={() => {
                dispatch({ type: "download" }); // show progress immediately; surfaces a fast-failing download
                void getHost().downloadUpdate();
              }}
            >
              Download
            </Button>
          </div>
        </>
      )}
      {state.phase === "downloading" && <span>Downloading update… {Math.round(state.percent ?? 0)}%</span>}
      {state.phase === "downloaded" && (
        <>
          <span>Update v{state.version} ready.</span>
          <div className="flex justify-end gap-2">
            <Button onClick={() => dispatch({ type: "dismiss" })}>Later</Button>
            <Button variant="primary" onClick={() => void getHost().quitAndInstall()}>
              Restart now
            </Button>
          </div>
        </>
      )}
      {state.phase === "uptodate" && <span>You're on the latest version.</span>}
      {state.phase === "error" && <span className="text-error">Update failed: {state.message}</span>}
    </div>
  );
}
