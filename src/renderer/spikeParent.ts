/** #2 SPIKE — parent-renderer side: log everything arriving from the popup (relay + port) and
 *  answer once on each channel, proving the full round trip. Loaded only under `?spike=1`. */
type SpikeHost = {
  spikeRelayToPopup(data: unknown): void;
  spikeOnEvent(cb: (ev: unknown) => void): void;
};

export function runSpikeParent(): void {
  const host = (window as unknown as { lambertHost: SpikeHost }).lambertHost;
  console.log("[spike:parent] listener armed");
  host.spikeOnEvent((ev) => {
    console.log(`[spike:parent] relay <- ${JSON.stringify(ev)}`);
    host.spikeRelayToPopup({ ack: "parent-relay-ack" });
  });
  window.addEventListener("message", (e) => {
    if ((e.data as { type?: string })?.type !== "spike:port") return;
    const port = e.ports[0]!;
    port.onmessage = (m) => {
      console.log(`[spike:parent] port <- ${JSON.stringify(m.data)}`);
      port.postMessage({ ack: "parent-port-ack" });
    };
    console.log("[spike:parent] port attached");
  });
}
