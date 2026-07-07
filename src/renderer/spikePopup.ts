/**
 * #2 SPIKE — the popup window's content (plain DOM, no React: keep the second window cheap).
 * Shows the payload passed via query, echoes everything it receives, and exercises both data
 * paths: the via-main relay and the direct MessagePort. Rounded corners + shadow ring prove
 * window transparency (square black corners in a screenshot = transparency broken).
 */
type SpikeHost = {
  spikeRelayToParent(data: unknown): void;
  spikePopupClose(): Promise<void>;
  spikeOnEvent(cb: (ev: unknown) => void): void;
};

export function runSpikePopup(): void {
  const host = (window as unknown as { lambertHost: SpikeHost }).lambertHost;
  const payload = new URLSearchParams(location.search).get("payload") ?? "(none)";
  console.log(`[spike:popup] loaded, query payload = ${payload}`);

  document.body.style.background = "transparent";
  const root = document.getElementById("root")!;
  root.innerHTML = `
    <div style="box-sizing:border-box;height:100vh;display:flex;flex-direction:column;gap:8px;padding:14px;
                background:#232428;border:1px solid #444;border-radius:10px;color:#fff;
                font:13px Inter,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)">
      <div style="font-weight:600">transient window spike</div>
      <div>payload: <span style="color:#e8c268">${payload}</span></div>
      <div id="log" style="flex:1;overflow:auto;white-space:pre-wrap;color:#d8d8da"></div>
      <button id="send" style="padding:6px">send to parent (relay + port)</button>
    </div>`;
  const logEl = document.getElementById("log")!;
  const log = (line: string): void => {
    logEl.textContent += `${line}\n`;
    console.log(`[spike:popup] ${line}`);
  };

  let port: MessagePort | null = null;
  window.addEventListener("message", (e) => {
    if ((e.data as { type?: string })?.type !== "spike:port") return;
    port = e.ports[0]!;
    port.onmessage = (m) => log(`port <- ${JSON.stringify(m.data)}`);
    port.postMessage({ hello: "from-popup-port" });
    log("port attached, sent hello");
  });

  host.spikeOnEvent((ev) => log(`relay <- ${JSON.stringify(ev)}`));
  document.getElementById("send")!.addEventListener("click", () => {
    host.spikeRelayToParent({ clicked: Date.now() });
    port?.postMessage({ clicked: Date.now() });
  });

  // auto-exercise both channels shortly after load so the headless run needs no clicks
  setTimeout(() => {
    host.spikeRelayToParent({ auto: "popup-relay-hello" });
    port?.postMessage({ auto: "popup-port-hello" });
  }, 1200);
}
