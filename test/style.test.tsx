import { expect, test } from "bun:test";
import { Box, Column, Row, Text, createSignal } from "@nodebuilderjs/core";
import { interact, mount } from "@nodebuilderjs/core/testing";
import { commandsOf } from "./helpers.js";

test("opacity multiplies the alpha of everything the subtree draws, nesting included", () => {
  const { root } = mount(() => (
    <Column>
      <Box opacity={0.5} background="#ff0000" borderWidth={1} borderColor="#00ff00">
        <Text color="#000000">a</Text>
        <Box opacity={0.5} background="#0000ff" height={10} />
      </Box>
      <Box background="#ff0000" height={10} />
    </Column>
  ));
  const rects = commandsOf(root, "rect");
  expect(rects.map((r) => r.color[3])).toEqual([0.5, 0.25, 1]);
  expect(rects[0]!.borderColor[3]).toBe(0.5);
  expect(commandsOf(root, "text")[0]!.color[3]).toBe(0.5);
});

test("opacity follows a signal; 0 draws nothing", () => {
  const [o, setO] = createSignal(1);
  const { root } = mount(() => <Box opacity={o} background="#ff0000" height={10} />);
  expect(commandsOf(root, "rect")[0]!.color[3]).toBe(1);
  setO(0);
  expect(commandsOf(root, "rect")).toEqual([]);
});

test("translate moves a node and its children after layout, without moving its siblings", () => {
  const { root } = mount(() => (
    <Row align="start" gap={10}>
      <Box width={50} height={20} translateX={5} translateY={7}>
        <Box width={10} height={10} />
      </Box>
      <Box width={50} height={20} />
    </Row>
  ));
  const [moved, sibling] = root.children[0]!.children;
  expect([moved!.x, moved!.y]).toEqual([5, 7]);
  expect([moved!.children[0]!.x, moved!.children[0]!.y]).toEqual([5, 7]);
  expect([sibling!.x, sibling!.y]).toEqual([60, 0]);
});

test("the pointer finds a translated node where it is drawn", () => {
  const log: string[] = [];
  const { root } = mount(() => (
    <Column align="start">
      <Box width={50} height={20} translateX={100} onPointerEnter={() => log.push("enter")} />
    </Column>
  ));
  const ui = interact(root);
  ui.move(10, 10); // where it would be without translate
  expect(log).toEqual([]);
  ui.move(120, 10);
  expect(log).toEqual(["enter"]);
});
