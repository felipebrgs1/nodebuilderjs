import { afterEach, expect, test } from "bun:test";
import { colorScheme, setTheme } from "@nodebuilderjs/core";
import { findAll, findByText, interact, mount } from "@nodebuilderjs/core/testing";
import { App } from "../src/App.js";

// Tests run without a window. interact() delivers mouse and keyboard like the real app.

afterEach(() => setTheme("light"));

function setup() {
  const app = mount(() => <App />, { width: 800, height: 900 });
  const ui = interact(app.root);
  const click = (text: string) => {
    const target = findByText(app.root, text)!;
    ui.press(target);
    ui.release(target);
    app.relayout();
  };
  return { ...app, ui, click };
}

test("the button counts clicks", () => {
  const { root, click } = setup();
  expect(findByText(root, "You clicked 0 times")).toBeDefined();
  click("Click me");
  expect(findByText(root, "You clicked 1 time")).toBeDefined();
  click("Reset");
  expect(findByText(root, "You clicked 0 times")).toBeDefined();
});

test("add, complete and clear tasks, confirming in a dialog", () => {
  const { root, ui, relayout, click } = setup();
  expect(findByText(root, "2 pending")).toBeDefined();

  // Type in the field and confirm with Enter; empty text does not become a task.
  ui.press(findAll(root, (n) => n.label === "TextField")[0]!);
  ui.type("Write a test");
  ui.key("Return");
  ui.key("Return");
  relayout();
  expect(findByText(root, "Write a test")).toBeDefined();
  expect(findByText(root, "3 pending")).toBeDefined();

  click("Read the README"); // the task's text also ticks the box
  expect(findByText(root, "2 pending")).toBeDefined();

  click("Clear completed");
  expect(findByText(root, "1 task will be removed.")).toBeDefined();
  click("Clear");
  expect(findByText(root, "Read the README")).toBeUndefined();
  expect(findByText(root, "Clear completed tasks?")).toBeUndefined();
  expect(findByText(root, "2 pending")).toBeDefined();
});

test("the toggle switches to the dark theme", () => {
  const { click } = setup();
  click("Dark");
  expect(colorScheme()).toBe("dark");
});
