// TextField: password mode, border props and focus colors, the app's own key handler.
import { expect, test } from "bun:test";
import { Button, Column, TextField, createSignal, theme } from "@nodebuilderjs/core";
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
