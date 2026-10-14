// RichText: one paragraph of spans with their own font, color, background, underline and
// onClick, wrapping across spans. Fake metrics: 8 px per character, 20 px lines (ascent 15).
import { expect, test } from "bun:test";
import { Box, Column, RichText, Row, createSignal, setTextMeasurer } from "@nodebuilderjs/core";
import { interact, mount } from "@nodebuilderjs/core/testing";
import { commandsOf } from "./helpers.js";
import { parseColor } from "../src/render/paint.js";

const rgba = (c: string) => parseColor(c);

test("each span is drawn with its own font and color, one after the other on the line", () => {
  const { root } = mount(() => (
    <RichText color="#000000" spans={["Hello ", { text: "bold", bold: true }, " and ", { text: "slanted", italic: true, color: "#ff0000" }]} />
  ));
  const texts = commandsOf(root, "text");
  expect(texts.map((t) => [t.text, t.x, t.weight, t.italic])).toEqual([
    ["Hello ", 0, 400, false],
    ["bold", 48, 700, false],
    [" and ", 80, 400, false],
    ["slanted", 120, 400, true],
  ]);
  expect(texts[3]!.color).toEqual(rgba("#ff0000"));
  expect(texts[0]!.color).toEqual(rgba("#000000"));
});

test("wraps at spaces across spans; a newline in a span breaks the line", () => {
  // 80 px: 10 characters per line.
  const { root } = mount(() => (
    <Column width={80} align="start">
      <RichText spans={["one two ", { text: "three", bold: true }, " four\nfive"]} />
    </Column>
  ));
  const node = root.children[0]!.children[0]!;
  const lines = commandsOf(root, "text").map((t) => [t.text.trimEnd(), t.x, t.y]);
  expect(lines).toEqual([["one two", 0, 0], ["three", 0, 20], [" four", 40, 20], ["five", 0, 40]]);
  expect(node.height).toBe(60);
});

test("as narrow as its longest word inside a row; as wide as its text otherwise", () => {
  const { root } = mount(() => (
    <Row width={60}>
      <RichText spans={["a ", { text: "longword", bold: true }, " b"]} />
      <Box width={1000} />
    </Row>
  ));
  expect(root.children[0]!.children[0]!.width).toBe(64);
  const { root: free } = mount(() => (
    <Column align="start">
      <RichText spans={["ab ", "cd"]} />
    </Column>
  ));
  expect(free.children[0]!.children[0]!.width).toBe(40);
});

test("spans of different sizes share a baseline; the line is as tall as its largest", () => {
  const { root, relayout } = mount(() => (
    <Column align="start">
      <RichText fontSize={10} spans={["small ", { text: "BIG", size: 20 }]} />
    </Column>
  ));
  // ascent = size, descent = size / 4
  setTextMeasurer((text, size) => ({ width: text.length * 8, ascent: size, descent: size / 4 }));
  relayout();
  const [small, big] = commandsOf(root, "text");
  expect(big!.y).toBe(0);
  expect(small!.y).toBe(10); // baseline at 20 for both
  expect(small!.size).toBe(10);
  expect(big!.size).toBe(20);
  expect(root.children[0]!.children[0]!.height).toBe(25);
});

test("background behind a span (inline code) and underline under it (links)", () => {
  const { root } = mount(() => (
    <RichText color="#000000" spans={["run ", { text: "ls", background: "#eeeeee", family: "monospace" }, " or ", { text: "docs", underline: true }]} />
  ));
  const [code, underline] = commandsOf(root, "rect");
  expect([code!.x, code!.w, code!.h]).toEqual([32, 16, 20]);
  expect(code!.color.map((c) => Math.round(c * 255))).toEqual([238, 238, 238, 255]);
  expect([underline!.x, underline!.w, underline!.color]).toEqual([80, 32, rgba("#000000")]);
  expect(commandsOf(root, "text").find((t) => t.text === "ls")!.family).toBe("monospace");
});

test("a click on a span with onClick runs it (a link); elsewhere the click goes to the parent's onClick", () => {
  const seen: string[] = [];
  const { root } = mount(() => (
    <Column align="start" onClick={() => seen.push("card")}>
      <RichText spans={["see ", { text: "[[note]]", onClick: (e) => seen.push(`link ctrl=${e.ctrl}`) }, " here"]} />
    </Column>
  ));
  const node = root.children[0]!.children[0]!;
  const ui = interact(root);
  const click = (x: number, ctrl = false) => {
    ui.move(node.x + x, node.y + 10);
    ui.down(node.x + x, node.y + 10, { ctrl });
    ui.up(node.x + x, node.y + 10, { ctrl });
  };
  click(40, true);
  click(8);
  expect(seen).toEqual(["link ctrl=true", "card"]);
});

test("the pointer cursor shows over a clickable span only", () => {
  const { root } = mount(() => (
    <Column align="start">
      <RichText spans={["see ", { text: "link", onClick: () => {} }]} />
    </Column>
  ));
  const node = root.children[0]!.children[0]!;
  const ui = interact(root);
  ui.move(node.x + 40, node.y + 10);
  expect(ui.cursor).toBe("pointer");
  ui.move(node.x + 8, node.y + 10);
  expect(ui.cursor).toBe("default");
});

test("spans may be an accessor: the paragraph follows it", () => {
  const [name, setName] = createSignal("Ana");
  const { root, relayout } = mount(() => <RichText spans={() => ["Hi ", { text: name(), bold: true }]} />);
  setName("Bea");
  relayout();
  expect(commandsOf(root, "text").map((t) => t.text)).toEqual(["Hi ", "Bea"]);
});
