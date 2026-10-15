import { expect, test } from "bun:test";
import {
  Button, Checkbox, Column, ProgressBar, RadioGroup, Row, Slider, Spinner, TextField, Toggle, createSignal, theme,
} from "@nodebuilderjs/core";
import { findByText, findAll, interact, mount } from "@nodebuilderjs/core/testing";
import { commandsOf, drawCommands } from "../helpers.js";

// ---- disabled ----------------------------------------------------------------

test("disabled controls do nothing, leave the Tab order and look dimmed", () => {
  const [on, setOn] = createSignal(false);
  const [text, setText] = createSignal("");
  let clicks = 0;
  const { root } = mount(() => (
    <Column align="start">
      <Button label="Salvar" disabled onClick={() => clicks++} />
      <Checkbox label="Ativo" disabled checked={on} onChange={setOn} />
      <TextField disabled value={text} onInput={setText} />
      <Button label="Outro" />
    </Column>
  ));
  const [button, checkbox, field] = root.children[0]!.children;
  const ui = interact(root);
  ui.press(button!);
  ui.release(button!);
  ui.press(checkbox!);
  ui.release(checkbox!);
  ui.press(field!);
  ui.type("x");
  expect([clicks, on(), text()]).toEqual([0, false, ""]);
  ui.key("Tab");
  expect(ui.focused?.children[0]?.label).toBe('Text "Outro"');
  for (const n of [button!, checkbox!, field!]) {
    expect(n.style.opacity).toBe(theme.disabledOpacity);
    expect(n.style.cursor).toBe("default");
  }
});

test("a control that becomes disabled while focused loses the focus; enabled again, it works", () => {
  const [disabled, setDisabled] = createSignal(false);
  let clicks = 0;
  const { root } = mount(() => (
    <Column align="start">
      <Button label="Salvar" disabled={disabled} onClick={() => clicks++} />
    </Column>
  ));
  const button = root.children[0]!.children[0]!;
  const ui = interact(root);
  ui.key("Tab");
  expect(ui.focused).toBe(button);
  setDisabled(true);
  expect(ui.focused).toBeNull();
  setDisabled(false);
  ui.press(button);
  ui.release(button);
  expect(clicks).toBe(1);
  expect(button.style.opacity).toBe(1);
});

// ---- Toggle ------------------------------------------------------------------

test("Toggle flips on click and on Space, and draws the thumb on the side of its state", () => {
  const [on, setOn] = createSignal(false);
  const { root } = mount(() => (
    <Column align="start">
      <Toggle checked={on} onChange={setOn} label="Wi-Fi" />
    </Column>
  ));
  const toggle = root.children[0]!.children[0]!;
  const ui = interact(root);
  const thumbX = () => commandsOf(toggle, "rect").find((r) => r.color.join() === "1,1,1,1")!.x - toggle.x;
  expect(thumbX()).toBe(2);
  ui.press(findByText(root, "Wi-Fi")!);
  ui.release(findByText(root, "Wi-Fi")!);
  expect(on()).toBe(true);
  expect(thumbX()).toBe(18);
  ui.key("space");
  expect(on()).toBe(false);
});

// ---- RadioGroup --------------------------------------------------------------

const SIZES = [
  { value: "p", label: "Pequeno" },
  { value: "m", label: "Médio" },
  { value: "g", label: "Grande", disabled: true },
];

test("RadioGroup selects on click; one Tab stop, the arrows move the choice and skip disabled options", () => {
  const [size, setSize] = createSignal("p");
  const { root } = mount(() => (
    <Column align="start">
      <Button label="antes" />
      <RadioGroup value={size} onChange={setSize} options={SIZES} />
      <Button label="depois" />
    </Column>
  ));
  const ui = interact(root);
  ui.press(findByText(root, "Médio")!);
  ui.release(findByText(root, "Médio")!);
  expect(size()).toBe("m");
  ui.press(findByText(root, "Grande")!);
  ui.release(findByText(root, "Grande")!);
  expect(size()).toBe("m");

  ui.press(findByText(root, "antes")!);
  ui.key("Tab");
  expect(ui.focused?.children.at(-1)?.label).toBe('Text "Médio"'); // the selected option
  ui.key("Down"); // "Grande" is disabled: wraps to "Pequeno"
  expect(size()).toBe("p");
  expect(ui.focused?.children.at(-1)?.label).toBe('Text "Pequeno"');
  ui.key("Up");
  expect(size()).toBe("m");
  ui.key("Tab");
  expect(ui.focused?.children[0]?.label).toBe('Text "depois"');
});

// ---- Slider ------------------------------------------------------------------

test("Slider: a press on the track jumps there, dragging follows the pointer in steps", () => {
  const [v, setV] = createSignal(0);
  const { root } = mount(() => (
    <Column align="start">
      <Slider width={216} value={v} onChange={setV} min={0} max={100} step={10} />
    </Column>
  ));
  const slider = root.children[0]!.children[0]!;
  const ui = interact(root);
  // The thumb's center travels from x = 8 to x = 208 (200 px for 0..100).
  ui.down(slider.x + 8 + 100, slider.y + 10);
  expect(v()).toBe(50);
  ui.move(slider.x + 8 + 163, slider.y + 10);
  expect(v()).toBe(80);
  ui.move(slider.x + 500, slider.y + 40); // past the end, outside: still captured
  expect(v()).toBe(100);
  ui.up(slider.x + 500, slider.y + 40);
});

