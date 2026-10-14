import { expect, test } from "bun:test";
import { Box, Column, For, Grid, Image, Row, Scroll, Text, createSignal } from "@nodebuilderjs/core";
import { mount } from "@nodebuilderjs/core/testing";

// Fake metrics (mount): 8 px per character, 20 px line.

const box = (n: { x: number; y: number; width: number; height: number }) => [n.x, n.y, n.width, n.height];

test("Grid: 4 columns in 400px with gap 8 are 94px each; a fifth child starts a second row at x=0", () => {
  const { root } = mount(() => (
    <Grid columns={4} gap={8}>
      {[1, 2, 3, 4, 5].map(() => <Box height={30} />)}
    </Grid>
  ), { width: 400, height: 300 });
  const grid = root.children[0]!;
  expect(grid.children.map(box)).toEqual([
    [0, 0, 94, 30], [102, 0, 94, 30], [204, 0, 94, 30], [306, 0, 94, 30],
    [0, 38, 94, 30],
  ]);
  expect(grid.height).toBe(68);
});

test("Grid: rowGap separates rows, gap separates cells; padding is respected", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Grid columns={2} gap={10} rowGap={4} padding={5} width={210}>
        {[1, 2, 3].map(() => <Box height={20} />)}
      </Grid>
    </Column>
  ), { width: 400, height: 300 });
  const grid = root.children[0]!.children[0]!;
  expect(grid.children.map(box)).toEqual([[5, 5, 95, 20], [110, 5, 95, 20], [5, 29, 95, 20]]);
  expect(grid.height).toBe(5 + 20 + 4 + 20 + 5);
});

test("Grid: wrapping text in one cell grows only its row; cells stretch to the row height", () => {
  const { root } = mount(() => (
    <Grid columns={2} gap={0}>
      <Text>a b c d e f</Text>
      <Box />
      <Box height={30} />
      <Box height={10} alignSelf="end" />
    </Grid>
  ), { width: 48, height: 300 }); // cells 24px: 3 characters a line
  const [text, beside, third, fourth] = root.children[0]!.children;
  expect(text!.height).toBe(60); // "a b", "c d", "e f"
  expect(beside!.height).toBe(60); // stretched to its row
  expect([third!.y, third!.height]).toEqual([60, 30]);
  expect([fourth!.y, fourth!.height]).toEqual([80, 10]); // end of the second row
});

test("Grid: its natural width is the widest cell times the columns (empty cells included)", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Grid columns={3} gap={2}>
        <Text>ab</Text>
        <Text>abcd</Text>
      </Grid>
    </Column>
  ), { width: 400, height: 300 });
  const grid = root.children[0]!.children[0]!;
  expect([grid.width, grid.height]).toEqual([3 * 32 + 4, 20]);
});

test("Grid: <For> adding and removing items reflows the cells, keeping the item nodes", () => {
  const [items, setItems] = createSignal(["a", "b", "c"]);
  const { root, relayout } = mount(() => (
    <Grid columns={2} gap={0}>
      <For each={items}>{(item) => <Text>{item}</Text>}</For>
    </Grid>
  ), { width: 200, height: 300 });
  const grid = root.children[0]!;
  const first = grid.children[0];
  setItems(["z", "a", "b", "c"]);
  relayout();
  expect(grid.children[1]).toBe(first!);
  expect(grid.children.map((c) => [c.x, c.y])).toEqual([[0, 0], [100, 0], [0, 20], [100, 20]]);
  setItems(["c"]);
  relayout();
  expect(grid.children.map(box)).toEqual([[0, 0, 100, 20]]);
});

test("Grid: absolute children are placed from the content box, outside the cells", () => {
  const { root } = mount(() => (
    <Grid columns={2} padding={4}>
      <Box height={10} />
      <Box position="absolute" right={0} top={0} width={6} height={6} />
      <Box height={10} />
    </Grid>
  ), { width: 108, height: 300 });
  const [a, badge, b] = root.children[0]!.children;
  expect(box(a!)).toEqual([4, 4, 50, 10]);
  expect(box(b!)).toEqual([54, 4, 50, 10]);
  expect(box(badge!)).toEqual([98, 4, 6, 6]);
});

test("Grid: rows outside a Scroll's view are culled", () => {
  const { root } = mount(() => (
    <Scroll height={100}>
      <Grid columns={2}>
        {Array.from({ length: 20 }, () => <Box height={50} />)}
      </Grid>
    </Scroll>
  ), { width: 200, height: 100 });
  const cells = root.children[0]!.children[0]!.children;
  expect(cells.map((c) => c.culled)).toEqual(cells.map((_, i) => i >= 6));
  expect(root.children[0]!.contentHeight).toBe(500);
});

test("aspectRatio: in a 300px column (stretch) a Box is 300x300; 2 makes it half as tall", () => {
  const { root } = mount(() => (
    <Column>
      <Box aspectRatio={1} />
      <Box aspectRatio={2} />
    </Column>
  ), { width: 300, height: 600 });
  const [square, wide] = root.children[0]!.children;
  expect(box(square!)).toEqual([0, 0, 300, 300]);
  expect(box(wide!)).toEqual([0, 300, 300, 150]);
});

test("aspectRatio: a fixed height gives the width, also in a stretching column", () => {
  const { root } = mount(() => (
    <Column>
      <Box aspectRatio={2} height={40} />
    </Column>
  ), { width: 300, height: 600 });
  expect(box(root.children[0]!.children[0]!)).toEqual([0, 0, 80, 40]);
});

