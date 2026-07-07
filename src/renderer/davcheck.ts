import { makeDavClient } from "../remote/servers";
import { cloneProject, runPull, runPush, type SyncUi } from "../remote/runner";
import { loadSidecar, saveSidecar } from "../remote/sidecar";
import { carapaceHost, getHost } from "../ui/host";
import { davTransport, localIo, sidecarIo } from "../ui/remoteGlue";
import { joinPath } from "../document/paths";

/**
 * `?davcheck=<baseUrl>&dir=<empty dir>` — end-to-end remote-projects check through the REAL stack:
 * the net:request IPC proxy (main-process fetch), real-disk IO via the host bridges, and the
 * fs:rename-backed sidecar save. Complements tests/webdav/ (which prove the logic against the
 * fixture in vitest): this route proves the app wiring. Run with the fixture serving:
 *
 *   pnpm dav:serve /tmp/davroot &
 *   electron . --capture out.png --query "davcheck=http://127.0.0.1:41100/&dir=/tmp/daveclone"
 *
 * Each step prints PASS/FAIL to the harness view; the capture screenshot is the record.
 */
declare global {
  interface Window {
    __lambertDemoReady?: boolean;
  }
}

const silentUi: SyncUi = {
  progress: () => {},
  confirmOverwriteLocal: () => Promise.resolve(false),
  info: () => {},
};

export async function runDavCheck(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const baseUrl = params.get("davcheck")!;
  const dir = params.get("dir");
  const views = document.getElementById("views")!;
  const status = document.getElementById("status")!;
  status.hidden = false;
  status.textContent = `davcheck against ${baseUrl}`;

  let failures = 0;
  const log = (name: string, ok: boolean, detail = ""): void => {
    if (!ok) failures += 1;
    const line = document.createElement("div");
    line.textContent = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`;
    line.style.color = ok ? "#72c892" : "#f48771";
    views.appendChild(line);
  };

  const host = getHost();
  const server = { id: "davcheck", name: "davcheck", baseUrl, username: params.get("user") ?? "dev", password: params.get("pass") ?? "dev" };
  const dav = makeDavClient(davTransport(host), server);

  try {
    if (!dir) throw new Error("davcheck needs &dir=<empty local dir>");

    // 1. list projects through the net:request IPC proxy
    const projects = await dav.listProjects();
    log("listProjects via net:request IPC", projects.length > 0, `projects: ${projects.join(", ")}`);
    const project = projects[0]!;

    // 2. clone onto the real filesystem via the carapace fs bridge + host writeFile
    const io = localIo(host, (d) => carapaceHost.fs!.list(d), dir);
    const { sidecar, failed } = await cloneProject(dav, project, { id: server.id, baseUrl: server.baseUrl }, io, silentUi);
    const fileCount = Object.keys(sidecar.files).length;
    log("cloneProject to real disk", failed.length === 0 && fileCount > 0, `${fileCount} files -> ${dir}`);

    // 3. sidecar round-trip on real disk (exercises the fs:rename IPC behind the atomic save)
    await saveSidecar(sidecarIo(host), dir, sidecar);
    const loaded = await loadSidecar(sidecarIo(host), dir);
    log("sidecar save/load (fs:rename IPC)", loaded !== null && loaded !== "corrupt" && Object.keys((loaded as typeof sidecar).files).length === fileCount);

    // 4. edit a local lmb, push, verify the remote bytes changed
    const lmb = Object.keys(sidecar.files).find((n) => /\.lmb$/i.test(n));
    if (!lmb) throw new Error("remote project has no .lmb to exercise push");
    const edited = new TextEncoder().encode(`davcheck-edit ${crypto.randomUUID()}`);
    await host.writeFile(joinPath(dir, lmb), edited);
    const pushed = await runPush(dav, sidecar, io, silentUi);
    const remoteBytes = await dav.getFile(project, lmb);
    log(
      "push (If-Match PUT) round-trip",
      pushed.summary.uploaded.includes(lmb) && new TextDecoder().decode(remoteBytes) === new TextDecoder().decode(edited),
      `uploaded: ${pushed.summary.uploaded.join(", ")}`,
    );

    // 5. change it remotely, pull, verify the fast-forward landed on disk
    const current = (await dav.listFiles(project)).find((f) => f.name === lmb)!;
    const remoteEdit = new TextEncoder().encode("davcheck-remote-edit");
    await dav.putFile(project, lmb, remoteEdit, { ifMatch: current.etag });
    const pulled = await runPull(dav, pushed.sidecar, io, silentUi);
    const localBytes = await host.readFile(joinPath(dir, lmb));
    log(
      "pull fast-forward to real disk",
      pulled.summary.fastForwarded.includes(lmb) && new TextDecoder().decode(localBytes) === "davcheck-remote-edit",
    );

    status.textContent = failures === 0 ? `davcheck PASS — ${baseUrl}` : `davcheck: ${failures} FAILED — ${baseUrl}`;
  } catch (err) {
    log("davcheck aborted", false, err instanceof Error ? err.message : String(err));
    status.textContent = `davcheck FAILED — ${baseUrl}`;
  }
  window.__lambertDemoReady = true; // release the --capture readiness probe
}
