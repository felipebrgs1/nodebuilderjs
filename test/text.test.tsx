import { afterEach, expect, test } from "bun:test";
import { Box, Button, Column, Row, Scroll, Text, TextField, clipboard, createSignal, setTextMeasurer } from "@nodebuilderjs/core";
import { interact, mount } from "@nodebuilderjs/core/testing";
import { minContentWidth, wrapText } from "../src/render/text-wrap.js";
import { setClipboardBackend } from "../src/runtime/clipboard.js";
import { type Native, fontId, nativeTextMeasurer } from "../src/runtime/native.js";
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

// ---- font weight, italic, letter spacing (fake metrics add letterSpacing per character) ----

test("fontWeight and italic reach the text command; bold is weight 700; both are inherited", () => {
  const { root } = mount(() => (
    <Column fontWeight={300} italic>
      <Text>light</Text>
      <Text bold>bold</Text>
      <Text fontWeight={900} italic={false}>black</Text>
      <Column bold>
        <Text>inherits bold</Text>
        <Text fontWeight={500}>medium</Text>
      </Column>
      <Column fontWeight={800}>
        <Text bold={false}>regular</Text>
      </Column>
      <Box fontWeight={200} bold>
        <Text>fontWeight wins over bold on the same node</Text>
      </Box>
    </Column>
  ));
  expect(commandsOf(root, "text").map((t) => [t.text, t.weight, t.italic])).toEqual([
    ["light", 300, true],
    ["bold", 700, true],
    ["black", 900, false],
    ["inherits bold", 700, true],
    ["medium", 500, true],
    ["regular", 400, true],
    ["fontWeight wins over bold on the same node", 200, true],
  ]);
  expect(commandsOf(root, "text").map((t) => t.bold)).toEqual([false, true, true, true, false, false, false]);
});

test("fontWeight, italic and letterSpacing are reactive", () => {
  const [weight, setWeight] = createSignal(400);
  const [italic, setItalic] = createSignal(false);
  const [spacing, setSpacing] = createSignal(0);
  const { root, relayout } = mount(() => (
    <Column align="start">
      <Text fontWeight={weight} italic={italic} letterSpacing={spacing}>abc</Text>
    </Column>
  ));
  const text = root.children[0]!.children[0]!;
  expect(text.width).toBe(24);
  expect(commandsOf(text, "text")[0]).toMatchObject({ weight: 400, italic: false, letterSpacing: 0 });
  setWeight(800);
  setItalic(true);
  setSpacing(2);
  relayout();
  expect(commandsOf(text, "text")[0]).toMatchObject({ weight: 800, italic: true, letterSpacing: 2 });
  expect(text.width).toBe(30);
});

test("the measurer gets the resolved font: weight, italic and letter spacing", () => {
  const { relayout } = mount(() => (
    <Column fontWeight={600} letterSpacing={1.5}>
      <Text italic fontSize={14}>x</Text>
    </Column>
  ));
  const seen = new Set<string>();
  setTextMeasurer((text, size, font) => {
    seen.add(`${text}|${size}|${font.weight}|${font.italic}|${font.letterSpacing}`);
    return { width: text.length * 8, ascent: 15, descent: 5 };
  });
  relayout();
  expect([...seen]).toContain("x|14|600|true|1.5");
});

test("letterSpacing (inherited, may be negative) widens the text, its wrapping and its underline", () => {
  const { root } = mount(() => (
    <Column align="start" letterSpacing={2}>
      <Text underline>abc</Text>
      <Text letterSpacing={-1}>abc</Text>
      <Column width={70}>
        <Text>aaa bbb ccc</Text>
      </Column>
    </Column>
  ));
  const [spaced, tight, column] = root.children[0]!.children;
  // After every character, the last one too (as browsers do): 3 * (8 + 2).
  expect(spaced!.width).toBe(30);
  expect(commandsOf(spaced!, "rect").map((r) => r.w)).toEqual([30]);
  expect(commandsOf(spaced!, "text")[0]).toMatchObject({ letterSpacing: 2 });
  expect(tight!.width).toBe(21);
  // "aaa bbb" is 7 * 10 = 70 and fits; "ccc" goes below.
  expect(commandsOf(column!, "text").map((t) => t.text)).toEqual(["aaa bbb", "ccc"]);
});

