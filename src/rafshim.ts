// Browsers stop firing requestAnimationFrame in hidden tabs (and clamp
// setTimeout to 1 Hz), which freezes MapLibre's style load and render loop.
// Embedded previews are a common case. While the tab is hidden, drive frame
// callbacks through a MessageChannel, which is not throttled; each callback
// still runs exactly once. When the tab is visible, native rAF wins, and any
// frames it parked get flushed the moment the tab goes hidden.
const nativeRAF = window.requestAnimationFrame.bind(window);

const channel = new MessageChannel();
const pending: FrameRequestCallback[] = [];
const outstanding = new Set<FrameRequestCallback>();

channel.port1.onmessage = () => {
  const cbs = pending.splice(0, pending.length);
  const t = performance.now();
  for (const cb of cbs) cb(t);
};

window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
  const once: FrameRequestCallback = (t) => {
    if (outstanding.delete(once)) cb(t);
  };
  outstanding.add(once);
  const id = nativeRAF(once);
  if (document.visibilityState === "hidden") {
    pending.push(once);
    channel.port2.postMessage(null);
  }
  return id;
};

// Frames scheduled while visible sit in the native queue, which the browser
// parks on hide; hand them to the channel so nothing stalls.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && outstanding.size) {
    pending.push(...outstanding);
    channel.port2.postMessage(null);
  }
});

export {};
