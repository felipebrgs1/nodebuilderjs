// TextArea: multi-line editing. Wrapping (long words split), height from the content, the caret
// across lines (Up/Down keep the column, Home/End per visual line), newlines, paste, the mouse,
// scrolling to the caret (a Scroll around it, or its own when its height is fixed).
// Fake metrics: 8 px per character, 20 px lines; the field has 9/12 px of padding.
import { expect, test } from "bun:test";
import { Column, Scroll, TextArea, clipboard, createSignal } from "@nodebuilderjs/core";
import type { ElementRef } from "@nodebuilderjs/core";
import { interact, mount } from "@nodebuilderjs/core/testing";
import { commandsOf } from "./helpers.js";

const PAD_X = 12;
const PAD_Y = 9;
const LINE = 20;

/** A focused TextArea `width` px wide (its content: width - 24) in a column. */
function area(initial = "", options: { width?: number; extra?: Record<string, unknown>; wrap?: (field: any) => any } = {}) {
  const [value, setValue] = createSignal(initial);
  const selections: string[] = [];
  const submits: string[] = [];
  const field = (
    <TextArea width={options.width ?? 104} value={value} onInput={setValue} onSubmit={() => submits.push(value())}
      onSelectionChange={(s) => selections.push(`${s.anchor}-${s.focus}`)} {...options.extra} />
  );
  const { root, relayout } = mount(() => <Column align="start">{options.wrap ? options.wrap(field) : field}</Column>, { width: 400, height: 300 });
  const node = (function find(n: any): any {
    if (n.label === "TextArea") return n;
    for (const c of n.children) {
      const f = find(c);
      if (f) return f;
    }
  })(root);
  const ui = interact(root);
  ui.down(node.x + 2, node.y + 2); // near the top: a long one goes past what a Scroll shows
  ui.up(node.x + 2, node.y + 2);
  return { root, node, value, setValue, selections, submits, ui, relayout, last: () => selections.at(-1) };
}

const lineTexts = (node: Parameters<typeof commandsOf>[0]) => commandsOf(node, "text").map((c) => c.text);

test("wraps at the width it gets (a word longer than the line is split) and is as tall as its lines", () => {
  // 80 px of content: 10 characters per line.
  const a = area("one two three four\nsupercalifragilistic");
  expect(lineTexts(a.node)).toEqual(["one two", "three four", "supercalif", "ragilistic"]);
  expect(a.node.height).toBe(4 * LINE + 2 * PAD_Y);
});

test("at least `rows` lines tall (3 by default); grows as lines are added", () => {
  const a = area("x", { extra: { rows: 2 } });
  expect(a.node.height).toBe(2 * LINE + 2 * PAD_Y);
  a.ui.key("End");
  a.ui.key("Return");
  a.ui.key("Return");
  a.ui.type("y");
  a.relayout();
  expect(a.value()).toBe("x\n\ny");
  expect(a.node.height).toBe(3 * LINE + 2 * PAD_Y);
  expect(area("").node.height).toBe(3 * LINE + 2 * PAD_Y);
});

test("Return inserts a newline; Ctrl+Return submits", () => {
  const a = area("ab");
  a.ui.key("End");
  a.ui.key("Return");
  a.ui.type("c");
  a.ui.key("Return", { ctrl: true });
  expect(a.value()).toBe("ab\nc");
  expect(a.submits).toEqual(["ab\nc"]);
});

test("Up and Down keep the column across shorter lines; at the ends they go to the start or the end", () => {
  const a = area("abcdefgh\nab\nabcdefgh");
  a.ui.key("Home", { ctrl: true });
  a.ui.key("Right");
  a.ui.key("Right");
  a.ui.key("Right");
  a.ui.key("Right"); // column 4 on line 0
  a.ui.key("Down");
  expect(a.last()).toBe("11-11"); // line 1 has 2 characters: its end
  a.ui.key("Down");
  expect(a.last()).toBe("16-16"); // back to column 4 on line 2
  a.ui.key("Down");
  expect(a.last()).toBe("20-20"); // last line: the end of the text
  a.ui.key("Up", { shift: true });
  expect(a.last()).toBe("20-11");
  a.ui.key("Up");
  a.ui.key("Up");
  a.ui.key("Up");
  expect(a.last()).toBe("0-0");
});

