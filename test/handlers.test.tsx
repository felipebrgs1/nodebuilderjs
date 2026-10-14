// Event handlers on every widget: they typecheck, and they are chained with the widget's own
// handlers (hover colors, keys), never replacing them.
import { expect, test } from "bun:test";
import {
  Button, Card, Checkbox, Column, Icon, Image, ProgressBar, RadioGroup, Select, Slider, Spinner, Tabs, Text, TextField, Toggle, Tooltip,
  Window, WindowControls, createSignal, theme,
} from "@nodebuilderjs/core";
import { findByText, interact, mount } from "@nodebuilderjs/core/testing";

test("pointer and key handlers typecheck on every widget", () => {
  const log: string[] = [];
  const on = (name: string) => ({
    onPointerEnter: () => log.push(`${name} enter`),
    onPointerLeave: () => {},
    onPointerDown: () => {},
    onKeyDown: () => {},
    onFocus: () => {},
  });
  const [n, setN] = createSignal(0);
  const [b, setB] = createSignal(false);
  const [s, setS] = createSignal("");
  const svg = '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';
  mount(() => (
    <Window title="t" {...on("window")}>
      <Button label="b" {...on("button")} />
      <Card {...on("card")} />
      <Checkbox checked={b} onChange={setB} {...on("checkbox")} />
      <Toggle checked={b} onChange={setB} {...on("toggle")} />
      <RadioGroup value={n} onChange={setN} options={[{ value: 0, label: "a" }]} {...on("radio")} />
      <Tabs value={n} onChange={setN} tabs={[{ value: 0, label: "a" }]} {...on("tabs")} />
      <Select value={n} onChange={setN} options={[{ value: 0, label: "a" }]} {...on("select")} />
      <Slider value={n} onChange={setN} {...on("slider")} />
      <ProgressBar value={0.5} {...on("progress")} />
      <Spinner {...on("spinner")} />
      <TextField value={s} onInput={setS} {...on("field")} />
      <Tooltip text="tip" {...on("tooltip")}><Text>t</Text></Tooltip>
      <Icon svg={svg} {...on("icon")} />
      <Image src="none.png" width={1} height={1} {...on("image")} />
      <WindowControls {...on("controls")} />
    </Window>
  ));
  expect(log).toEqual([]);
});

test("onPointerEnter on a Button runs on hover, and the Button's own hover color still applies", () => {
  const log: string[] = [];
  const { root } = mount(() => (
    <Column align="start">
      <Button label="Save" onPointerEnter={() => log.push("enter")} onPointerLeave={() => log.push("leave")} />
    </Column>
  ));
  const button = root.children[0]!.children[0]!;
  const ui = interact(root);
  expect(button.style.background).toBe(theme.control.base);
  ui.hover(button);
  expect(log).toEqual(["enter"]);
  expect(button.style.background).toBe(theme.control.hover);
  ui.move(700, 500);
  expect(log).toEqual(["enter", "leave"]);
});

test("a Button's onClick runs once per click, and not when disabled", () => {
  let clicks = 0;
  const [disabled, setDisabled] = createSignal(false);
  const { root } = mount(() => (
    <Column align="start">
      <Button label="Go" disabled={disabled} onClick={() => clicks++} />
    </Column>
  ));
  const ui = interact(root);
  const label = findByText(root, "Go")!;
  ui.press(label);
  ui.release(label);
  expect(clicks).toBe(1);
  setDisabled(true);
  ui.press(label);
  ui.release(label);
  expect(clicks).toBe(1);
});

test("the app's onKeyDown on a control runs first; stop() takes the key from the control", () => {
  const [checked, setChecked] = createSignal(false);
  const seen: string[] = [];
  const { root } = mount(() => (
    <Column align="start">
      <Checkbox
        label="Agree"
        checked={checked}
        onChange={setChecked}
        onKeyDown={(e) => {
          seen.push(e.key);
          if (e.key === "Return") e.stop();
        }}
      />
    </Column>
  ));
  const ui = interact(root);
  ui.key("Tab");
  ui.key("Return"); // taken by the app
  expect(checked()).toBe(false);
  ui.key("space");
  expect(checked()).toBe(true);
  expect(seen).toEqual(["Return", "space"]);
});
