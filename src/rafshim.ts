// Browsers stop firing requestAnimationFrame in hidden tabs (and clamp
// setTimeout to 1 Hz), which freezes MapLibre's style load and render loop.
// Embedded previews are a common case. While the tab is hidden, drive frame
// callbacks through a MessageChannel, which is not throttled; each callback
// still runs exactly once. When the tab is visible, native rAF wins.
const nativeRAF = window.requestAnimationFrame.bind(window);

const channel = new MessageChannel();
const pending: FrameRequestCallback[] = [];
channel.port1.onmessage = () => {
  const cbs = pending.splice(0, pending.length);
  const t = performance.now();
  for (const cb of cbs) cb(t);
};

window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
  let done = false;
  const once: FrameRequestCallback = (t) => {
    if (!done) {
      done = true;
      cb(t);
    }
  };
  const id = nativeRAF(once);
  if (document.visibilityState === "hidden") {
    pending.push(once);
    channel.port2.postMessage(null);
  }
  return id;
};

export {};
