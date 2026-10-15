import { describe, expect, test } from "bun:test";
import { CommandBuffer } from "../../src/render/paint.js";
import { type ClipState, type RenderDevice, type TextPainter, Renderer, VERTEX_FLOATS } from "../../src/web/renderer.js";

/** Records what the renderer asks of the GPU; vertices come back as { x, y, mode, color }. */
function fakeDevice(images: Record<number, "srgb" | "display-p3"> = {}) {
  const calls: (
    | { call: "begin"; width: number; height: number }
    | { call: "draw"; vertices: { x: number; y: number; mode: number; color: number[]; uv: number[] }[] }
    | { call: "clip"; state: ClipState | null }
    | { call: "image"; id: number }
  )[] = [];
  const device: RenderDevice = {
    begin: (width, height) => void calls.push({ call: "begin", width, height }),
    draw(v, count) {
      const vertices = [];
      for (let i = 0; i < count; i++) {
        const p = v.subarray(i * VERTEX_FLOATS, (i + 1) * VERTEX_FLOATS);
        vertices.push({ x: p[0]!, y: p[1]!, mode: p[16]!, color: Array.from(p.subarray(6, 10), (c) => Math.round(c * 1000) / 1000), uv: [p[17]!, p[18]!] });
      }
      calls.push({ call: "draw", vertices });
    },
    clip: (state) => void calls.push({ call: "clip", state: state && structuredClone(state) }),
    bindImage(id) {
      calls.push({ call: "image", id });
      return images[id] ?? null;
    },
  };
  return { device, calls, draws: () => calls.filter((c) => c.call === "draw") };
}

function fakeText(capacity = Infinity) {
  const placed: { text: string; font: number; spec: string; px: number; spacing: number; color: number[] }[] = [];
  let used = 0;
  const painter: TextPainter = {
    place(text, font, spec, px, spacing, color) {
      if (used >= capacity) return "full";
      used++;
      placed.push({ text, font, spec, px, spacing, color: Array.from(color, (c) => Math.round(c * 1000) / 1000) });
      return { x0: -1, y0: -2, x1: 30, y1: 12, u0: 0, v0: 0, u1: 0.5, v1: 0.25 };
    },
    reset: () => void (used = 0),
  };
  return { painter, placed };
}

