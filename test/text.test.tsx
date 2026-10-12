import { afterEach, expect, test } from "bun:test";
import { Box, Button, Column, Row, Scroll, Text, clipboard, createSignal } from "@nodebuilderjs/core";
import { interact, mount } from "@nodebuilderjs/core/testing";
import { minContentWidth, wrapText } from "../src/render/text-wrap.js";
import { setClipboardBackend } from "../src/runtime/clipboard.js";
import { commandsOf } from "./helpers.js";

afterEach(() => setClipboardBackend(null));

// Same fake metrics as mount(): 8 px per character, 20 px lines.
const widthOf = (s: string) => s.length * 8;
const texts = (lines: { text: string }[]) => lines.map((l) => l.text);

test("wrapText breaks at spaces, greedily; trailing spaces do not count", () => {
  const lines = wrapText("aaa bbb ccc", 60, widthOf);
  expect(texts(lines)).toEqual(["aaa bbb", "ccc"]);
  expect(lines.map((l) => [l.start, l.end, l.width])).toEqual([[0, 8, 56], [8, 11, 24]]);
});

test("wrapText: a newline always breaks; wrap: false only breaks there", () => {
  expect(texts(wrapText("aaa\nbbb ccc", 1000, widthOf))).toEqual(["aaa", "bbb ccc"]);
  expect(texts(wrapText("aaa bbb ccc\nd", 30, widthOf, { wrap: false }))).toEqual(["aaa bbb ccc", "d"]);
});

test("wrapText: a word longer than the line gets a line of its own and overflows, like CSS", () => {
  expect(texts(wrapText("a extraordinario b", 40, widthOf))).toEqual(["a", "extraordinario", "b"]);
});

test("wrapText: maxLines cuts the text and ends the last line with an ellipsis that fits", () => {
  expect(texts(wrapText("aaa bbb ccc ddd eee", 60, widthOf, { maxLines: 2 }))).toEqual(["aaa bbb", "ccc dd…"]);
  expect(texts(wrapText("abcdefghij", 40, widthOf, { maxLines: 1 }))).toEqual(["abcd…"]);
  expect(texts(wrapText("abc", 40, widthOf, { maxLines: 1 }))).toEqual(["abc"]);
});

test("minContentWidth is the widest word", () => {
  expect(minContentWidth("um texto qualquer", widthOf)).toBe(64); // "qualquer"
});

test("Text wraps to the width of its column, and what follows moves down", () => {
  const { root } = mount(() => (
    <Column width={60}>
      <Text>aaa bbb ccc</Text>
      <Box height={10} />
    </Column>
  ));
  const [text, box] = root.children[0]!.children;
  expect([text!.width, text!.height]).toEqual([60, 40]);
  expect(box!.y).toBe(40);
  expect(commandsOf(text!, "text").map((t) => [t.text, t.y])).toEqual([["aaa bbb", 0], ["ccc", 20]]);
});

test("in a row, wrapping text shrinks down to its longest word to make room", () => {
  const { root } = mount(() => (
    <Row width={100} align="start">
      <Text>aaa bbb ccc</Text>
      <Box width={60} height={10} />
    </Row>
  ));
  const row = root.children[0]!;
  const text = row.children[0]!;
  expect([text.width, text.height]).toEqual([40, 60]);
  expect(row.height).toBe(60);
});

test("a single word or wrap={false} stays on one line", () => {
  const { root } = mount(() => (
    <Column width={40} align="start">
      <Text>palavrona</Text>
      <Text wrap={false}>aaa bbb ccc</Text>
    </Column>
  ));
  const [word, nowrap] = root.children[0]!.children;
  // Narrower than their text (the column is 40 wide), but still one line each.
  expect([word!.width, word!.height]).toEqual([40, 20]);
  expect([nowrap!.width, nowrap!.height]).toEqual([40, 20]);
  expect(commandsOf(nowrap!, "text").map((t) => t.text)).toEqual(["aaa bbb ccc"]);
});

test("textAlign places each line inside the box", () => {
  const { root } = mount(() => (
    <Column width={100}>
      <Text textAlign="center">aa bbbbbbbbbb</Text>
      <Text textAlign="end">abc</Text>
    </Column>
  ));
  const xs = commandsOf(root, "text").map((t) => [t.text, t.x]);
  expect(xs).toEqual([["aa", 42], ["bbbbbbbbbb", 10], ["abc", 76]]);
});

test("lineHeight spaces the lines, with the extra split above and below each", () => {
  const { root } = mount(() => (
    <Column width={60}>
      <Text lineHeight={1.5}>aaa bbb ccc</Text>
    </Column>
  ));
  const text = root.children[0]!.children[0]!;
  expect(text.height).toBe(60);
  expect(commandsOf(text, "text").map((t) => t.y)).toEqual([5, 35]);
});

test("maxLines={1} truncates with an ellipsis at the width the layout gives", () => {
  const { root } = mount(() => (
    <Row width={100}>
      <Text maxLines={1}>um nome muito comprido</Text>
      <Box width={60} />
    </Row>
  ));
  const text = root.children[0]!.children[0]!;
  expect(text.width).toBe(40);
  expect(commandsOf(text, "text").map((t) => t.text)).toEqual(["um n…"]);
});

test("a Scroll measures wrapped paragraphs at its own width", () => {
  const { root } = mount(() => (
    <Scroll width={60} height={30}>
      <Text>aaa bbb ccc ddd</Text>
    </Scroll>
  ));
  expect(root.children[0]!.contentHeight).toBe(40);
});

