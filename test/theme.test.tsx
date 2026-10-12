import { afterEach, expect, test } from "bun:test";
import {
  Button, Canvas, Card, Checkbox, Column, Dialog, Divider, Select, Text, TextField, Window, colorScheme, createEffect, createRoot,
  createSignal, darkTheme, lightTheme, setTheme, theme,
} from "@nodebuilderjs/core";
import { findByText, mount } from "@nodebuilderjs/core/testing";
import { commandsOf, drawCommands } from "./helpers.js";
import { parseColor } from "../src/render/paint.js";

afterEach(() => setTheme("light"));

const rgba = (c: string) => parseColor(c).map((v) => Math.round(v * 1000) / 1000) as [number, number, number, number];

test("setTheme('dark') recolors what is on screen: backgrounds, borders and default text", () => {
  const [name, setName] = createSignal("");
  const { root } = mount(() => (
    <Window title="App">
      <Card>
        <Text>olá</Text>
        <Divider />
        <TextField value={name} onInput={setName} />
        <Button label="Salvar" />
      </Card>
    </Window>
  ));
  const window = root.children[0]!;
  const card = findByText(root, "olá")!.parent!;
  const [, divider, field, button] = card.children;
  setTheme("dark");
  expect(window.style.background).toBe(darkTheme.window.background);
  expect([card.style.background, card.style.borderColor]).toEqual([darkTheme.card.background, darkTheme.card.border]);
  expect(divider!.style.background).toBe(darkTheme.divider);
  expect(field!.style.background).toBe(darkTheme.field.background);
  expect(button!.style.background).toBe(darkTheme.control.base);
  expect(commandsOf(card.children[0]!, "text")[0]!.color).toEqual(rgba(darkTheme.text.primary));
  setTheme("light");
  expect(window.style.background).toBe(lightTheme.window.background);
});

test("colorScheme and effects that read the theme follow setTheme", () => {
  const seen: string[] = [];
  createRoot(() => createEffect(() => seen.push(`${colorScheme()} ${theme.accent.base}`)));
  setTheme("dark");
  setTheme({ ...darkTheme, accent: { ...darkTheme.accent, base: "#ff0000" } });
  expect(seen).toEqual([`light ${lightTheme.accent.base}`, `dark ${darkTheme.accent.base}`, "dark #ff0000"]);
});

test("assigning a theme value also updates what uses it", () => {
  const { root } = mount(() => <Divider />);
  theme.divider = "#123456";
  expect(root.children[0]!.style.background).toBe("#123456");
  expect(lightTheme.divider).not.toBe("#123456"); // the presets stay as they were
});

test("controls built from theme colors and Canvas drawings follow the theme", () => {
  const [on, setOn] = createSignal(false);
  const { root } = mount(() => (
    <Column align="start">
      <Checkbox checked={on} onChange={setOn} />
      <Select value={() => undefined} onChange={() => {}} options={[{ value: 1, label: "um" }]} />
      <Canvas width={10} height={10} draw={(g) => g.rect(0, 0, 10, 10, theme.text.secondary)} />
    </Column>
  ));
  const [checkbox, select, canvas] = root.children[0]!.children;
  setTheme("dark");
  expect(checkbox!.children[0]!.style.background).toBe(darkTheme.field.background);
  expect(select!.style.background).toBe(darkTheme.field.background);
  expect(commandsOf(canvas!, "rect")[0]!.color).toEqual(rgba(darkTheme.text.secondary));
  expect(drawCommands(root).length).toBeGreaterThan(0);
});

test("an open Dialog follows a theme switch: backdrop and card", () => {
  const { root, relayout } = mount(() => <Dialog open={() => true} onClose={() => {}} title="Oi" />);
  relayout();
  setTheme("dark");
  const layer = root.layers[0]!;
  expect(layer.style.background).toBe(darkTheme.backdrop);
  expect(layer.children[0]!.style.background).toBe(darkTheme.card.background);
});
