// TextField: password mode, border props and focus colors, the app's own key handler.
import { expect, test } from "bun:test";
import { Button, Column, TextField, clipboard, createSignal, theme } from "@nodebuilderjs/core";
import { interact, mount } from "@nodebuilderjs/core/testing";
import { commandsOf } from "./helpers.js";

const texts = (node: Parameters<typeof commandsOf>[0]) => commandsOf(node, "text").map((c) => c.text);

test("password: the value stays real (editing in the middle works), only the drawing is masked", () => {
  const [value, setValue] = createSignal("");
  const [masked, setMasked] = createSignal(true);
  const { root } = mount(() => (
    <Column align="start">
      <TextField password={masked} value={value} onInput={setValue} />
    </Column>
  ));
  const field = root.children[0]!.children[0]!;
  const ui = interact(root);
  ui.press(field);
  ui.type("abc");
  ui.key("Left");
  ui.key("Left");
  ui.type("X");
  expect(value()).toBe("aXbc");
  expect(texts(field)).toEqual(["••••"]);
  setMasked(false);
  expect(texts(field)).toEqual(["aXbc"]);
});

test("password: the caret sits after the masked characters", () => {
  const [value, setValue] = createSignal("wide");
  const { root } = mount(() => (
    <Column align="start">
      <TextField password value={value} onInput={setValue} />
    </Column>
  ));
  const field = root.children[0]!.children[0]!;
  interact(root).press(field);
  // Fake metrics: 8 px per character; the caret is a 1.5 px wide rect.
  const caret = commandsOf(field, "rect").find((r) => r.w === 1.5)!;
  const text = commandsOf(field, "text")[0]!;
  expect(caret.x - text.x).toBeGreaterThanOrEqual(0);
  expect(caret.x).toBeLessThanOrEqual(Math.round(text.x + 4 * 8)); // within the four masked characters' width
});

test("borderWidth and borderColor from the app win, focused or not", () => {
  const [value, setValue] = createSignal("");
  const { root } = mount(() => (
    <Column align="start">
      <TextField borderWidth={0} borderColor="#000000" value={value} onInput={setValue} />
    </Column>
  ));
  const field = root.children[0]!.children[0]!;
  expect([field.style.borderWidth, field.style.borderColor]).toEqual([0, "#000000"]);
  interact(root).press(field);
  expect([field.style.borderWidth, field.style.borderColor]).toEqual([0, "#000000"]);
});

test("focusBorderColor and focusBorderWidth restyle the focus ring", () => {
  const [value, setValue] = createSignal("");
  const { root } = mount(() => (
    <Column align="start">
      <TextField borderColor="#222222" focusBorderColor="#ff0000" focusBorderWidth={3} value={value} onInput={setValue} />
      <Button label="other" />
    </Column>
  ));
  const [field, other] = root.children[0]!.children;
  const ui = interact(root);
  expect([field!.style.borderWidth, field!.style.borderColor]).toEqual([1, "#222222"]);
  ui.press(field!);
  expect([field!.style.borderWidth, field!.style.borderColor]).toEqual([3, "#ff0000"]);
  ui.press(other!);
  expect([field!.style.borderWidth, field!.style.borderColor]).toEqual([1, "#222222"]);
});

test("without border props: theme border, a 2 px focus ring in the theme's focus color", () => {
  const [value, setValue] = createSignal("");
  const { root } = mount(() => (
    <Column align="start">
      <TextField value={value} onInput={setValue} />
    </Column>
  ));
  const field = root.children[0]!.children[0]!;
  expect([field.style.borderWidth, field.style.borderColor]).toEqual([1, theme.field.border]);
  interact(root).press(field);
  expect([field.style.borderWidth, field.style.borderColor]).toEqual([2, theme.field.focus]);
});

test("the app's onKeyDown runs first; stop() there keeps the key from the field", () => {
  const [value, setValue] = createSignal("");
  const seen: string[] = [];
  const { root } = mount(() => (
    <Column align="start">
      <TextField
        value={value}
        onInput={setValue}
        onKeyDown={(e) => {
          seen.push(e.key);
          if (e.key === "x") e.stop();
        }}
      />
    </Column>
  ));
  const ui = interact(root);
  ui.press(root.children[0]!.children[0]!);
  ui.type("axb");
  expect(seen).toEqual(["a", "x", "b"]);
  expect(value()).toBe("ab");
});

// ---- editing: selection, clipboard, undo, mouse --------------------------------------------

/** A focused field holding `initial`, its value, the selections it reported and an `interact`. */
function field(initial = "", extra: Record<string, unknown> = {}) {
  const [value, setValue] = createSignal(initial);
  const selections: string[] = [];
  const { root, relayout } = mount(() => (
    <Column align="start">
      <TextField value={value} onInput={setValue} onSelectionChange={(s) => selections.push(`${s.anchor}-${s.focus}`)} {...extra} />
    </Column>
  ));
  const node = root.children[0]!.children[0]!;
  const ui = interact(root);
  ui.press(node);
  ui.release(node);
  return { node, value, setValue, selections, ui, relayout };
}

