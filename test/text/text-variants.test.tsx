// Text variants: `<Text variant="caption">` takes a named set of text styles (size, weight,
// color...) from the theme instead of repeating them; props given on the Text win.
import { afterEach, expect, spyOn, test } from "bun:test";
import { Column, Text, darkTheme, defineTextVariants, lightTheme, setTheme } from "@nodebuilderjs/core";
import { mount } from "@nodebuilderjs/core/testing";
import { parseColor } from "../../src/render/paint.js";
import { drawCommands } from "../helpers.js";

afterEach(() => setTheme("light"));

const rgba = (c: string) => parseColor(c).map((v) => Math.round(v * 1000) / 1000);
type TextCommand = { op: "text"; text: string; size: number; weight: number; color: number[] };
const texts = (root: Parameters<typeof drawCommands>[0]) => drawCommands(root).filter((c): c is TextCommand & typeof c => c.op === "text") as unknown as TextCommand[];

test("built-in variants: muted, caption and title", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Text variant="muted">a</Text>
      <Text variant="caption">b</Text>
      <Text variant="title">c</Text>
      <Text>d</Text>
    </Column>
  ));
  const [muted, caption, title, plain] = texts(root);
  expect([muted!.size, muted!.color]).toEqual([lightTheme.font.size, rgba(lightTheme.text.secondary)]);
  expect([caption!.size, caption!.color]).toEqual([12, rgba(lightTheme.text.secondary)]);
  expect([title!.size, title!.weight]).toEqual([20, 700]);
  expect(plain!.color).toEqual(rgba(lightTheme.text.primary));
});

test("props on the Text win over its variant; the variant's color follows setTheme", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Text variant="caption" fontSize={15}>
        a
      </Text>
      <Text variant="caption" color="#ff0000">
        b
      </Text>
    </Column>
  ));
  const [sized, red] = texts(root);
  expect(sized!.size).toBe(15);
  expect(red!.color).toEqual([1, 0, 0, 1]);
  setTheme("dark");
  expect(texts(root)[0]!.color).toEqual(rgba(darkTheme.text.secondary));
});

test("defineTextVariants adds the app's own and replaces built-ins", () => {
  defineTextVariants({ badge: { fontSize: 11, bold: true, color: "accent.pressed" }, title: { fontSize: 24, fontWeight: 800 } });
  try {
    const { root } = mount(() => (
      <Column align="start">
        <Text variant="badge">a</Text>
        <Text variant="title">b</Text>
      </Column>
    ));
    const [badge, title] = texts(root);
    expect([badge!.size, badge!.weight, badge!.color]).toEqual([11, 700, rgba(lightTheme.accent.pressed)]);
    expect([title!.size, title!.weight]).toEqual([24, 800]);
  } finally {
    defineTextVariants({ title: { fontSize: 20, fontWeight: 700 } });
  }
});

test("an unknown variant warns and draws plain text", () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const { root } = mount(() => (
      <Column align="start">
        <Text variant="nope">a</Text>
      </Column>
    ));
    expect(texts(root)[0]!.size).toBe(lightTheme.font.size);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('"nope"'))).toBe(true);
  } finally {
    warn.mockRestore();
  }
});
