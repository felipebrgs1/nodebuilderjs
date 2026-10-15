// `margin`: space outside a node's border that its parent's layout keeps free (CSS order,
// negative values allowed). Not painted and not hit-tested: the node's box stays the border box.
import { expect, test } from "bun:test";
import { Box, Column, Grid, Row, Scroll, Text } from "@nodebuilderjs/core";
import { interact, mount } from "@nodebuilderjs/core/testing";
import { drawCommands } from "../helpers.js";

// Fake metrics (mount): 8 px per character, 20 px line.

const box = (n: { x: number; y: number; width: number; height: number }) => [n.x, n.y, n.width, n.height];

test("margin adds to the parent's natural size and offsets the child", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Row><Box width={50} height={20} margin={10} /></Row>
    </Column>
  ), { width: 400, height: 300 });
  const row = root.children[0]!.children[0]!;
  expect([row.width, row.height]).toEqual([70, 40]);
  expect(box(row.children[0]!)).toEqual([10, 10, 50, 20]);
});

test("margin follows CSS order: [top, right, bottom, left] and [vertical, horizontal]", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Row><Box width={50} height={20} margin={[1, 2, 3, 4]} /></Row>
      <Row><Box width={50} height={20} margin={[5, 7]} /></Row>
    </Column>
  ), { width: 400, height: 300 });
  const [a, b] = root.children[0]!.children;
  expect([a!.width, a!.height]).toEqual([56, 24]);
  expect([a!.children[0]!.x, a!.children[0]!.y]).toEqual([4, 1]);
  expect([b!.width, b!.height]).toEqual([64, 30]);
  expect([b!.children[0]!.x, b!.children[0]!.y - b!.y]).toEqual([7, 5]);
});

test("margin keeps gap semantics: both add up between siblings", () => {
  const { root } = mount(() => (
    <Column gap={8} align="start">
      <Box width={10} height={20} margin={[0, 0, 4, 0]} />
      <Box width={10} height={20} margin={[2, 0, 0, 0]} />
    </Column>
  ), { width: 400, height: 300 });
  const [a, b] = root.children[0]!.children;
  expect(a!.y).toBe(0);
  expect(b!.y).toBe(20 + 4 + 8 + 2);
});

test("with grow the box shrinks by its margin", () => {
  const { root } = mount(() => (
    <Row width={200}>
      <Box grow={1} height={10} margin={[0, 10]} />
      <Box width={30} height={10} />
    </Row>
  ), { width: 400, height: 300 });
  const [a, b] = root.children[0]!.children;
  expect(box(a!)).toEqual([10, 0, 150, 10]);
  expect(b!.x).toBe(170);
});

test("a negative margin pulls the next sibling over (and shrinks the parent's natural size)", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Row>
        <Box width={50} height={20} />
        <Box width={50} height={20} margin={[0, 0, 0, -20]} />
      </Row>
    </Column>
  ), { width: 400, height: 300 });
  const row = root.children[0]!.children[0]!;
  expect(row.children[1]!.x).toBe(30);
  expect(row.width).toBe(80);
});

test("align stretch subtracts the cross margins; center and end count them", () => {
  const { root } = mount(() => (
    <Column width={200} gap={0}>
      <Box height={10} margin={[0, 10]} />
      <Box height={10} width={50} margin={[0, 10, 0, 0]} alignSelf="end" />
      <Box height={10} width={50} margin={[0, 0, 0, 20]} alignSelf="center" />
      <Row height={100}>
        <Box width={10} margin={[5, 0, 15, 0]} />
      </Row>
    </Column>
  ), { width: 400, height: 300 });
  const [stretched, end, center, row] = root.children[0]!.children;
  expect([stretched!.x, stretched!.width]).toEqual([10, 180]);
  expect(end!.x).toBe(140);
  expect(center!.x).toBe(20 + (200 - 70) / 2);
  expect([row!.children[0]!.y - row!.y, row!.children[0]!.height]).toEqual([5, 80]);
});

test("wrapping text wraps inside its margins", () => {
  const { root } = mount(() => (
    <Column width={100} align="stretch">
      <Text margin={[0, 10]}>aaaa bbbb cccc</Text>
      <Box height={5} />
    </Column>
  ), { width: 400, height: 300 });
  const [text, after] = root.children[0]!.children;
  expect([text!.x, text!.width, text!.height]).toEqual([10, 80, 40]); // "aaaa bbbb" fits 80px
  expect(after!.y).toBe(40);
});

