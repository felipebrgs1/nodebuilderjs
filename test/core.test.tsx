import { expect, test } from "bun:test";
import {
  Box, Column, For, Row, Scroll, Show, Text, UINode, createEffect, createMemo, createRoot, createSignal, debugTree, layout, onCleanup,
} from "@nodebuilderjs/core";
import { insert } from "@nodebuilderjs/core/jsx-runtime";
import { CommandBuffer, paintTree } from "../src/render/paint.js";

// Fake metrics: 8px per character, 20px line height.
import { setTextMeasurer } from "@nodebuilderjs/core";
setTextMeasurer((text) => ({ width: text.length * 8, ascent: 15, descent: 5 }));

function mount(view: () => any) {
  const root = new UINode("root");
  root.isRoot = true;
  const dispose = createRoot((d) => {
    insert(root, view);
    return d;
  });
  return { root, dispose };
}

const labels = (n: UINode): string[] => n.children.map((c) => c.label);

test("signals, memos and effects", () => {
  const [a, setA] = createSignal(1);
  const double = createMemo(() => a() * 2);
  const seen: number[] = [];
  createRoot(() => createEffect(() => seen.push(double())));
  setA(2);
  setA(2); // same value: no update
  setA(5);
  expect(seen).toEqual([2, 4, 10]);
});

test("cleanups run when an effect re-runs", () => {
  const [a, setA] = createSignal(0);
  const log: string[] = [];
  createRoot(() =>
    createEffect(() => {
      const v = a();
      log.push(`run ${v}`);
      onCleanup(() => log.push(`cleanup ${v}`));
    }),
  );
  setA(1);
  expect(log).toEqual(["run 0", "cleanup 0", "run 1"]);
});

test("an effect finishes before the effects its writes trigger (no re-entrant runs)", () => {
  const [a, setA] = createSignal(0);
  const [b, setB] = createSignal(0);
  const log: string[] = [];
  createRoot(() => {
    createEffect(() => {
      log.push(`start ${a()}`);
      setB(a());
      if (a() === 1) setA(2); // writes what it reads: runs again, after this run
      log.push(`end ${a()}`);
    });
    createEffect(() => log.push(`b ${b()}`));
  });
  log.length = 0;
  setA(1);
  expect(log).toEqual(["start 1", "end 2", "b 1", "start 2", "end 2", "b 2"]);
});

test("reactive text updates in place without recreating nodes", () => {
  const [n, setN] = createSignal(1);
  const { root } = mount(() => <Text>Cliques: {n}</Text>);
  const text = root.children[0]!;
  expect(text.label).toBe('Text "Cliques: 1"');
  setN(42);
  expect(root.children[0]).toBe(text);
  expect(text.label).toBe('Text "Cliques: 42"');
});

test("Show mounts lazily and disposes hidden branches", () => {
  const [on, setOn] = createSignal(false);
  let created = 0;
  let disposed = 0;
  function Probe() {
    created++;
    onCleanup(() => disposed++);
    return <Text>probe</Text>;
  }
  const { root } = mount(() => (
    <Show when={on} fallback={<Text>off</Text>}>
      <Probe />
    </Show>
  ));
  expect(labels(root)).toEqual(['Text "off"']);
  expect(created).toBe(0);
  setOn(true);
  expect(labels(root)).toEqual(['Text "probe"']);
  setOn(false);
  expect(created).toBe(1);
  expect(disposed).toBe(1);
});

test("For keeps rows when the list is reordered", () => {
  const a = { name: "a" };
  const b = { name: "b" };
  const c = { name: "c" };
  const [items, setItems] = createSignal([a, b]);
  let renders = 0;
  const { root } = mount(() => (
    <Column>
      <For each={items}>
        {(item) => {
          renders++;
          return <Text>{item.name}</Text>;
        }}
      </For>
    </Column>
  ));
  const col = root.children[0]!;
  const nodeA = col.children[0];
  setItems([c, b, a]);
  expect(labels(col)).toEqual(['Text "c"', 'Text "b"', 'Text "a"']);
  expect(col.children[2]).toBe(nodeA);
  expect(renders).toBe(3);
});

test("flex layout: row with grow, gap and padding", () => {
  const { root } = mount(() => (
    <Row padding={10} gap={5} align="center">
      <Text>abc</Text>
      <Column grow={1} height={40} />
      <Text>de</Text>
    </Row>
  ));
  const row = root.children[0]!;
  layout(row, 300, 100);
  const [t1, mid, t2] = row.children;
  expect([t1!.x, t1!.width, t1!.height]).toEqual([10, 24, 20]);
  expect(t1!.y).toBe(40); // centred: 10 + (80 - 20) / 2
  expect(mid!.x).toBe(39);
  expect(mid!.width).toBe(300 - 20 - 24 - 16 - 10);
  expect(t2!.x + t2!.width).toBe(290);
});

test("overflow shrinks the scroller, not the text above it", () => {
  const { root } = mount(() => (
    <Column>
      <Text>title</Text>
      <Scroll grow={1}>
        <Column height={500} />
      </Scroll>
    </Column>
  ));
  const col = root.children[0]!;
  layout(col, 200, 100);
  const [title, scroller] = col.children;
  expect(title!.height).toBe(20);
  expect(scroller!.y).toBe(20);
  expect(scroller!.height).toBe(80);
  expect(scroller!.contentHeight).toBe(500);
});

test("debugTree prints the laid out tree", () => {
  const { root } = mount(() => (
    <Column padding={4}>
      <Text>hi</Text>
    </Column>
  ));
  layout(root.children[0]!, 100, 50);
  expect(debugTree(root.children[0]!)).toBe('Column [0,0 100x50]\n  Text "hi" [4,4 92x20]\n');
});

