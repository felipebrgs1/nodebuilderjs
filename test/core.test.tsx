import { expect, test } from "bun:test";
import {
  Column, For, Row, Scroll, Show, Text, UINode, createEffect, createMemo, createRoot, createSignal, debugTree, layout, onCleanup,
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
