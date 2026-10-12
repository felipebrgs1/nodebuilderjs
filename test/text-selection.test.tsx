import { afterEach, expect, test } from "bun:test";
import { Box, Column, Text, TextField, clipboard, createSignal } from "@nodebuilderjs/core";
import { interact, mount } from "@nodebuilderjs/core/testing";
import { setClipboardBackend } from "../src/runtime/clipboard.js";
import { createInput } from "../src/runtime/input.js";
import { commandsOf } from "./helpers.js";

afterEach(() => setClipboardBackend(null));

// "hello world!" has 12 characters: 96 px with the fake metrics, centered at x = 48, right
// before the "w". Drags start at the center.
function setup(selectable = true) {
  const [value, setValue] = createSignal("hello world!");
  const [field, setField] = createSignal("");
  const { root } = mount(() => (
    <Column align="start">
      <Text selectable={selectable}>{value}</Text>
      <TextField value={field} onInput={setField} />
    </Column>
  ));
  const [text, input] = root.children[0]!.children as [any, any];
  const ui = interact(root);
  const highlight = () => commandsOf(text, "rect");
  const copy = async () => {
    ui.key("c", { ctrl: true });
    return clipboard.readText();
  };
  return { root, text, input, ui, highlight, copy, setValue };
}

test("Text selectable: dragging selects, Ctrl+C copies, the selection is highlighted", async () => {
  const { text, ui, highlight, copy } = setup();
  expect(text.style.cursor).toBe("text");
  ui.drag(text, 100, 0);
  expect(await copy()).toBe("world!");
  expect(highlight()).toMatchObject([{ x: text.x + 48, y: text.y, w: 48, h: 20 }]);
});

test("Text selectable: dragging backwards selects up to the start", async () => {
  const { text, ui, copy } = setup();
  ui.drag(text, -100, 0);
  expect(await copy()).toBe("hello ");
});

test("Text selectable: double click selects a word, triple click the line (here, all of it)", async () => {
  const { text, ui, copy } = setup();
  ui.press(text);
  ui.release(text);
  ui.press(text);
  ui.release(text);
  expect(await copy()).toBe("world");
  ui.press(text);
  ui.release(text);
  expect(await copy()).toBe("hello world!");
});

test("Text selectable: Ctrl+A selects all of it", async () => {
  const { text, ui, copy } = setup();
  ui.press(text);
  ui.release(text);
  ui.key("a", { ctrl: true });
  expect(await copy()).toBe("hello world!");
});

test("Text selectable: clicking elsewhere or changing the text clears the selection", () => {
  const first = setup();
  first.ui.drag(first.text, 100, 0);
  first.ui.press(first.input);
  expect(first.highlight()).toEqual([]);

  const second = setup();
  second.ui.drag(second.text, 100, 0);
  second.setValue("hi");
  expect(second.highlight()).toEqual([]);
});

test("Text selectable: stays out of the Tab order", () => {
  const { input, ui } = setup();
  ui.key("Tab");
  expect(ui.focused).toBe(input);
});

test("Text is not selectable by default", async () => {
  const { text, ui, highlight, copy } = setup(false);
  expect(text.style.cursor).toBeUndefined();
  ui.drag(text, 100, 0);
  expect(highlight()).toEqual([]);
  expect(await copy()).toBe("");
});

test("Text selectable inside a drag region selects instead of moving the window", () => {
  for (const selectable of [true, false]) {
    let moves = 0;
    const { root } = mount(() => (
      <Box direction="row">
        <Text selectable={selectable}>title</Text>
      </Box>
    ));
    const bar = root.children[0]!;
    bar.dragRegion = true;
    const input = createInput(root, {
      size: () => ({ width: 800, height: 600 }), resizable: () => false, setCursor() {}, resize() {},
      move: () => moves++, invalidate() {}, now: () => 0,
    });
    const label = bar.children[0]!;
    input.pointerDown(label.x + 4, label.y + 4, 0);
    expect(moves).toBe(selectable ? 0 : 1);
  }
});