test("selectable wrapped text: a drag across lines selects across them; a double click picks a word on its line", async () => {
  const { root } = mount(() => (
    <Column width={60}>
      <Text selectable>aaa bbb ccc</Text>
    </Column>
  ));
  const text = root.children[0]!.children[0]!;
  const ui = interact(root);
  // The center (30, 20) is on the second line, after "ccc".
  ui.drag(text, -30, -20);
  ui.key("c", { ctrl: true });
  expect(await clipboard.readText()).toBe("aaa bbb ccc");
  expect(commandsOf(text, "rect")).toHaveLength(2);
  ui.press(text);
  ui.release(text);
  ui.press(text);
  ui.release(text);
  ui.key("c", { ctrl: true });
  expect(await clipboard.readText()).toBe("ccc");
});

test("selectable wrapped text: a triple click selects the line under the pointer", async () => {
  const { root } = mount(() => (
    <Column width={60}>
      <Text selectable>aaa bbb ccc dd</Text>
    </Column>
  ));
  const text = root.children[0]!.children[0]!;
  const ui = interact(root);
  for (let i = 0; i < 3; i++) {
    ui.press(text); // the center is on the second line, "ccc dd"
    ui.release(text);
  }
  ui.key("c", { ctrl: true });
  expect(await clipboard.readText()).toBe("ccc dd");
});

test("reactive text starts wrapping when it gains a space", () => {
  const [value, setValue] = createSignal("abcdefgh");
  const { root, relayout } = mount(() => (
    <Column width={40}>
      <Text>{value}</Text>
    </Column>
  ));
  const text = root.children[0]!.children[0]!;
  expect(text.height).toBe(20);
  setValue("abc defgh");
  relayout();
  expect(text.height).toBe(40);
});

test("maxLines also limits the natural size (lines from newlines)", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Text maxLines={2}>{"um\ndois\ntrês"}</Text>
    </Column>
  ));
  const text = root.children[0]!.children[0]!;
  expect(text.height).toBe(40);
  expect(commandsOf(text, "text").map((t) => t.text)).toEqual(["um", "dois três…"]);
});

test("when a row overflows, children that grow give up their room first", () => {
  const { root } = mount(() => (
    <Row width={200}>
      <Text>Nome:</Text>
      <Text grow={1} maxLines={1}>um nome de arquivo muito comprido.pdf</Text>
      <Text>12 MB</Text>
    </Row>
  ));
  const [label, name, size] = root.children[0]!.children;
  expect([label!.width, size!.width, size!.height]).toEqual([40, 40, 20]);
  expect(name!.width).toBe(120);
});

test("underline draws a rect under each wrapped line, as wide as the line, in the text color", () => {
  const { root } = mount(() => (
    <Column width={60}>
      <Text underline color="#ff0000">aaa bbb ccc</Text>
    </Column>
  ));
  const text = root.children[0]!.children[0]!;
  const rects = commandsOf(text, "rect");
  expect(rects.map((r) => [r.x, r.w, r.h, r.color])).toEqual([[0, 56, 1, [1, 0, 0, 1]], [0, 24, 1, [1, 0, 0, 1]]]);
  // Below the baseline (fake ascent 15) and inside the line's 20 px.
  rects.forEach((r, i) => {
    expect(r.y).toBeGreaterThan(i * 20 + 15);
    expect(r.y + r.h).toBeLessThanOrEqual(i * 20 + 20);
  });
});

test("underline follows textAlign, maxLines truncation and lineHeight", () => {
  const { root } = mount(() => (
    <Column width={100}>
      <Text underline textAlign="center">aa bbbbbbbbbb</Text>
      <Text underline textAlign="end" maxLines={1}>abcdefghijklmnop</Text>
      <Text underline lineHeight={2}>abc</Text>
    </Column>
  ));
  const [centered, cut, spaced] = root.children[0]!.children;
  const underlines = (n: typeof centered) => commandsOf(n!, "rect").map((r) => [r.x, r.w]);
  expect(underlines(centered)).toEqual([[42, 16], [10, 80]]);
  expect(commandsOf(cut!, "text").map((t) => t.text)).toEqual(["abcdefghijk…"]);
  expect(underlines(cut)).toEqual([[4, 96]]);
  // The glyphs sit 10 px down the 40 px line; the underline goes with them.
  const [glyphs] = commandsOf(spaced!, "text");
  const [line] = commandsOf(spaced!, "rect");
  expect(glyphs!.y - spaced!.y).toBe(10);
  expect(line!.y).toBeGreaterThan(glyphs!.y + 15);
  expect(line!.y + line!.h).toBeLessThanOrEqual(glyphs!.y + 20);
});

test("underline is inherited like bold, is reactive and gets thicker with the font size", () => {
  const [on, setOn] = createSignal(true);
  const { root, relayout } = mount(() => (
    <Column underline={on} align="start">
      <Text>abc</Text>
      <Text fontSize={28}>big</Text>
      <Text underline={false}>plain</Text>
      <Button label="Docs" />
    </Column>
  ));
  const [small, big, plain, button] = root.children[0]!.children;
  const label = button!.children[0]!;
  expect(commandsOf(small!, "rect").map((r) => r.h)).toEqual([1]);
  expect(commandsOf(big!, "rect").map((r) => r.h)).toEqual([2]);
  expect(commandsOf(plain!, "rect")).toEqual([]);
  expect(commandsOf(label, "rect").map((r) => r.w)).toEqual([32]);
  setOn(false);
  relayout();
  expect(commandsOf(small!, "rect")).toEqual([]);
  expect(commandsOf(label, "rect")).toEqual([]);
});
