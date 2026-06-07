import "./styles.css";
import { Library } from "./Library";

export function App(): React.JSX.Element {
  return (
    <div className="flex h-screen flex-col bg-canvasbg text-sm text-fg">
      <header className="flex items-center gap-3 border-b border-panel-edge bg-panel px-3 py-2">
        <span className="font-semibold">Flatland</span>
        <span className="text-fg-mid">no document</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-48 overflow-y-auto border-r border-panel-edge bg-panel p-2">
          <Library />
        </aside>
        <main className="relative min-w-0 flex-1" id="canvas-pane" />
        <aside className="w-72 overflow-y-auto border-l border-panel-edge bg-panel p-2">
          <div className="text-fg-mid">No selection</div>
        </aside>
      </div>
    </div>
  );
}
