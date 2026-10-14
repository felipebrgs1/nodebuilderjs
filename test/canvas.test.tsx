import { expect, test } from "bun:test";
import { Canvas, Column, Row, Scroll, UINode, createRoot, createSignal, layout, setTextMeasurer } from "@nodebuilderjs/core";
import type { DrawContext, ElementRef } from "@nodebuilderjs/core";
import { insert } from "@nodebuilderjs/core/jsx-runtime";
import { drawCommands } from "./helpers.js";

setTextMeasurer((text, _size, font) => ({ width: text.length * (8 + font.letterSpacing), ascent: 15, descent: 5 }));

function mount(view: () => any) {
  const root = new UINode("root");
  root.isRoot = true;
  const dispose = createRoot((d) => {
    insert(root, view);
    return d;
  });
  const node = root.children[0]!;
  layout(node, 400, 300);
  return { node, dispose };
}

test("Canvas: draws in local coordinates, inside its padding", () => {
  let seen = { width: 0, height: 0 };
  const { node } = mount(() => (
    <Column padding={10}>
      <Canvas width={200} height={100} padding={5} draw={(g) => {
        seen = { width: g.width, height: g.height };
        g.rect(0, 0, 10, 10, "#ff0000");
        g.line(0, 0, 20, 0, "#ff0000", 2, "square");
      }} />
    </Column>
  ));
  expect(seen).toEqual({ width: 0, height: 0 }); // not drawn before it has a size
  const [rect, line] = drawCommands(node);
  expect(seen).toEqual({ width: 190, height: 90 });
  expect(rect).toMatchObject({ op: "rect", x: 15, y: 15, w: 10, h: 10 });
  expect(line).toMatchObject({ op: "line", x0: 14, y0: 15, x1: 36, y1: 15, width: 2, capStart: "butt", capEnd: "butt" });
});

test("Canvas: polylines, polygons, circles, arcs and text", () => {
  const { node } = mount(() => (
    <Column>
      <Canvas width={100} height={100} draw={(g: DrawContext) => {
        g.polyline([0, 0, 10, 0, 10, 10], "#000", 3);
        g.polygon([0, 0, 10, 0, 10, 10, 0, 10], "#000");
        g.circle(50, 50, 4, "#000");
        g.arc(50, 50, 40, 30, 0, Math.PI / 2, "#000");
        g.text("olá", 1, 2, "#000", 12, true);
        expect(g.measureText("olá", 12)).toEqual({ width: 24, height: 20 });
      }} />
    </Column>
  ));
  expect(drawCommands(node).map((c) => c.op)).toEqual(["line", "line", "triangles", "arc", "arc", "text"]);
  const [, , , circle, arc, text] = drawCommands(node);
  expect(circle).toMatchObject({ cx: 50, cy: 50, outer: 4, inner: 0, sweep: 6.283 });
  expect(arc).toMatchObject({ outer: 40, inner: 30, start: 0, sweep: 1.571 });
  expect(text).toMatchObject({ text: "olá", x: 1, y: 2, size: 12, bold: true });
});

test("Canvas: text with maxWidth is cut to fit, ending in an ellipsis", () => {
  const { node } = mount(() => (
    <Column>
      <Canvas width={200} height={100} draw={(g) => {
        g.text("a long title here", 0, 0, "#000", 12, true, { maxWidth: 50 });
        g.text("short", 0, 20, "#000", 12, false, { maxWidth: 50 });
        g.text("a long title here", 0, 40, "#000", 12, false, { maxWidth: 50, ellipsis: false });
        g.text("no room at all", 0, 60, "#000", 12, false, { maxWidth: 7 }); // "…" alone is 8 px
      }} />
    </Column>
  ));
  const texts = drawCommands(node).filter((c) => c.op === "text");
  expect(texts.map((t) => t.text)).toEqual(["a lon…", "short", "a long"]);
  for (const t of texts) expect(t.text.length * 8).toBeLessThanOrEqual(50); // fake metrics: 8 px per character
  expect(texts[0]).toMatchObject({ x: 0, y: 0, size: 12, bold: true });
});

test("Canvas: text and measureText take weight, italic and letterSpacing options", () => {
  let measured = { width: 0, height: 0 };
  const { node } = mount(() => (
    <Column>
      <Canvas width={200} height={100} draw={(g) => {
        g.text("abc", 0, 0, "#000", 12, false, { weight: 300, italic: true, letterSpacing: 2 });
        g.text("abc", 0, 20, "#000", 12, true);
        g.text("abc", 0, 40, "#000", 12, true, { weight: 900 }); // weight wins over bold
        measured = g.measureText("abc", 12, false, { letterSpacing: 2 });
      }} />
    </Column>
  ));
  const texts = drawCommands(node).filter((c) => c.op === "text");
  expect(texts.map((t) => [t.weight, t.italic, t.letterSpacing])).toEqual([[300, true, 2], [700, false, 0], [900, false, 0]]);
  expect(measured.width).toBe(30); // fake metrics: 8 px per character + 2 after each
});

