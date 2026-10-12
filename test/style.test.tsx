import { expect, test } from "bun:test";
import { Box, Column, Row, Text, createSignal } from "@nodebuilderjs/core";
import { interact, mount } from "@nodebuilderjs/core/testing";
import { commandsOf, drawCommands } from "./helpers.js";

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

test("an absolute child is painted and hit in child order: declared last, it is on top of its siblings", () => {
  const log: string[] = [];
  const { root } = mount(() => (
    <Column align="start">
      <Box width={100} height={100}>
        <Box position="absolute" left={0} top={0} width={50} height={50} background="#ff0000" onClick={() => log.push("first")} />
        <Box height={50} background="#00ff00" onClick={() => log.push("in flow")} />
        <Box position="absolute" left={60} top={0} width={30} height={30} background="#0000ff" onClick={() => log.push("last")} />
        <Box position="absolute" left={120} top={0} width={30} height={30} onClick={() => log.push("outside")} />
      </Box>
    </Column>
  ));
  expect(commandsOf(root, "rect").map((r) => r.color.join())).toEqual(["1,0,0,1", "0,1,0,1", "0,0,1,1"]);
  const ui = interact(root);
  for (const [x, y] of [[10, 10], [70, 10], [130, 10]] as const) (ui.down(x, y), ui.up(x, y));
  // The in-flow box covers the first one; the one outside its parent's box is drawn but not hit.
  expect(log).toEqual(["in flow", "last"]);
});

test("clip with radius clips children to the rounded inside of the border", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Box clip radius={12} borderWidth={2} borderColor="#000000" width={100} height={60}>
        <Box height={60} background="#ff0000" />
      </Box>
    </Column>
  ));
  expect(commandsOf(root, "clip")).toEqual([{ op: "clip", x: 2, y: 2, w: 96, h: 56, radius: 10 }]);
});

test("a shadow is drawn even without a background: the node's rounded box, blurred and offset by y", () => {
  const { root } = mount(() => (
    <Column align="start" padding={20}>
      <Box width={100} height={40} radius={8} shadow={{ color: "#00000080", blur: 12, y: 4 }} />
    </Column>
  ));
  const ops = drawCommands(root);
  expect(ops.map((c) => c.op)).toEqual(["shadow"]);
  expect(ops[0]).toMatchObject({ x: 20, y: 24, w: 100, h: 40, radius: 8, blur: 12 });
});