test("Slider keys: arrows by a step, PageUp/PageDown by a tenth, Home/End to the ends; they do not scroll", () => {
  const [v, setV] = createSignal(50);
  const { root } = mount(() => (
    <Column align="start">
      <Slider value={v} onChange={setV} min={0} max={200} step={5} />
    </Column>
  ));
  const ui = interact(root);
  ui.key("Tab");
  ui.key("Right");
  expect(v()).toBe(55);
  ui.key("Left");
  ui.key("Down");
  expect(v()).toBe(45);
  ui.key("Prior");
  expect(v()).toBe(65);
  ui.key("End");
  expect(v()).toBe(200);
  ui.key("Up");
  expect(v()).toBe(200);
  ui.key("Home");
  expect(v()).toBe(0);
});

test("Slider draws the filled part up to the value", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Slider width={216} value={() => 25} onChange={() => {}} />
    </Column>
  ));
  const slider = root.children[0]!.children[0]!;
  const fill = commandsOf(slider, "rect").find((r) => r.color.join() === "0.208,0.518,0.894,1")!;
  expect([fill.x - slider.x, fill.w]).toEqual([8, 50]);
});

// ---- ProgressBar and Spinner -------------------------------------------------

test("ProgressBar fills its share of the width; without a value it is indeterminate", () => {
  const [p, setP] = createSignal(0.3);
  const { root } = mount(() => (
    <Column width={200}>
      <ProgressBar value={p} />
      <ProgressBar />
    </Column>
  ));
  const [bar, busy] = root.children[0]!.children;
  const fill = () => commandsOf(bar!, "rect")[1]!;
  expect([bar!.height, fill().w]).toEqual([6, 60]);
  setP(2); // clamped
  expect(fill().w).toBe(200);
  expect(commandsOf(busy!, "rect")).toHaveLength(2); // track and a moving segment
});

test("Spinner draws a ring and an arc", () => {
  const { root } = mount(() => (
    <Row>
      <Spinner size={24} />
    </Row>
  ));
  const spinner = root.children[0]!.children[0]!;
  expect([spinner.width, spinner.height]).toEqual([24, 24]);
  expect(drawCommands(spinner).filter((c) => c.op === "arc")).toHaveLength(2);
});

test("disabled Slider and Toggle ignore the pointer", () => {
  const [v, setV] = createSignal(0);
  const [on, setOn] = createSignal(false);
  const { root } = mount(() => (
    <Column align="start">
      <Slider width={216} value={v} onChange={setV} disabled />
      <Toggle checked={on} onChange={setOn} disabled />
    </Column>
  ));
  const [slider, toggle] = root.children[0]!.children;
  const ui = interact(root);
  ui.down(slider!.x + 150, slider!.y + 10);
  ui.move(slider!.x + 200, slider!.y + 10);
  ui.up(slider!.x + 200, slider!.y + 10);
  ui.press(toggle!);
  ui.release(toggle!);
  expect([v(), on()]).toEqual([0, false]);
});

test("Button variant is reactive: background, text weight and hover colors follow it", () => {
  const [variant, setVariant] = createSignal<"default" | "primary">("default");
  const { root } = mount(() => (
    <Column align="start">
      <Button label="Send" variant={variant} />
    </Column>
  ));
  const button = root.children[0]!.children[0]!;
  const text = () => commandsOf(button, "text")[0]!;
  expect(button.style.background).toBe(theme.control.base);
  expect(text().bold).toBe(false);
  setVariant("primary");
  expect(button.style.background).toBe(theme.accent.base);
  expect(button.style.color).toBe(theme.accent.text);
  expect(text().bold).toBe(true);
  interact(root).hover(button);
  expect(button.style.background).toBe(theme.accent.hover);
});

test("ProgressBar and Slider take color (the filled part) and background (the track) from the app", () => {
  const [v, setV] = createSignal(50);
  const { root } = mount(() => (
    <Column align="start">
      <ProgressBar value={0.5} color="#ff0000" background="#0000ff" width={100} />
      <Slider value={v} onChange={setV} color="#00ff00" background="#000000" />
    </Column>
  ));
  const [bar, slider] = root.children[0]!.children;
  const colors = (n: typeof bar) => commandsOf(n!, "rect").map((r) => r.color.join(","));
  expect(colors(bar)).toEqual(["0,0,1,1", "1,0,0,1"]); // the track (rounded), then the fill
  expect(commandsOf(bar!, "rect")[0]!.radius).toBe(3);
  expect(colors(slider).slice(0, 2)).toEqual(["0,0,0,1", "0,1,0,1"]);
});

test("RadioGroup: the dot stays centred in its circle, with or without the focus border", () => {
  const [value, setValue] = createSignal("a");
  const { root, relayout } = mount(() => <RadioGroup value={value} onChange={setValue} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />);
  const ui = interact(root);
  const dotOffset = () => {
    relayout();
    const circle = findAll(root, (n) => n.label === "RadioCircle")[0]!;
    const dot = circle.children[0]!;
    return [dot.x - circle.x, dot.y - circle.y];
  };
  expect(dotOffset()).toEqual([5, 5]);
  ui.key("Tab"); // focused: a 2 px border
  expect(findAll(root, (n) => n.label === "RadioCircle")[0]!.style.borderWidth).toBe(2);
  expect(dotOffset()).toEqual([5, 5]);
});
