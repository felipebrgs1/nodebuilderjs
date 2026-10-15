// Node globals the runtime reads, for the browser. Imported first by boot.ts, before any
// module that touches them at load time.

const g = globalThis as any;

g.process ??= {
  env: {},
  versions: {},
  platform: "browser",
  arch: "",
  cwd: () => "/",
  exit: () => {},
  memoryUsage: () => ({ heapUsed: (performance as any).memory?.usedJSHeapSize ?? 0, rss: 0 }),
};

// A macrotask, like Node's: the runtime renders a frame in one so the event that caused it finishes first.
if (!g.setImmediate) {
  const queue: (() => void)[] = [];
  const channel = new MessageChannel();
  channel.port1.onmessage = () => queue.shift()?.();
  g.setImmediate = (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
    queue.push(() => fn(...args));
    channel.port2.postMessage(0);
  };
}

// V8 only; the frame tracing (dev) uses it.
(Error as any).captureStackTrace ??= (holder: { stack?: string }) => {
  holder.stack = new Error().stack;
};