test("Canvas: signals read while drawing redraw it, once per change", () => {
  const [value, setValue] = createSignal(10);
  let calls = 0;
  const { node } = mount(() => (
    <Column>
      <Canvas width={100} height={50} draw={(g) => {
        calls++;
        g.rect(0, 0, value(), 10, "#000");
      }} />
    </Column>
  ));
  expect(drawCommands(node)[0]).toMatchObject({ w: 10 });
  const before = calls;
  setValue(30);
  expect(calls).toBe(before + 1); // re-recorded right away (tracking)
  expect(drawCommands(node)[0]).toMatchObject({ w: 30 });
  drawCommands(node);
  expect(calls).toBe(before + 1); // painting again replays, no extra draw
});

test("Canvas: a new size redraws at paint time", () => {
  const [w, setW] = createSignal(100);
  let widths: number[] = [];
  const { node } = mount(() => (
    <Column align="start">
      <Canvas width={w} height={50} draw={(g) => { widths.push(g.width); g.rect(0, 0, g.width, 1, "#000"); }} />
    </Column>
  ));
  drawCommands(node);
  widths = [];
  setW(150);
  layout(node, 400, 300);
  expect(drawCommands(node)[0]).toMatchObject({ w: 150 });
  expect(widths).toEqual([150]);
});

test("Canvas measure: the height for the content width it gets (inside its padding), like wrapping text", async () => {
  const { mount: mountApp } = await import("@nodebuilderjs/core/testing");
  const [words, setWords] = createSignal(400); // 400 px of "text", 20 px lines
  const [width, setWidth] = createSignal(220);
  const widths: number[] = [];
  const { root, relayout } = mountApp(() => (
    <Column width={width}>
      <Canvas padding={10} measure={(w) => (widths.push(w), Math.ceil(words() / w) * 20)} draw={() => {}} />
    </Column>
  ));
  const canvas = root.children[0]!.children[0]!;
  expect(canvas.height).toBe(60); // 400 / 200 = 2 lines + padding
  expect(widths).toContain(200);
  setWidth(120);
  relayout();
  expect(canvas.height).toBe(100); // 4 lines
  setWords(900);
  relayout();
  expect(canvas.height).toBe(200); // 9 lines + padding: what measure reads is tracked
});

test("Canvas measure in a Scroll: the content's height is what scrolls", async () => {
  const { mount: mountApp } = await import("@nodebuilderjs/core/testing");
  const { root } = mountApp(() => (
    <Scroll height={100} width={200}>
      <Canvas measure={() => 1000} draw={() => {}} />
    </Scroll>
  ));
  expect(root.children[0]!.children[0]!.height).toBe(1000);
});

test("Canvas visibleRect: the part a Scroll shows, in local coordinates; read it to redraw on scroll", async () => {
  const { mount: mountApp } = await import("@nodebuilderjs/core/testing");
  const seen: string[] = [];
  let plainDraws = 0;
  let scroller!: ElementRef;
  const { relayout } = mountApp(() => (
    <Row>
      <Scroll height={100} width={200} ref={(e) => (scroller = e)}>
        <Canvas height={1000} draw={(g) => {
          const r = g.visibleRect;
          seen.push(`${r.x},${r.y} ${r.width}x${r.height}`);
        }} />
      </Scroll>
      <Scroll height={100} width={200}>
        <Canvas height={1000} draw={() => plainDraws++} />
      </Scroll>
    </Row>
  ), { width: 400, height: 300, paint: true });
  expect(seen).toEqual(["0,0 200x100"]);
  scroller.scrollTo(300);
  relayout();
  expect(seen).toEqual(["0,0 200x100", "0,300 200x100"]);
  expect(plainDraws).toBe(1); // it does not read visibleRect: no redraw on scroll
});

test("Canvas visibleRect is cut by the window too", async () => {
  const { mount: mountApp } = await import("@nodebuilderjs/core/testing");
  const seen: string[] = [];
  mountApp(() => (
    <Column padding={[50, 0, 0, 0]}>
      <Canvas height={1000} draw={(g) => seen.push(`${g.visibleRect.y} ${g.visibleRect.height}`)} />
    </Column>
  ), { width: 300, height: 200, paint: true });
  expect(seen).toEqual(["0 150"]);
});

test("Canvas visibleRect inside an Overlay: the Scroll it was declared in does not cut it", async () => {
  const { mount: mountApp } = await import("@nodebuilderjs/core/testing");
  const { Overlay } = await import("@nodebuilderjs/core");
  const seen: string[] = [];
  mountApp(() => (
    <Scroll height={50} width={300}>
      <Overlay>
        <Canvas height={120} draw={(g) => seen.push(`${g.visibleRect.width}x${g.visibleRect.height}`)} />
      </Overlay>
    </Scroll>
  ), { width: 300, height: 200, paint: true });
  expect(seen).toEqual(["300x120"]);
});