test("a change of an ancestor's font props re-measures the text in the next layout", () => {
  const [spacing, setSpacing] = createSignal(0);
  const [size, setSize] = createSignal(14);
  const { root, relayout } = mount(() => (
    <Column align="start" letterSpacing={spacing} fontSize={size}>
      <Row>
        <Text>abc</Text>
      </Row>
    </Column>
  ));
  const text = root.children[0]!.children[0]!.children[0]!;
  expect(text.width).toBe(24);
  setSpacing(2);
  relayout();
  expect(text.width).toBe(30);
  setSize(30);
  relayout();
  expect(commandsOf(text, "text")[0]).toMatchObject({ size: 30, letterSpacing: 2 });
});

test("the addon measurer caches by text, size and font, and passes a font id and a font spec", () => {
  const calls: unknown[][] = [];
  const nat = { measureText: (...args: unknown[]) => (calls.push(args), [10, 15, 5]) } as unknown as Native;
  const measure = nativeTextMeasurer(nat, 2);
  const regular = { weight: 400, italic: false, letterSpacing: 0, family: "", features: "", variations: "" };
  measure("a", 14, regular);
  measure("a", 14, { ...regular });
  measure("a", 14, { ...regular, weight: 700 });
  measure("a", 14, { ...regular, italic: true });
  measure("a", 14, { ...regular, letterSpacing: 1 });
  measure("a", 14, { ...regular, letterSpacing: 1 });
  measure("a", 14, { ...regular, family: "Inter" });
  measure("a", 14, { ...regular, family: "Inter" });
  measure("a", 14, { ...regular, features: "tnum" });
  measure("a", 14, { ...regular, variations: "wdth 75" });
  // font id = weight * 2 + italic; spec = family, features, variations joined by U+001F ("" for none)
  expect(calls).toEqual([
    ["a", 14, 800, 2, 0, ""], ["a", 14, 1400, 2, 0, ""], ["a", 14, 801, 2, 0, ""], ["a", 14, 800, 2, 1, ""],
    ["a", 14, 800, 2, 0, "Inter\x1f\x1f"], ["a", 14, 800, 2, 0, "\x1ftnum\x1f"], ["a", 14, 800, 2, 0, "\x1f\x1fwdth 75"],
  ]);
  expect(fontId(700, true)).toBe(1401);
});

test("TextField draws its value and placeholder with the inherited weight, italic and spacing", () => {
  const { root } = mount(() => (
    <Column fontWeight={600} italic letterSpacing={1}>
      <TextField value={() => "abc"} onInput={() => {}} />
      <TextField value={() => ""} placeholder="Search" onInput={() => {}} />
    </Column>
  ));
  expect(commandsOf(root, "text").map((t) => [t.text, t.weight, t.italic, t.letterSpacing])).toEqual([
    ["abc", 600, true, 1],
    ["Search", 600, true, 1],
  ]);
});

test("letterSpacing moves the selection edges of selectable Text", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Text selectable letterSpacing={4}>abcd</Text>
    </Column>
  ));
  const text = root.children[0]!.children[0]!;
  const ui = interact(root);
  // Each character is 12 px: x 25 is past the middle of the second one, so two get selected.
  ui.move(text.x + 1, text.y + 5);
  ui.down(text.x + 1, text.y + 5);
  ui.move(text.x + 25, text.y + 5);
  ui.up(text.x + 25, text.y + 5);
  const [highlight] = commandsOf(text, "rect");
  expect([highlight!.x - text.x, highlight!.w]).toEqual([0, 24]);
});

test("measureText is public and uses the same metrics as layout (before anything is painted)", async () => {
  const { measureText } = await import("@nodebuilderjs/core");
  setTextMeasurer((text, size, font) => ({ width: text.length * size * (font.italic ? 0.6 : 0.5), ascent: size, descent: size / 4 }));
  expect(measureText("abcd", 10)).toEqual({ width: 20, ascent: 10, descent: 2.5 });
  expect(measureText("abcd", 10, { italic: true, family: "monospace" }).width).toBe(24);
});
