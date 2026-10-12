// `wrap` on Row/Column: children that do not fit start a new line (chips and tags).
import { expect, test } from "bun:test";
import { Box, Column, Row, Scroll, Text, createSignal } from "@nodebuilderjs/core";
import { mount } from "@nodebuilderjs/core/testing";

// Fake metrics (mount): 8 px per character, 20 px line.

const box = (n: { x: number; y: number; width: number; height: number }) => [n.x, n.y, n.width, n.height];
const chips = (n: number, width = 80, height = 20) => Array.from({ length: n }, () => <Box width={width} height={height} />);

test("wrap: 5 chips of 80px in 300px with gap 8 put 3 on the first line and 2 on the second", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Row wrap gap={8} width={300}>{chips(5)}</Row>
    </Column>
  ), { width: 400, height: 300 });
  const row = root.children[0]!.children[0]!;
  expect(row.children.map(box)).toEqual([
    [0, 0, 80, 20], [88, 0, 80, 20], [176, 0, 80, 20],
    [0, 28, 80, 20], [88, 28, 80, 20],
  ]);
  expect(row.height).toBe(48);
});

test("wrap: rowGap separates lines, gap separates items; padding is respected", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Row wrap gap={8} rowGap={2} padding={10} width={200}>{chips(3)}</Row>
    </Column>
  ), { width: 400, height: 300 });
  const row = root.children[0]!.children[0]!;
  expect(row.children.map(box)).toEqual([[10, 10, 80, 20], [98, 10, 80, 20], [10, 32, 80, 20]]);
  expect(row.height).toBe(10 + 20 + 2 + 20 + 10);
});

test("wrap: grow stretches only within its line", () => {
  const { root } = mount(() => (
    <Row wrap gap={0} width={200}>
      <Box width={80} height={20} />
      <Box width={80} height={20} grow={1} />
      <Box width={80} height={20} />
      <Box width={30} height={20} grow={1} />
    </Row>
  ), { width: 400, height: 300 });
  const [a, b, c, d] = root.children[0]!.children;
  expect(box(a!)).toEqual([0, 0, 80, 20]);
  expect(box(b!)).toEqual([80, 0, 120, 20]); // the line's 40px free
  expect(box(c!)).toEqual([0, 20, 80, 20]);
  expect(box(d!)).toEqual([80, 20, 120, 20]); // its own line's 90px free
});

test("wrap: justify center and end per line; space-between spreads each line", () => {
  const layoutWith = (justify: "center" | "end" | "space-between") => {
    const { root } = mount(() => (
      <Row wrap gap={10} width={200} justify={justify}>{chips(4, 60)}</Row>
    ), { width: 400, height: 300 });
    return root.children[0]!.children.map((c) => [c.x, c.y]);
  };
  // Line 1: three 60px chips + 2 gaps = 200px (full); line 2 (rowGap = gap): one chip.
  expect(layoutWith("center")).toEqual([[0, 0], [70, 0], [140, 0], [70, 30]]);
  expect(layoutWith("end")).toEqual([[0, 0], [70, 0], [140, 0], [140, 30]]);
  expect(layoutWith("space-between")).toEqual([[0, 0], [70, 0], [140, 0], [0, 30]]);
});

test("wrap: lines are as tall as their tallest item; items stretch to their line or follow alignSelf", () => {
  const { root } = mount(() => (
    <Row wrap gap={0} width={200}>
      <Box width={100} height={30} />
      <Box width={100} />
      <Box width={100} height={10} />
      <Box width={50} height={40} />
      <Box width={50} height={10} alignSelf="end" />
    </Row>
  ), { width: 400, height: 300 });
  const kids = root.children[0]!.children.map(box);
  expect(kids).toEqual([
    [0, 0, 100, 30], [100, 0, 100, 30], // no height: stretched to the 30px line
    [0, 30, 100, 10], [100, 30, 50, 40], [150, 60, 50, 10],
  ]);
});

test("wrap: inside a Column the Row's height is the sum of its lines, and the next sibling follows", () => {
  const { root } = mount(() => (
    <Column gap={0}>
      <Row wrap gap={8}>{chips(5)}</Row>
      <Text>after</Text>
    </Column>
  ), { width: 300, height: 300 });
  const [row, after] = root.children[0]!.children;
  expect(row!.height).toBe(48);
  expect(after!.y).toBe(48);
});