test("debugTree shows an ariaLabel", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Box ariaLabel="Play" width={10} height={10} />
    </Column>
  ));
  layout(root.children[0]!, 100, 50);
  expect(debugTree(root.children[0]!.children[0]!)).toBe('Box ariaLabel="Play" [0,0 10x10]\n');
});

test("culling: rows outside a scroll are neither laid out nor painted", () => {
  const items = Array.from({ length: 100 }, (_, i) => `row ${i}`);
  const { root } = mount(() => (
    <Scroll height={100}>
      <For each={items}>{(t) => <Row><Text>{t}</Text></Row>}</For>
    </Scroll>
  ));
  const scroller = root.children[0]!;
  const painted = () => {
    const buffer = new CommandBuffer();
    paintTree(scroller, buffer);
    return buffer.texts;
  };

  layout(scroller, 200, 100);
  expect(scroller.contentHeight).toBe(2000); // every row still counts for the scroll extent
  expect(painted()).toEqual(["row 0", "row 1", "row 2", "row 3", "row 4", "row 5"]);
  const far = scroller.children[50]!;
  expect(far.culled).toBe(true);
  expect(far.y).toBe(1000); // its own box is still placed

  scroller.scrollY = 1010;
  layout(scroller, 200, 100);
  expect(far.culled).toBe(false);
  expect(far.children[0]!.y).toBe(-10); // the subtree is placed again when it comes into view
  expect(painted()).toEqual(["row 50", "row 51", "row 52", "row 53", "row 54", "row 55"]);
});

test("equal columns: width={0} grow={1} splits the row by grow alone, whatever the content (like flex-basis: 0)", () => {
  const { root } = mount(() => (
    <Column>
      <Row gap={10}>
        <Column width={0} grow={1}><Text>a</Text></Column>
        <Column width={0} grow={1}><Text>a much longer label here</Text></Column>
        <Column width={0} grow={2} />
      </Row>
      <Row gap={10}>
        <Column grow={1}><Text>a</Text></Column>
        <Column grow={1}><Text>a much longer</Text></Column>
      </Row>
    </Column>
  ));
  const col = root.children[0]!;
  layout(col, 420, 200);
  const [equal, natural] = col.children;
  expect(equal!.children.map((c) => [c.x, c.width])).toEqual([[0, 100], [110, 100], [220, 200]]);
  expect(equal!.children[1]!.children[0]!.height).toBe(60); // the text wraps to the column: 3 lines
  // Without width={0}, grow shares only the leftover: wider content, wider column.
  expect(natural!.children.map((c) => c.width)).toEqual([8 + 149, 104 + 149]);
});

test("equal rows: height={0} grow={1} splits a column's height the same way", () => {
  const { root } = mount(() => (
    <Column height={300}>
      <Row height={0} grow={1}><Text>one</Text></Row>
      <Row height={0} grow={1}><Column height={250} /></Row>
    </Column>
  ));
  const col = root.children[0]!;
  layout(col, 200, 300);
  expect(col.children.map((c) => [c.y, c.height])).toEqual([[0, 150], [150, 150]]);
});

test("absolute children: natural size (no stretch), placed inside the padding, not counted in the parent's size", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Column padding={10} gap={5}>
        <Text>in flow</Text>
        <Box position="absolute" left={4} top={6}><Text>a long badge text</Text></Box>
        <Box position="absolute" left={0} top={0} width={30} height={12} />
      </Column>
    </Column>
  ));
  const outer = root.children[0]!;
  layout(outer, 400, 300);
  const parent = outer.children[0]!;
  expect([parent.width, parent.height]).toEqual([56 + 20, 20 + 20]); // only the Text in flow
  const [, badge, fixed] = parent.children;
  expect([badge!.x, badge!.y, badge!.width, badge!.height]).toEqual([14, 16, 136, 20]);
  expect([fixed!.x, fixed!.y, fixed!.width, fixed!.height]).toEqual([10, 10, 30, 12]);
});

test("absolute children fill their parent with an explicit size taken from onResize", () => {
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const { root } = mount(() => (
    <Column align="start">
      <Box width={200} height={80} padding={10} onResize={setSize}>
        <Box position="absolute" left={0} top={0} width={() => size().width - 20} height={() => size().height - 20} />
      </Box>
    </Column>
  ));
  const outer = root.children[0]!;
  layout(outer, 400, 300); // reports the size; the next layout uses it
  layout(outer, 400, 300);
  const fill = outer.children[0]!.children[0]!;
  expect([fill.x, fill.y, fill.width, fill.height]).toEqual([10, 10, 180, 60]);
});

test("inside a Scroll, an absolute child stays put; inside an in-flow child, it scrolls with the content", () => {
  const { root } = mount(() => (
    <Scroll height={100}>
      <Column height={300} />
      <Box position="absolute" left={0} top={10} width={20} height={20} />
      <Column>
        <Box position="absolute" left={0} top={10} width={20} height={20} />
      </Column>
      <Column height={200} />
    </Scroll>
  ));
  const scroller = root.children[0]!;
  layout(scroller, 200, 100);
  const pinned = scroller.children[1]!;
  const carried = scroller.children[2]!.children[0]!;
  expect(pinned.y).toBe(10);
  expect(scroller.children[2]!.culled).toBe(true); // at y 300, below the view
  scroller.scrollY = 250;
  layout(scroller, 200, 100);
  expect([pinned.y, carried.y]).toEqual([10, 60]);
});
