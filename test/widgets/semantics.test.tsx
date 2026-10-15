// What widgets are to assistive technology: a role and states on their nodes, platform neutral
// (the DOM renderer writes them as ARIA; a desktop accessibility bridge would read the same).
import { expect, test } from "bun:test";
import {
  Button, Checkbox, Column, Dialog, ProgressBar, RadioGroup, Select, Slider, Spinner, Tabs, Toggle, createSignal,
} from "@nodebuilderjs/core";
import type { UINode } from "@nodebuilderjs/core";
import { findAll, findByText, interact, mount } from "@nodebuilderjs/core/testing";

const byRole = (root: UINode, role: string) => findAll(root, (n) => n.role === role);
const states = (n: UINode | undefined) => n?.states?.() ?? {};

test("Button: a button, disabled when it is", () => {
  const [off, setOff] = createSignal(false);
  const { root } = mount(() => <Button label="Go" disabled={off} onClick={() => {}} />);
  const [button] = byRole(root, "button");
  expect(button).toBeDefined();
  expect(button!.disabled).toBe(false);
  setOff(true);
  expect(button!.disabled).toBe(true);
});

test("Checkbox and Toggle: checked follows the value", () => {
  const [on, setOn] = createSignal(false);
  const { root } = mount(() => (
    <Column>
      <Checkbox checked={on} onChange={setOn} label="A" />
      <Toggle checked={on} onChange={setOn} label="B" />
    </Column>
  ));
  const [checkbox] = byRole(root, "checkbox");
  const [toggle] = byRole(root, "switch");
  expect([states(checkbox).checked, states(toggle).checked]).toEqual([false, false]);
  setOn(true);
  expect([states(checkbox).checked, states(toggle).checked]).toEqual([true, true]);
});

test("RadioGroup: a radiogroup of radios, the chosen one checked", () => {
  const [v, setV] = createSignal("b");
  const { root } = mount(() => <RadioGroup value={v} onChange={setV} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />);
  expect(byRole(root, "radiogroup")).toHaveLength(1);
  expect(byRole(root, "radio").map((r) => states(r).checked)).toEqual([false, true]);
});

test("Slider and ProgressBar: their value and range; a Spinner is a progressbar without one", () => {
  const [v, setV] = createSignal(30);
  const { root } = mount(() => (
    <Column>
      <Slider value={v} onChange={setV} min={10} max={50} />
      <ProgressBar value={0.25} />
      <Spinner />
    </Column>
  ));
  expect(states(byRole(root, "slider")[0])).toEqual({ value: 30, min: 10, max: 50 });
  const [bar, spinner] = byRole(root, "progressbar");
  expect(states(bar)).toEqual({ value: 25, min: 0, max: 100 });
  expect(states(spinner)).toEqual({});
});

test("Tabs: a tablist of tabs, the current one selected", () => {
  const [v, setV] = createSignal(1);
  const { root } = mount(() => <Tabs value={v} onChange={setV} tabs={[{ value: 1, label: "One" }, { value: 2, label: "Two" }]} />);
  expect(byRole(root, "tablist")).toHaveLength(1);
  expect(byRole(root, "tab").map((t) => states(t).selected)).toEqual([true, false]);
});

test("Select: a combobox, expanded while its listbox of options is open", () => {
  const [v, setV] = createSignal("b");
  const { root, relayout } = mount(() => <Select value={v} onChange={setV} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />);
  const [combo] = byRole(root, "combobox");
  expect(states(combo).expanded).toBe(false);
  interact(root).click(combo!);
  relayout();
  expect(states(combo).expanded).toBe(true);
  const listbox = root.layers.flatMap((l) => byRole(l, "listbox"));
  expect(listbox).toHaveLength(1);
  expect(byRole(listbox[0]!, "option").map((o) => states(o).selected)).toEqual([false, true]);
});

test("Dialog: its layer is a modal dialog", () => {
  const { root, relayout } = mount(() => <Dialog open={() => true} onClose={() => {}} title="Hi">body</Dialog>);
  relayout();
  const dialogs = root.layers.filter((l) => l.role === "dialog");
  expect(dialogs).toHaveLength(1);
  expect(states(dialogs[0])).toEqual({ modal: true });
  expect(findByText(dialogs[0]!, "Hi")).toBeDefined();
});
