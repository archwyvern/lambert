export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface Host {
  openDialog(opts: { title: string; filters: FileFilter[] }): Promise<string | null>;
  saveDialog(opts: { title: string; defaultPath?: string; filters: FileFilter[] }): Promise<string | null>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
}

interface HostWindow {
  flatlandHost: Host & { sendSelftestResult(report: unknown): void };
}

export function getHost(): Host {
  return (window as unknown as HostWindow).flatlandHost;
}
