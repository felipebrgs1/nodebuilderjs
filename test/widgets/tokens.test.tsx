// Color tokens by name: any color prop takes a theme path ("text.secondary", "accent.base") or a
// name from createThemeTokens ("sidebar", "graph.node") instead of a CSS color. Resolved when
// painting, so they follow setTheme without an accessor (no `() => theme.x`).
import { afterEach, expect, spyOn, test } from "bun:test";
import { Box, Column, Icon, Text, createThemeTokens, darkTheme, lightTheme, mixColor, setTheme } from "@nodebuilderjs/core";
import { mount } from "@nodebuilderjs/core/testing";
import { setImageBackend } from "../../src/image/source.js";
import { parseColor } from "../../src/render/paint.js";
import { commandsOf, drawCommands } from "../helpers.js";

afterEach(() => setTheme("light"));

const rgba = (c: string) => parseColor(c).map((v) => Math.round(v * 1000) / 1000);
const rects = (root: Parameters<typeof drawCommands>[0]) => drawCommands(root).filter((c) => c.op === "rect").map((c) => (c as { color: number[] }).color);

test("a theme path is a color: painted with the current theme's value, and follows setTheme", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Box width={10} height={10} background="accent.base" />
      <Box width={10} height={10} background="window.background" borderWidth={1} borderColor="divider" />
    </Column>
  ));
  expect(rects(root)).toEqual([rgba(lightTheme.accent.base), rgba(lightTheme.window.background)]);
  setTheme("dark");
  expect(rects(root)).toEqual([rgba(darkTheme.accent.base), rgba(darkTheme.window.background)]);
  const border = drawCommands(root).filter((c) => c.op === "rect")[1] as { borderColor: number[] };
  expect(border.borderColor).toEqual(rgba(darkTheme.divider));
});

test("createThemeTokens names work in props too, nested with dots, and win over a theme path", () => {
  createThemeTokens({
    light: { sidebar: "#f3f3f3", graph: { node: "#112233" }, card: "#abcdef" },
    dark: { sidebar: "#202020", graph: { node: "#445566" }, card: "#123456" },
  });
  const { root } = mount(() => (
    <Column align="start">
      <Box width={10} height={10} background="sidebar" />
      <Box width={10} height={10} background="graph.node" />
      <Box width={10} height={10} background="card" />
    </Column>
  ));
  expect(rects(root)).toEqual([rgba("#f3f3f3"), rgba("#112233"), rgba("#abcdef")]);
  setTheme("dark");
  expect(rects(root)).toEqual([rgba("#202020"), rgba("#445566"), rgba("#123456")]);
});

test("a token may name another token; CSS colors are never looked up as tokens", () => {
  createThemeTokens({ light: { link: "accent.base", white: "#ff0000" }, dark: { link: "accent.pressed", white: "#ff0000" } });
  expect(rgba("link")).toEqual(rgba(lightTheme.accent.base));
  setTheme("dark");
  expect(rgba("link")).toEqual(rgba(darkTheme.accent.pressed));
  expect(rgba("white")).toEqual([1, 1, 1, 1]);
  expect(rgba("#ff0000")).toEqual([1, 0, 0, 1]);
});

test("text color: inherited token from a container, and Text's own", () => {
  const { root } = mount(() => (
    <Column align="start" color="text.secondary">
      <Text>muted</Text>
      <Text color="danger.base">error</Text>
    </Column>
  ));
  const colors = drawCommands(root).filter((c) => c.op === "text").map((c) => (c as { color: number[] }).color);
  expect(colors).toEqual([rgba(lightTheme.text.secondary), rgba(lightTheme.danger.base)]);
});

test("an unknown name paints magenta and warns once", () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(rgba("no.such.token")).toEqual([1, 0, 1, 1]);
    rgba("no.such.token");
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("no.such.token"))).toHaveLength(1);
  } finally {
    warn.mockRestore();
  }
});

test("mixColor and gradient stops take tokens", () => {
  expect(mixColor("accent.base", "accent.base", 0.5)).toBe(`${lightTheme.accent.base}ff`);
  const { root } = mount(() => (
    <Column align="start">
      <Box width={10} height={10} background={{ linear: ["accent.base", "transparent"] }} />
    </Column>
  ));
  const gradient = drawCommands(root).find((c) => c.op === "gradient") as { stops: { color: number[] }[] };
  expect(gradient.stops[0]!.color).toEqual(rgba(lightTheme.accent.base));
});

test("a multicolor icon whose color is a token is rasterized again when the theme switches", () => {
  let created = 0;
  setImageBackend({ create: () => ++created, destroy: () => {} });
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="currentColor"/><rect width="5" height="5" fill="#00ff00"/></svg>';
    const { root } = mount(() => (
      <Column align="start">
        <Icon svg={svg} size={10} color="accent.pressed" />
      </Column>
    ));
    commandsOf(root, "image");
    expect(created).toBe(1);
    setTheme("dark"); // accent.pressed differs between the presets
    commandsOf(root, "image");
    expect(created).toBe(2);
  } finally {
    setImageBackend(null);
  }
});
