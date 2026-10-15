// The Canvas2D painter (nodes that draw themselves in the DOM renderer), against a context that
// records its calls: coordinates, angles and tinting, not pixels (those are the browser's).
import { expect, test } from "bun:test";
import { acquireImage, setImageBackend } from "../../src/image/source.js";
import { createCanvasPainter } from "../../src/dom/painter.js";

function recordingCanvas() {
  const calls: string[] = [];
  const fmt = (v: unknown) => (typeof v === "number" ? String(Math.round(v * 1000) / 1000) : typeof v === "object" ? "obj" : String(v));
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, key) => {
      if (key in target) return target[key as string];
      if (key === "measureText") return () => ({ width: 10, fontBoundingBoxAscent: 12 });
      if (key === "font" || key === "letterSpacing") return "";
      return (...args: unknown[]) => void calls.push(`${String(key)}(${args.map(fmt).join(", ")})`);
    },
    set: (target, key, value) => {
      target[key as string] = value;
      calls.push(`${String(key)}=${fmt(value)}`);
      return true;
    },
  });
  const canvas = { width: 100, height: 50, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

test("begin: the canvas's corner is (x, y) in the window, at the device scale", () => {
  const { canvas, calls } = recordingCanvas();
  const p = createCanvasPainter(() => undefined);
  p.begin(canvas, 10, 20, 2);
  expect(calls).toContain("clearRect(0, 0, 100, 50)");
  expect(calls).toContain("setTransform(2, 0, 0, 2, -20, -40)");
});

test("arc: 0 is up and positive is clockwise, Canvas's 0 is to the right", () => {
  const { canvas, calls } = recordingCanvas();
  const p = createCanvasPainter(() => undefined);
  p.begin(canvas, 0, 0, 1);
  p.arc(50, 50, 40, 20, 0, Math.PI / 2, "#000");
  expect(calls).toContain(`arc(50, 50, 40, ${-Math.round((Math.PI / 2) * 1000) / 1000}, 0, false)`);
  expect(calls).toContain(`arc(50, 50, 20, 0, ${-Math.round((Math.PI / 2) * 1000) / 1000}, true)`);
});

test("a border is stroked inside the box, over the fill", () => {
  const { canvas, calls } = recordingCanvas();
  const p = createCanvasPainter(() => undefined);
  p.begin(canvas, 0, 0, 1);
  p.rect(0, 0, 40, 20, "#fff", 0, 2, "#000");
  expect(calls.indexOf("fill()")).toBeLessThan(calls.indexOf("stroke()"));
  expect(calls).toContain("rect(1, 1, 38, 18)");
  expect(calls).toContain("lineWidth=2");
});

test("an image tinted with a color (a white icon) is tinted once per color, then reused", () => {
  setImageBackend({ create: () => 1, destroy() {} });
  const source = acquireImage({ width: 2, height: 2, data: new Uint8Array(16).fill(255) });
  const bitmap = { width: 2, height: 2 } as unknown as HTMLCanvasElement;
  const tints: string[] = [];
  const p = createCanvasPainter(() => bitmap, (image, color) => (tints.push(color), image));
  const { canvas } = recordingCanvas();
  p.begin(canvas, 0, 0, 1);
  p.image(0, 0, 2, 2, source, [0, 0, 1, 1], 0, 1, "#ff0000");
  p.image(0, 0, 2, 2, source, [0, 0, 1, 1], 0, 1, "#ff0000");
  p.image(0, 0, 2, 2, source, [0, 0, 1, 1], 0, 1, "#ffffff");
  expect(tints).toEqual(["#ff0000"]);
  setImageBackend(null);
});