test("wrap: changing the parent width reflows", () => {
  const [width, setWidth] = createSignal(300);
  const { root, relayout } = mount(() => (
    <Column width={width} align="start">
      <Row wrap gap={8} width={width}>{chips(5)}</Row>
    </Column>
  ), { width: 1000, height: 300 });
  const row = () => root.children[0]!.children[0]!;
  expect(row().height).toBe(48);
  setWidth(500);
  relayout();
  expect(row().height).toBe(20); // 5 × 80 + 4 × 8 = 432 fits
  setWidth(170);
  relayout();
  expect(row().height).toBe(20 * 3 + 8 * 2); // 2, 2, 1
});

test("wrap: a wrapping Row stretched in a Column wraps at the Column's width", () => {
  const { root } = mount(() => (
    <Column padding={10}>
      <Row wrap gap={8}>{chips(5)}</Row>
    </Column>
  ), { width: 320, height: 300 }); // 300px inside
  const row = root.children[0]!.children[0]!;
  expect([row.width, row.height]).toEqual([300, 48]);
});

test("wrap: its natural width is one line; its minimum width is the widest item", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Row wrap gap={8}>{chips(3)}</Row>
      <Row width={150}>
        <Row wrap gap={8}>{chips(3, 60)}<Box width={100} height={20} /></Row>
        <Box width={40} height={10} />
      </Row>
    </Column>
  ), { width: 400, height: 300 });
  const [natural, holder] = root.children[0]!.children;
  expect(natural!.width).toBe(80 * 3 + 16);
  const squeezed = holder!.children[0]!;
  expect(squeezed.width).toBe(110); // shrank to make room for the 40px box (it may go down to 100)
  expect(squeezed.children.map((c) => c.y - squeezed.y)).toEqual([0, 28, 56, 84]); // one per line
  expect(squeezed.height).toBe(104);
});

test("wrap: items on later lines are culled like any child when outside a Scroll's view", () => {
  const { root } = mount(() => (
    <Scroll height={50}>
      <Row wrap gap={0}>{chips(10, 100, 20)}</Row>
    </Scroll>
  ), { width: 200, height: 300 });
  const row = root.children[0]!.children[0]!;
  expect(row.height).toBe(100);
  expect(row.children.map((c) => c.culled)).toEqual([false, false, false, false, false, false, true, true, true, true]);
});

test("wrap: no overflow warning for items that moved to the next line", () => {
  const { layoutWarnings } = mount(() => (
    <Box width={300} clip>
      <Row wrap gap={8}>{chips(10)}</Row>
    </Box>
  ), { width: 400, height: 400 });
  expect(layoutWarnings()).toEqual([]);
});

test("wrap: an item wider than the line still warns, and lines taller than a fixed height warn", () => {
  const { layoutWarnings } = mount(() => (
    <Column align="start">
      <Box width={100} clip>
        <Row wrap gap={0}><Box width={150} height={10} /></Row>
      </Box>
      <Box height={30} width={100} clip>
        <Row wrap gap={0} height={30}>{chips(3, 100, 20)}</Row>
      </Box>
    </Column>
  ), { width: 400, height: 400 });
  expect(layoutWarnings()).toEqual([
    "layout: Row > Box overflows Box by 50px (children need 150px, 100px available)",
    "layout: Row > Box overflows Box by 30px (children need 60px, 30px available)",
  ]);
});

test("wrap on a Column: items break into columns at its height, stacked left to right", () => {
  const { root } = mount(() => (
    <Row align="start">
      <Column wrap gap={4} rowGap={10} height={50}>
        <Box width={30} height={20} />
        <Box width={40} height={20} />
        <Box width={20} height={20} />
      </Column>
    </Row>
  ), { width: 400, height: 300 });
  const col = root.children[0]!.children[0]!;
  expect(col.children.map(box)).toEqual([[0, 0, 30, 20], [0, 24, 40, 20], [50, 0, 20, 20]]);
  expect(col.width).toBe(40 + 10 + 20);
});