test("a row can shrink a child only down to its content plus its margin", () => {
  const { root } = mount(() => (
    <Row width={100}>
      <Column grow={1}><Text margin={[0, 10]}>aaaa bbbb</Text></Column>
      <Box width={80} height={10} />
    </Row>
  ), { width: 400, height: 300 });
  // The column's floor: the longest word (32px) plus 20px of margin.
  expect(root.children[0]!.children[0]!.width).toBe(52);
});

test("absolute children treat margin as an extra offset from the edges they are placed by", () => {
  const { root } = mount(() => (
    <Box width={200} height={100}>
      <Box position="absolute" left={10} top={5} width={20} height={20} margin={3} />
      <Box position="absolute" right={10} bottom={10} width={20} height={20} margin={[0, 4, 6, 0]} />
      <Box position="absolute" left={0} right={0} top={0} height={10} margin={[0, 15]} />
    </Box>
  ), { width: 400, height: 300 });
  const [a, b, c] = root.children[0]!.children;
  expect(box(a!)).toEqual([13, 8, 20, 20]);
  expect(box(b!)).toEqual([200 - 10 - 4 - 20, 100 - 10 - 6 - 20, 20, 20]);
  expect(box(c!)).toEqual([15, 0, 170, 10]);
});

test("Grid cells keep their margins inside the cell; rows grow by them", () => {
  const { root } = mount(() => (
    <Grid columns={2} gap={0} width={200}>
      <Box height={20} margin={5} />
      <Box />
    </Grid>
  ), { width: 400, height: 300 });
  const grid = root.children[0]!;
  const [a, b] = grid.children;
  expect(box(a!)).toEqual([5, 5, 90, 20]);
  expect(box(b!)).toEqual([100, 0, 100, 30]); // stretched to the 30px row
  expect(grid.height).toBe(30);
});

test("a wrapping row breaks lines by the children's outer sizes", () => {
  const { root } = mount(() => (
    <Row wrap gap={0} width={200}>
      {[1, 2, 3].map(() => <Box width={80} height={20} margin={10} />)}
    </Row>
  ), { width: 400, height: 300 });
  const row = root.children[0]!;
  expect(row.children.map(box)).toEqual([[10, 10, 80, 20], [110, 10, 80, 20], [10, 50, 80, 20]]);
  expect(row.height).toBe(80);
});

test("an aspectRatio box keeps its ratio inside its margins", () => {
  const { root } = mount(() => (
    <Column width={220}>
      <Box aspectRatio={2} margin={10} />
      <Box height={5} />
    </Column>
  ), { width: 400, height: 300 });
  const [ratio, after] = root.children[0]!.children;
  expect(box(ratio!)).toEqual([10, 10, 200, 100]);
  expect(after!.y).toBe(120);
});

test("a Scroll's content size includes its children's margins", () => {
  const { root } = mount(() => (
    <Scroll height={50}>
      <Box height={100} margin={[0, 0, 20, 0]} />
    </Scroll>
  ), { width: 200, height: 300 });
  expect(root.children[0]!.contentHeight).toBe(120);
});

test("margins count in overflow warnings", () => {
  const { layoutWarnings } = mount(() => (
    <Column align="start">
      <Box width={100} clip>
        <Row><Box width={90} height={10} margin={[0, 0, 0, 20]} /></Row>
      </Box>
    </Column>
  ), { width: 400, height: 300 });
  expect(layoutWarnings()).toEqual([
    "layout: Row > Box overflows Box by 10px (children need 110px, 100px available)",
  ]);
});

test("the margin is neither painted nor hit", () => {
  let clicks = 0;
  const { root } = mount(() => (
    <Column align="start">
      <Box width={50} height={20} margin={10} background="#ff0000" onClick={() => clicks++} />
    </Column>
  ), { width: 400, height: 300 });
  const rect = drawCommands(root).find((c) => c.op === "rect" && c.color[0] === 1);
  expect(rect).toMatchObject({ x: 10, y: 10, w: 50, h: 20 });
  const ui = interact(root);
  ui.down(5, 5);
  ui.up(5, 5);
  expect(clicks).toBe(0);
  ui.down(15, 15);
  ui.up(15, 15);
  expect(clicks).toBe(1);
});