test("Home and End stay on the visual line; Ctrl+Home and Ctrl+End go to the ends of the text", () => {
  const a = area("one two three four");
  a.ui.key("Home", { ctrl: true });
  a.ui.key("Down"); // "three four" (soft-wrapped)
  a.ui.key("End");
  expect(a.last()).toBe("18-18");
  a.ui.key("Home");
  expect(a.last()).toBe("8-8");
  a.ui.key("Up");
  a.ui.key("End");
  expect(a.last()).toBe("7-7"); // before the space the line wrapped at
  a.ui.key("End", { ctrl: true });
  expect(a.last()).toBe("18-18");
});

test("paste keeps line breaks (CRLF becomes LF) and replaces the selection", async () => {
  const a = area("hello");
  a.ui.key("a", { ctrl: true });
  clipboard.writeText("one\r\ntwo\tthree");
  a.ui.key("v", { ctrl: true });
  await Promise.resolve();
  await Promise.resolve();
  expect(a.value()).toBe("one\ntwo\tthree");
});

test("a click puts the caret under the pointer on that line; a drag selects across lines", () => {
  const a = area("abcdefgh\nijklmnop");
  const x = (col: number) => a.node.x + PAD_X + col * 8;
  const y = (line: number) => a.node.y + PAD_Y + line * LINE + 10;
  a.ui.down(x(3), y(1));
  a.ui.up(x(3), y(1));
  expect(a.last()).toBe("12-12");
  a.ui.down(x(6), y(0));
  a.ui.move(x(2), y(1));
  a.ui.up(x(2), y(1));
  expect(a.last()).toBe("6-11");
  // The selection is painted on both lines.
  const marks = commandsOf(a.node, "rect").filter((r) => r.h === LINE); // line-tall: selection marks (no caret while selecting)
  expect(marks.map((r) => [r.x - a.node.x - PAD_X, r.w])).toEqual([[48, 16], [0, 16]]);
});

test("in a Scroll, the caret is scrolled into view as it moves down", () => {
  let scroller!: ElementRef;
  const a = area("", { wrap: (field) => <Scroll height={100} ref={(e) => (scroller = e)}>{field}</Scroll> });
  for (let i = 0; i < 10; i++) {
    a.ui.type(`line ${i}`);
    a.ui.key("Return");
  }
  a.relayout();
  // The caret is on line 10, the last: 9 + 200..220 inside the field, plus the padding below it.
  expect(scroller.scrollY).toBe(PAD_Y + 11 * LINE + PAD_Y - 100);
  a.ui.key("Home", { ctrl: true });
  a.relayout();
  expect(scroller.scrollY).toBe(0);
});

test("with a fixed height it scrolls by itself: to the caret, and with the wheel", () => {
  const a = area(Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n"), { extra: { height: 2 * LINE + 2 * PAD_Y } });
  a.ui.key("End", { ctrl: true });
  a.relayout();
  expect(lineTexts(a.node)).toEqual(["l8", "l9"]); // only the lines it shows are drawn
  a.ui.scroll(a.node, -50); // 110..150 of the content
  a.relayout();
  expect(lineTexts(a.node)).toEqual(["l5", "l6", "l7"]); // a line cut at each edge
});

test("only the lines on screen are drawn in a long document", () => {
  const text = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
  const a = area(text, { wrap: (field) => <Scroll height={100}>{field}</Scroll> });
  a.ui.key("Home", { ctrl: true });
  a.relayout();
  expect(lineTexts(a.node).length).toBeLessThan(10);
});

test("undo, word moves and the placeholder work as in TextField", () => {
  const a = area("", { extra: { placeholder: "Write something" } });
  expect(lineTexts(a.node)).toEqual(["Write something"]);
  a.ui.type("one two");
  a.ui.key("Return");
  a.ui.type("three");
  a.ui.key("z", { ctrl: true });
  expect(a.value()).toBe("one two\n");
  a.ui.key("Left", { ctrl: true });
  expect(a.last()).toBe("4-4");
});
