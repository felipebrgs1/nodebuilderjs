// On the web the page is the window: the browser's tab shows the title and closes it.
import { afterEach, expect, test } from "bun:test";
import { Row, Text, Window, WindowControls, debugTree } from "@nodebuilderjs/core";
import { mount } from "@nodebuilderjs/core/testing";
import { setWindowFrame } from "../../src/runtime/app.js";

afterEach(() => setWindowFrame(true));

test("without a window frame, <Window> has no title bar, divider, border or corners", () => {
  setWindowFrame(false);
  const { root } = mount(() => <Window title="t"><Text>body</Text></Window>, { width: 300, height: 200 });
  const tree = debugTree(root);
  expect(tree).not.toContain("Titlebar");
  expect(tree).not.toContain("Divider");
  const window = root.children[0]!;
  expect([window.style.borderWidth ?? 0, window.style.padding ?? 0, window.style.radius ?? 0]).toEqual([0, 0, 0]);
  // The content fills the page from its corner.
  const text = window.children[0]!.children[0]!;
  expect([text.x, text.y]).toEqual([0, 0]);
});

test("without a window frame, <WindowControls /> in a custom title bar draws no buttons", () => {
  setWindowFrame(false);
  const { root } = mount(() => (
    <Window title="t" decorations={false}>
      <Row dragRegion><Text>App</Text><WindowControls /></Row>
    </Window>
  ));
  expect(debugTree(root)).not.toContain("WindowButton");
  expect(debugTree(root)).toContain('Text "App"');
});

test("with a frame (the desktop), the title bar and its buttons are there", () => {
  const { root } = mount(() => <Window title="t"><Text>body</Text></Window>);
  expect(debugTree(root)).toContain("Titlebar");
  expect(debugTree(root)).toContain("WindowButton(close)");
});