test("aspectRatio: in a row of fixed height the width follows the height; grow takes the rest", () => {
  const { root } = mount(() => (
    <Column>
      <Row height={100}>
        <Box aspectRatio={1.5} />
        <Box grow={1} />
      </Row>
    </Column>
  ), { width: 400, height: 600 });
  const [cover, rest] = root.children[0]!.children[0]!.children;
  expect(box(cover!)).toEqual([0, 0, 150, 100]);
  expect(box(rest!)).toEqual([150, 0, 250, 100]);
});

test("aspectRatio: min/max still clamp the side that follows", () => {
  const { root } = mount(() => (
    <Column>
      <Box aspectRatio={1} maxHeight={120} />
      <Box aspectRatio={4} minHeight={100} />
    </Column>
  ), { width: 300, height: 600 });
  const [capped, floored] = root.children[0]!.children;
  expect([capped!.width, capped!.height]).toEqual([300, 120]);
  expect([floored!.width, floored!.height]).toEqual([300, 100]);
});

test("aspectRatio: content taller than the ratio makes the box taller", () => {
  const { root } = mount(() => (
    <Column>
      <Column aspectRatio={4}>
        <Box height={100} />
      </Column>
    </Column>
  ), { width: 200, height: 600 });
  expect(root.children[0]!.children[0]!.height).toBe(100);
});

test("aspectRatio: a parent's height follows its width (column inside a row with grow)", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Row width={300}>
        <Column grow={1}><Box aspectRatio={1} /></Column>
        <Box width={100} height={10} />
      </Row>
    </Column>
  ), { width: 400, height: 600 });
  const row = root.children[0]!.children[0]!;
  expect(row.height).toBe(200);
  expect(box(row.children[0]!.children[0]!)).toEqual([0, 0, 200, 200]);
});

test("aspectRatio inside Grid cells: square cells, rows as tall as the cells are wide", () => {
  const { root } = mount(() => (
    <Column>
      <Grid columns={3} gap={10}>
        {[1, 2, 3, 4].map(() => <Box aspectRatio={1} />)}
      </Grid>
      <Text>after</Text>
    </Column>
  ), { width: 320, height: 600 });
  const [grid, after] = root.children[0]!.children;
  expect(grid!.children.map(box)).toEqual([
    [0, 0, 100, 100], [110, 0, 100, 100], [220, 0, 100, 100], [0, 110, 100, 100],
  ]);
  expect(after!.y).toBe(210);
});

test("aspectRatio in a Grid cell keeps its shape next to a taller cell (no stretch)", () => {
  const { root } = mount(() => (
    <Grid columns={2}>
      <Box aspectRatio={1} />
      <Box height={150} />
    </Grid>
  ), { width: 200, height: 600 });
  const [square, tall] = root.children[0]!.children;
  expect(box(square!)).toEqual([0, 0, 100, 100]);
  expect(tall!.height).toBe(150);
});

test("aspectRatio on an Image wins over the picture's own size: square covers in a Grid", () => {
  const png = new URL("./fixtures/rgba8.png", import.meta.url).pathname; // 13x9
  const { root } = mount(() => (
    <Grid columns={2} gap={0}>
      <Image src={png} aspectRatio={1} fit="cover" />
      <Image src={png} aspectRatio={1} fit="cover" />
    </Grid>
  ), { width: 8, height: 600 });
  expect(root.children[0]!.children.map(box)).toEqual([[0, 0, 4, 4], [4, 0, 4, 4]]);
});

test("Grid minColumnWidth: as many columns as fit (CSS auto-fill + minmax), cells share the leftover", () => {
  const [width, setWidth] = createSignal(340);
  const { root, relayout } = mount(() => (
    <Column align="start">
      <Grid minColumnWidth={100} gap={10} width={width}>
        {[1, 2, 3, 4].map(() => <Box height={20} />)}
      </Grid>
    </Column>
  ), { width: 400, height: 300 });
  const grid = root.children[0]!.children[0]!;
  // 340 px: three 100 px columns fit ((340 + 10) / 110 = 3.2); each takes (340 - 20) / 3.
  expect(grid.children.map((c) => [Math.round(c.x), c.y, Math.round(c.width)])).toEqual([[0, 0, 107], [117, 0, 107], [233, 0, 107], [0, 30, 107]]);
  setWidth(200);
  relayout();
  expect(grid.children.map((c) => [c.x, c.y, c.width])).toEqual([[0, 0, 200], [0, 30, 200], [0, 60, 200], [0, 90, 200]]);
  expect(grid.height).toBe(110);
});

test("Grid minColumnWidth with columns: columns is the most there will be", () => {
  const { root } = mount(() => (
    <Grid minColumnWidth={50} columns={2} gap={0}>
      {[1, 2, 3].map(() => <Box height={20} />)}
    </Grid>
  ), { width: 400, height: 300 });
  expect(root.children[0]!.children.map((c) => [c.x, c.width])).toEqual([[0, 200], [200, 200], [0, 200]]);
});

test("Grid minColumnWidth: its natural width puts every cell in one row; it shrinks to one column", () => {
  const { root } = mount(() => (
    <Row>
      <Grid minColumnWidth={60} gap={4}>
        {[1, 2, 3].map(() => <Box height={20} />)}
      </Grid>
      <Box width={300} height={10} />
    </Row>
  ), { width: 400, height: 300 });
  const grid = root.children[0]!.children[0]!;
  expect(grid.width).toBe(100); // squeezed by the 300 px box: one 60 px column fits, stretched
  expect(grid.children.map((c) => [c.x, c.y])).toEqual([[0, 0], [0, 24], [0, 48]]);
});
