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

test("an effect that keeps writing what it reads throws a loop error instead of hanging", () => {
  const [a, setA] = createSignal(0);
  expect(() => createRoot(() => createEffect(() => setA(a() + 1)))).toThrow(/reactive update loop/);
  expect(() => createRoot(() => createEffect(() => setA(a() + 1)))).toThrow(/reactive update loop/);
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

test("a shrinking row keeps a sibling as wide as its fixed-width child, even if that child has a smaller minWidth", () => {
  const { root } = mount(() => (
    <Row width={300}>
      <Column grow={1}>
        <Text>a b c d</Text>
        <Box width={150} minWidth={50} height={10} />
      </Column>
      <Box grow={1} minWidth={0}><Text>{"x".repeat(40)}</Text></Box>
    </Row>
  ));
  const row = root.children[0]!;
  layout(row, 300, 100);
  // The fixed 150px is the column's floor (minWidth only matters where width is free).
  expect(row.children[0]!.width).toBe(150);
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

test("absolute children: left and right stretch to the parent's inner width, top and bottom to its height", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Box width={320} height={120} padding={10}>
        <Box position="absolute" left={0} right={0} top={0} bottom={0} />
        <Box position="absolute" left={20} right={30} top={5} height={10} />
      </Box>
    </Column>
  ));
  const outer = root.children[0]!;
  layout(outer, 400, 300);
  const [fill, inset] = outer.children[0]!.children;
  expect([fill!.x, fill!.y, fill!.width, fill!.height]).toEqual([10, 10, 300, 100]);
  expect([inset!.x, inset!.y, inset!.width, inset!.height]).toEqual([30, 15, 250, 10]);
});

test("absolute children: right or bottom alone places the child from that edge", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Box width={300} height={100}>
        <Box position="absolute" right={10} bottom={10} width={50} height={20} />
        <Box position="absolute" right={0} top={0}><Text>badge</Text></Box>
      </Box>
    </Column>
  ));
  const outer = root.children[0]!;
  layout(outer, 400, 300);
  const [corner, badge] = outer.children[0]!.children;
  expect([corner!.x, corner!.y]).toEqual([240, 70]);
  expect([badge!.x, badge!.y, badge!.width]).toEqual([300 - 40, 0, 40]); // natural width
});

test("absolute children: an explicit size or a max wins over left + right (right is then ignored, as in CSS)", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Box width={300} height={100}>
        <Box position="absolute" left={10} right={10} width={50} height={20} />
        <Box position="absolute" left={10} right={10} maxWidth={100} top={0} bottom={0} maxHeight={40} />
        <Box position="absolute" left={10} right={290} minWidth={30} height={10} />
      </Box>
    </Column>
  ));
  const outer = root.children[0]!;
  layout(outer, 400, 300);
  const [sized, capped, floored] = outer.children[0]!.children;
  expect([sized!.x, sized!.width]).toEqual([10, 50]);
  expect([capped!.x, capped!.width, capped!.height]).toEqual([10, 100, 40]);
  expect([floored!.x, floored!.width]).toEqual([10, 30]);
});

test("absolute children: wrapping text stretched by left + right gets the height of that width", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Box width={100} height={200}>
        <Text position="absolute" left={0} right={0}>one two three four</Text>
      </Box>
    </Column>
  ));
  const outer = root.children[0]!;
  layout(outer, 400, 300);
  const text = outer.children[0]!.children[0]!;
  expect([text.width, text.height]).toEqual([100, 40]); // "one two three" / "four"
});

test("inside a Scroll, an absolute child scrolls with the content, like the in-flow ones", () => {
  const { root } = mount(() => (
    <Scroll height={100}>
      <Column height={300} />
      <Box position="absolute" left={0} top={10} width={20} height={20} />
      <Box position="absolute" left={0} right={0} bottom={0} height={10} />
      <Column height={200} />
    </Scroll>
  ));
  const scroller = root.children[0]!;
  layout(scroller, 200, 100);
  const [, top, bottom] = scroller.children;
  expect([top!.y, bottom!.y, bottom!.width]).toEqual([10, 90, 200]);
  scroller.scrollY = 250;
  layout(scroller, 200, 100);
  expect([top!.y, bottom!.y]).toEqual([-240, -160]);
  expect([top!.culled, bottom!.culled]).toEqual([true, true]);
});

test("inside a horizontal Scroll, an absolute child scrolls sideways with the content", () => {
  const { root } = mount(() => (
    <Scroll horizontal width={100}>
      <Row width={400} height={20} />
      <Box position="absolute" left={30} top={0} width={20} height={20} />
    </Scroll>
  ));
  const scroller = root.children[0]!;
  layout(scroller, 100, 50);
  const mark = scroller.children[1]!;
  expect(mark.x).toBe(30);
  scroller.scrollX = 25;
  layout(scroller, 100, 50);
  expect(mark.x).toBe(5);
});

test("alignSelf overrides the column's align for one child; its siblings keep the parent's", () => {
  const { root } = mount(() => (
    <Column width={200}>
      <Text>stretched</Text>
      <Text alignSelf="center">mid</Text>
      <Text alignSelf="end">end</Text>
      <Text alignSelf="start">start</Text>
    </Column>
  ));
  const col = root.children[0]!;
  layout(col, 200, 300);
  expect(col.children.map((c) => [c.x, c.width])).toEqual([[0, 200], [88, 24], [176, 24], [0, 40]]);
});

test("alignSelf in a row: one child stretches or moves while the row aligns the rest to the start", () => {
  const { root } = mount(() => (
    <Row height={100} align="start">
      <Box width={10} height={20} />
      <Box width={10} alignSelf="stretch" />
      <Box width={10} height={20} alignSelf="center" />
      <Box width={10} height={20} alignSelf="end" />
    </Row>
  ));
  const row = root.children[0]!;
  layout(row, 200, 100);
  expect(row.children.map((c) => [c.y, c.height])).toEqual([[0, 20], [0, 100], [40, 20], [80, 20]]);
});

test("alignSelf with wrapping text: a centered child wraps at the column's width and the column grows to fit", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Column width={100} align="end">
        <Text alignSelf="center">one two three four</Text>
        <Text alignSelf="stretch">ab</Text>
      </Column>
    </Column>
  ));
  const outer = root.children[0]!;
  layout(outer, 400, 300);
  const col = outer.children[0]!;
  const [long, short] = col.children;
  expect([long!.x, long!.width, long!.height]).toEqual([0, 100, 40]);
  expect([short!.x, short!.width]).toEqual([0, 100]);
  expect(col.height).toBe(60);
});