describe("web renderer: command buffer -> one vertex batch", () => {
  test("a rect becomes one quad in device pixels, with an antialiasing margin", () => {
    const { device, calls, draws } = fakeDevice();
    const buf = new CommandBuffer();
    buf.rect(10, 20, 100, 50, "#ff0000", 8);
    new Renderer(device, fakeText().painter).frame(400, 300, 2, buf.commands, buf.texts);
    expect(calls[0]).toEqual({ call: "begin", width: 400, height: 300 });
    const [draw] = draws();
    expect(draw!.vertices).toHaveLength(6);
    const xs = draw!.vertices.map((v) => v.x), ys = draw!.vertices.map((v) => v.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([19, 221, 39, 141]);
    expect(draw!.vertices[0]).toMatchObject({ mode: 0, color: [1, 0, 0, 1] });
  });

  test("everything between clips is one draw; a clip flushes and intersects with its parent", () => {
    const { device, calls } = fakeDevice();
    const buf = new CommandBuffer();
    buf.rect(0, 0, 10, 10, "#000");
    buf.rect(0, 0, 10, 10, "#000");
    buf.clip(10, 10, 100, 100, 6);
    buf.clip(50, 0, 100, 40);
    buf.rect(0, 0, 10, 10, "#000");
    buf.unclip();
    buf.unclip();
    new Renderer(device, fakeText().painter).frame(400, 300, 1, buf.commands, buf.texts);
    expect(calls.map((c) => (c.call === "draw" ? `draw ${c.vertices.length}` : c.call === "clip" ? `clip ${c.state ? c.state.scissor.join(",") : "none"}` : c.call))).toEqual([
      "begin", "draw 12", "clip 10,10,110,110", "clip 50,10,110,40", "draw 6", "clip 10,10,110,110", "clip none",
    ]);
    // The innermost rounded clip stays as the mask of the rectangular one inside it.
    const inner = calls[3] as { state: ClipState };
    expect(inner.state.mask).toEqual([10, 10, 110, 110]);
    expect(inner.state.radii).toEqual([6, 6, 6, 6]);
  });

  test("text goes through the text painter at device size and becomes a color-glyph quad", () => {
    const { device, draws } = fakeDevice();
    const { painter, placed } = fakeText();
    const buf = new CommandBuffer();
    buf.text(10.2, 5, "hi", 14, "#336699", { weight: 700, letterSpacing: 1, family: "Inter" });
    new Renderer(device, painter).frame(400, 300, 1.5, buf.commands, buf.texts);
    expect(placed).toEqual([{ text: "hi", font: 1400, spec: "Inter\x1f\x1f", px: 21, spacing: 1.5, color: [0.2, 0.4, 0.6, 1] }]);
    const v = draws()[0]!.vertices;
    // At (round(10.2 * 1.5), round(5 * 1.5)) = (15, 8), offset by the run's box.
    expect([v[0]!.x, v[0]!.y, v[2]!.x, v[2]!.y]).toEqual([14, 6, 45, 20]);
    expect(v[0]!.mode).toBe(7);
    expect(v[2]!.uv).toEqual([0.5, 0.25]);
  });

  test("a full text atlas flushes what uses it, then resets and places again", () => {
    const { device, draws } = fakeDevice();
    const { painter, placed } = fakeText(1);
    const buf = new CommandBuffer();
    buf.text(0, 0, "a", 14, "#000");
    buf.text(0, 20, "b", 14, "#000");
    new Renderer(device, painter).frame(400, 300, 1, buf.commands, buf.texts);
    expect(placed.map((p) => p.text)).toEqual(["a", "b"]);
    expect(draws().map((d) => d.vertices.length)).toEqual([6, 6]);
  });

  test("images bind before their quads; switching image flushes; an unknown one is skipped", () => {
    const { device, calls } = fakeDevice({ 1: "srgb", 2: "display-p3" });
    // IMAGE: x y w h  u0 v0 u1 v1  r g b a  radius id
    const image = (id: number) => [6, 0, 0, 10, 10, 0, 0, 1, 1, 1, 1, 1, 1, 0, id];
    const commands = new Float32Array([...image(1), ...image(1), ...image(2), ...image(9)]);
    new Renderer(device, fakeText().painter).frame(100, 100, 1, commands, []);
    expect(calls.map((c) => (c.call === "draw" ? `draw ${c.vertices.length}` : c.call === "image" ? `image ${c.id}` : c.call))).toEqual([
      "begin", "image 1", "draw 12", "image 2", "draw 6", "image 9",
    ]);
  });

  test("a gradient colors the vertices of the next op only", () => {
    const { device, draws } = fakeDevice();
    const buf = new CommandBuffer();
    buf.rect(0, 0, 100, 10, { x0: 0, y0: 0, x1: 100, y1: 0, stops: ["#000000", "#ffffff"] });
    buf.rect(0, 20, 10, 10, "#ff0000");
    new Renderer(device, fakeText().painter).frame(100, 100, 1, buf.commands, buf.texts);
    const v = draws()[0]!.vertices;
    const gradient = v.slice(0, -6), plain = v.slice(-6);
    // The quad (-1..101) is cut at the stops: flat black before 0, a ramp, flat white after 100.
    const grayAt = (x: number) => gradient.find((p) => p.x === x)!.color[0];
    expect([grayAt(-1), grayAt(0), grayAt(100), grayAt(101)]).toEqual([0, 0, 1, 1]);
    expect(plain.every((p) => p.color.join() === "1,0,0,1")).toBe(true);
  });
});
