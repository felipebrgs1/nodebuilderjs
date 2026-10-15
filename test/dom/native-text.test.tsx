// With native text (the DOM renderer), the browser edits fields and selects text: widgets keep
// their keys and handlers apart from what the platform does.
import { afterEach, expect, test } from "bun:test";
import { Column, Text, TextArea, TextField, createSignal } from "@nodebuilderjs/core";
import { interact, mount } from "@nodebuilderjs/core/testing";
import { setNativeText } from "../../src/runtime/platform.js";
import { commandsOf } from "../helpers.js";

afterEach(() => setNativeText(false));

function field(multiline = false) {
  const [value, setValue] = createSignal("ab");
  const seen: string[] = [];
  let submitted = 0;
  const { root } = mount(() => (
    <Column onKeyDown={(e) => seen.push(e.key)}>
      {multiline
        ? <TextArea value={value} onInput={setValue} />
        : <TextField value={value} onInput={setValue} onSubmit={() => submitted++} />}
    </Column>
  ));
  const node = root.children[0]!.children[0]!;
  const ui = interact(root);
  ui.press(node);
  return { value, setValue, seen, ui, node, submitted: () => submitted };
}

test("the platform edits: typing, deleting and shortcuts change nothing here, and stop at the field", () => {
  setNativeText(true);
  const f = field();
  f.ui.type("xy");
  f.ui.key("BackSpace");
  f.ui.key("Left");
  f.ui.key("z", { ctrl: true });
  f.ui.key("v", { ctrl: true });
  expect(f.value()).toBe("ab");
  expect(f.seen).toEqual([]);
});

test("the platform edits: Return still submits, and other keys reach the parents", () => {
  setNativeText(true);
  const f = field();
  f.ui.key("Return");
  f.ui.key("s", { ctrl: true });
  f.ui.key("Escape");
  expect(f.submitted()).toBe(1);
  expect(f.seen).toEqual(["s", "Escape"]);
});

test("a platform text input reports what was typed through field.input (the app's onInput)", () => {
  setNativeText(true);
  const f = field();
  f.node.field!.input!("abc");
  expect(f.value()).toBe("abc");
  expect(f.node.field!.secret!()).toBe(false);
});

test("TextArea with the platform editing: Return is a newline the platform types, arrows are its own", () => {
  setNativeText(true);
  const f = field(true);
  f.ui.key("Return");
  f.ui.key("Up");
  f.ui.key("Page_Down");
  expect(f.value()).toBe("ab");
  expect(f.seen).toEqual([]);
  expect(f.node.field!.multiline).toBe(true);
});

test("without native text the field edits itself (the desktop)", () => {
  const f = field();
  f.ui.type("x");
  expect(f.value()).toBe("abx");
});

test("a Text describes its content for a renderer that lays out text itself", () => {
  const { root } = mount(() => <Text maxLines={2} textAlign="center" lineHeight={1.5} selectable>Hello</Text>);
  expect(root.children[0]!.text!()).toEqual({ value: "Hello", wrap: true, maxLines: 2, align: "center", lineHeight: 1.5, selectable: true });
});

test("selectable Text leaves selection and Ctrl+C to the platform", () => {
  setNativeText(true);
  const seen: string[] = [];
  const { root } = mount(() => <Column onKeyDown={(e) => seen.push(e.key)}><Text selectable>Hello world</Text></Column>);
  const text = root.children[0]!.children[0]!;
  const ui = interact(root);
  ui.drag(text, 30, 0);
  // Nothing selected (painted) by the widget, and the copy key is not taken.
  expect(commandsOf(text, "rect")).toEqual([]);
  ui.key("c", { ctrl: true });
  expect(seen).toEqual(["c"]);
});