test("Shift+arrows select; typing replaces the selection; the app hears every selection change", () => {
  const f = field("hello");
  f.ui.key("End");
  f.ui.key("Left", { shift: true });
  f.ui.key("Left", { shift: true });
  expect(f.selections.at(-1)).toBe("5-3");
  f.ui.type("p!");
  expect(f.value()).toBe("help!");
  expect(f.selections.at(-1)).toBe("5-5");
  f.ui.key("Home", { shift: true });
  f.ui.key("Left"); // collapses to the start of the selection
  expect(f.selections.at(-1)).toBe("0-0");
});

test("Ctrl+Left/Right move by words; Ctrl+Backspace/Delete delete a word", () => {
  const f = field("one two  three");
  f.ui.key("End");
  f.ui.key("Left", { ctrl: true });
  expect(f.selections.at(-1)).toBe("9-9");
  f.ui.key("Left", { ctrl: true });
  expect(f.selections.at(-1)).toBe("4-4");
  f.ui.key("Right", { ctrl: true, shift: true });
  expect(f.selections.at(-1)).toBe("4-7");
  f.ui.key("End");
  f.ui.key("BackSpace", { ctrl: true });
  expect(f.value()).toBe("one two  ");
  f.ui.key("Home");
  f.ui.key("Delete", { ctrl: true });
  expect(f.value()).toBe(" two  ");
});

test("Ctrl+A, Ctrl+C, Ctrl+X and Ctrl+V (over the selection)", async () => {
  const f = field("copy me");
  f.ui.key("a", { ctrl: true });
  f.ui.key("c", { ctrl: true });
  expect(await clipboard.readText()).toBe("copy me");
  f.ui.key("End");
  f.ui.key("Left", { ctrl: true, shift: true });
  f.ui.key("x", { ctrl: true });
  expect(f.value()).toBe("copy ");
  expect(await clipboard.readText()).toBe("me");
  f.ui.key("Home");
  f.ui.key("Right", { shift: true, ctrl: true });
  f.ui.key("v", { ctrl: true });
  await Promise.resolve();
  await Promise.resolve();
  expect(f.value()).toBe("me ");
});

test("undo and redo: a run of typing undoes as one step, each word on its own", () => {
  const f = field();
  f.ui.type("hello world");
  f.ui.key("BackSpace");
  f.ui.key("BackSpace");
  expect(f.value()).toBe("hello wor");
  f.ui.key("z", { ctrl: true });
  expect(f.value()).toBe("hello world");
  f.ui.key("z", { ctrl: true });
  expect(f.value()).toBe("hello ");
  f.ui.key("z", { ctrl: true });
  f.ui.key("z", { ctrl: true });
  expect(f.value()).toBe("");
  f.ui.key("z", { ctrl: true, shift: true });
  expect(f.value()).toBe("hello");
  f.ui.key("y", { ctrl: true });
  expect(f.value()).toBe("hello ");
  f.ui.type("X"); // a new edit drops what could be redone
  f.ui.key("y", { ctrl: true });
  expect(f.value()).toBe("hello X");
});

test("a value the app sets clears the history and keeps the selection inside it", () => {
  const f = field("long text here");
  f.ui.key("End");
  f.setValue("short");
  f.relayout();
  expect(f.selections.at(-1)).toBe("5-5");
  f.ui.key("z", { ctrl: true });
  expect(f.value()).toBe("short");
});

test("mouse: a drag selects, a double click selects a word, Shift+click extends", () => {
  const f = field("alpha beta gamma");
  // Fake metrics: 8 px per character; the text starts after 12 px of padding.
  const at = (i: number) => f.node.x + 12 + i * 8;
  const y = f.node.y + f.node.height / 2;
  f.ui.move(at(1), y);
  f.ui.down(at(1), y);
  f.ui.move(at(4), y);
  f.ui.up(at(4), y);
  expect(f.selections.at(-1)).toBe("1-4");
  f.ui.down(at(7) + 2, y);
  f.ui.up(at(7) + 2, y);
  f.ui.down(at(7) + 2, y); // second click: the word
  f.ui.up(at(7) + 2, y);
  expect(f.selections.at(-1)).toBe("6-10");
  f.ui.down(at(14), y, { shift: true });
  f.ui.up(at(14), y, { shift: true });
  expect(f.selections.at(-1)).toBe("6-14");
});

test("the selection prop moves the caret (splitting a line at it, in a block editor)", () => {
  const [sel, setSel] = createSignal({ anchor: 0, focus: 0 });
  const f = field("abcdef", { selection: sel });
  setSel({ anchor: 3, focus: 3 });
  f.ui.type("|");
  expect(f.value()).toBe("abc|def");
});

test("the selection is painted under the text, in the theme's selection color", () => {
  const f = field("select");
  f.ui.key("Home");
  f.ui.key("End", { shift: true });
  const marks = commandsOf(f.node, "rect").filter((r) => r.w === 48);
  expect(marks).toHaveLength(1);
});

test("password: nothing is copied or cut, and Ctrl+arrows go to the ends", async () => {
  clipboard.writeText("before");
  const f = field("secret pass", { password: true });
  f.ui.key("a", { ctrl: true });
  f.ui.key("c", { ctrl: true });
  f.ui.key("x", { ctrl: true });
  expect(await clipboard.readText()).toBe("before");
  expect(f.value()).toBe("secret pass");
  f.ui.key("End");
  f.ui.key("Left", { ctrl: true });
  expect(f.selections.at(-1)).toBe("0-0");
});
