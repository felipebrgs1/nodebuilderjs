import { describe, expect, test } from "bun:test";
import { Box, Checkbox, Column, For, Overlay, Row, Scroll, Show, Text, TextField, UINode, batch, createEffect, createSignal, onMount } from "@nodebuilderjs/core";
import type { ElementRef } from "@nodebuilderjs/core";
import { interact, mount } from "@nodebuilderjs/core/testing";

test("ref receives the element, whose box is filled by layout", () => {
  let el: ElementRef | undefined;
  mount(() => (
    <Column padding={10} align="start">
      <Box ref={(e) => (el = e)} width={120} height={40} />
    </Column>
  ));
  expect(el).toBeDefined();
  expect([el!.x, el!.y, el!.width, el!.height]).toEqual([10, 10, 120, 40]);
});

test("focus() through a ref moves the keyboard to that field", () => {
  const [a, setA] = createSignal("");
  const [b, setB] = createSignal("");
  let second: ElementRef | undefined;
  const { root } = mount(() => (
    <Column>
      <TextField value={a} onInput={setA} />
      <TextField ref={(e) => (second = e)} value={b} onInput={setB} />
    </Column>
  ));
  const ui = interact(root);
  second!.focus();
  ui.type("oi");
  expect(b()).toBe("oi");
  expect(a()).toBe("");
});

test("focus() called while the element is created takes effect once it is in the tree, with no await", () => {
  const [name, setName] = createSignal("");
  const { root } = mount(() => (
    <Column>
      <TextField ref={(e) => e.focus()} value={name} onInput={setName} />
    </Column>
  ));
  const ui = interact(root);
  ui.type("Ana");
  expect(name()).toBe("Ana");
});

test("focus() in a ref of an element shown later by <Show> lands when it is inserted", () => {
  const [open, setOpen] = createSignal(false);
  const keys: string[] = [];
  const { root } = mount(() => (
    <Column>
      <Show when={open}>
        <Column focusable ref={(e) => e.focus()} onKeyDown={(e) => keys.push(e.key)} />
      </Show>
    </Column>
  ));
  const ui = interact(root);
  setOpen(true);
  ui.key("Escape");
  expect(keys).toEqual(["Escape"]);
});

describe("onMount", () => {
  test("runs once, after the component's nodes are in the tree, with its refs set", () => {
    const seen: string[] = [];
    let runs = 0;
    const [count, setCount] = createSignal(0);
    function Panel() {
      let el: ElementRef | undefined;
      onMount(() => {
        runs++;
        count(); // untracked: writing it later does not run onMount again
        seen.push(el ? `ref ${(el as unknown as UINode).attached}` : "no ref");
      });
      return <Box ref={(e) => (el = e)} height={10} />;
    }
    mount(() => (
      <Column>
        <Panel />
      </Column>
    ));
    expect(seen).toEqual(["ref true"]);
    setCount(1);
    expect(runs).toBe(1);
  });

  test("a component shown by <Show> mounts each time it is shown", () => {
    const [open, setOpen] = createSignal(false);
    let mounts = 0;
    function Inner() {
      onMount(() => mounts++);
      return <Text>inner</Text>;
    }
    mount(() => (
      <Column>
        <Show when={open}>
          <Inner />
        </Show>
      </Column>
    ));
    expect(mounts).toBe(0);
    setOpen(true);
    expect(mounts).toBe(1);
    setOpen(false);
    setOpen(true);
    expect(mounts).toBe(2);
  });

  test("not for a component disposed before it was inserted", () => {
    const [open, setOpen] = createSignal(false);
    let mounts = 0;
    function Inner() {
      onMount(() => mounts++);
      return <Text>inner</Text>;
    }
    mount(() => (
      <Column>
        <Show when={open}>
          <Inner />
        </Show>
      </Column>
    ));
    batch(() => {
      setOpen(true);
      setOpen(false);
    });
    expect(mounts).toBe(0);
  });

  test("scroll to the end on the first render, then when messages change", () => {
    const [messages, setMessages] = createSignal(["a", "b"]);
    let scroller: ElementRef | undefined;
    function Chat() {
      // The ref exists from onMount on: an effect created there sees it on its first run.
      onMount(() =>
        createEffect(() => {
          messages();
          scroller!.scrollTo(1e9);
        }),
      );
      return (
        <Scroll ref={(e) => (scroller = e)} height={40}>
          <For each={messages}>{(m) => <Box height={30}><Text>{m}</Text></Box>}</For>
        </Scroll>
      );
    }
    const { relayout } = mount(() => (
      <Column>
        <Chat />
      </Column>
    ));
    relayout();
    expect(scroller!.scrollY).toBe(20);
    setMessages(["a", "b", "c"]);
    relayout();
    expect(scroller!.scrollY).toBe(50);
  });
});

test("blur() releases the focus; focus() on something not focusable does nothing", () => {
  const [name, setName] = createSignal("");
  let field: ElementRef | undefined;
  let box: ElementRef | undefined;
  const { root } = mount(() => (
    <Column>
      <TextField ref={(e) => (field = e)} value={name} onInput={setName} />
      <Box ref={(e) => (box = e)} height={10} />
    </Column>
  ));
  const ui = interact(root);
  field!.focus();
  box!.focus();
  expect(ui.focused).toBe(field as never);
  field!.blur();
  expect(ui.focused).toBeNull();
});

test("scrollTo() on a Scroll moves its content, clamped to the end", () => {
  let list: ElementRef | undefined;
  const { root, relayout } = mount(() => (
    <Scroll ref={(e) => (list = e)} height={100}>
      <Box height={300} />
      <Text>fim</Text>
    </Scroll>
  ));
  const scroll = root.children[0]!;
  list!.scrollTo(50);
  relayout();
  expect(list!.scrollY).toBe(50);
  expect(scroll.children[0]!.y).toBe(-50);
  list!.scrollTo(10_000);
  relayout();
  expect(list!.scrollY).toBe(220); // 300 + 20 (text line) - 100
});

test("Checkbox takes style props and a ref like the other widgets", () => {
  let el: ElementRef | undefined;
  mount(() => (
    <Row align="start">
      <Checkbox ref={(e) => (el = e)} padding={4} checked={() => false} onChange={() => {}} />
    </Row>
  ));
  expect(el!.height).toBe(28); // 20 px box + 2 × 4 padding
});

test("onResize reports the size after layout, only when it changes", () => {
  const [width, setWidth] = createSignal(100);
  const sizes: string[] = [];
  const { relayout } = mount(() => (
    <Column align="start">
      <Box width={width} height={30} onResize={(s) => sizes.push(`${s.width}x${s.height}`)} />
    </Column>
  ));
  relayout();
  setWidth(150);
  relayout();
  expect(sizes).toEqual(["100x30", "150x30"]);
});

test("children created by onResize are placed by the same layout, and clickable right away", () => {
  const [width, setWidth] = createSignal(0);
  let clicked = "";
  const { root } = mount(() => (
    <Column align="start">
      <Row width={240} onResize={(s) => setWidth(s.width)}>
        <For each={() => Array.from({ length: Math.floor(width() / 80) }, (_, i) => i)}>
          {(i) => <Box width={80} height={20} onClick={() => (clicked = `cell ${i}`)} />}
        </For>
      </Row>
    </Column>
  ));
  const row = root.children[0]!.children[0]!;
  expect(row.children.map((c) => c.x)).toEqual([0, 80, 160]);
  const ui = interact(root);
  ui.press(row.children[2]!);
  ui.release(row.children[2]!);
  expect(clicked).toBe("cell 2");
});

test("an onResize that always changes its own size stops after a bound, with a layout warning", () => {
  const [width, setWidth] = createSignal(10);
  let calls = 0;
  const { layoutWarnings } = mount(() => (
    <Column align="start">
      <Box ariaLabel="grower" width={width} height={10} onResize={(s) => (calls++, setWidth(s.width + 10))} />
    </Column>
  ));
  expect(calls).toBe(3); // the first layout and two extra passes
  expect(layoutWarnings()).toEqual([expect.stringContaining("onResize keeps changing the layout")]);
  expect(layoutWarnings()[0]).toContain("Box(grower)");
});

test("scrollTo({ x, y }) scrolls either axis; scrollX reads the horizontal position", () => {
  let el: ElementRef | undefined;
  const { relayout } = mount(() => (
    <Column align="start">
      <Scroll ref={(e) => (el = e)} horizontal vertical width={100} height={100}>
        <Box width={400} height={400} />
      </Scroll>
    </Column>
  ));
  el!.scrollTo({ x: 50, y: 70 });
  relayout();
  expect([el!.scrollX, el!.scrollY]).toEqual([50, 70]);
  el!.scrollTo({ x: 1000 }); // only x; clamped to the end
  relayout();
  expect([el!.scrollX, el!.scrollY]).toEqual([300, 70]);
});

test("scrollTo() called while the Scroll is created starts it there", () => {
  const { root } = mount(() => (
    <Scroll ref={(e) => e.scrollTo({ x: 30, y: 50 })} horizontal vertical width={100} height={100}>
      <Box width={400} height={400} />
    </Scroll>
  ));
  expect([root.children[0]!.scrollX, root.children[0]!.scrollY]).toEqual([30, 50]);
});

describe("scrollIntoView", () => {
  test("a region of the element (a caret in an editor) scrolls just enough to show that region", () => {
    let editor!: ElementRef;
    const { root, relayout } = mount(() => (
      <Scroll height={100} width={200}>
        <Box height={2000} ref={(e) => (editor = e)} />
      </Scroll>
    ));
    const scroller = root.children[0]!;
    editor.scrollIntoView({ x: 0, y: 500, width: 2, height: 20 });
    relayout();
    expect(scroller.scrollY).toBe(420); // 500..520 at the bottom
    editor.scrollIntoView({ x: 0, y: 450, width: 2, height: 20 }); // visible already
    relayout();
    expect(scroller.scrollY).toBe(420);
    editor.scrollIntoView({ y: 100, height: 20 });
    relayout();
    expect(scroller.scrollY).toBe(100);
  });

  // 100 rows of 20 px in a 100 px tall Scroll.
  const rows = (refs: ElementRef[]) => () => (
    <Scroll height={100}>
      <For each={Array.from({ length: 100 }, (_, i) => i)}>
        {(i) => (
          <Row>
            <Text ref={(e) => (refs[i] = e)}>{`linha ${i}`}</Text>
          </Row>
        )}
      </For>
    </Scroll>
  );

  test("scrolls just enough: a row below ends at the bottom, a row above starts at the top", () => {
    const refs: ElementRef[] = [];
    const { root, relayout } = mount(rows(refs));
    const scroller = root.children[0]!;
    refs[10]!.scrollIntoView();
    relayout();
    expect(scroller.scrollY).toBe(120); // row 10 is at 200..220
    expect(refs[10]!.y).toBe(80);
    refs[3]!.scrollIntoView();
    relayout();
    expect(scroller.scrollY).toBe(60);
    refs[4]!.scrollIntoView(); // already visible
    relayout();
    expect(scroller.scrollY).toBe(60);
  });

  test("works for an element whose row was culled (its old box is never used)", () => {
    const refs: ElementRef[] = [];
    const { root, relayout } = mount(rows(refs));
    const scroller = root.children[0]!;
    expect(scroller.children[50]!.culled).toBe(true);
    refs[50]!.scrollIntoView();
    relayout();
    expect(scroller.scrollY).toBe(920);
    expect([refs[50]!.y, scroller.children[50]!.culled]).toEqual([80, false]);
  });

  test("scrolls every Scroll around it, inner first, on both axes", () => {
    let target: ElementRef | undefined;
    const { root, relayout } = mount(() => (
      <Scroll height={100}>
        <Box height={300} />
        <Scroll horizontal height={50}>
          <Box width={500} />
          <Box ref={(e) => (target = e)} width={40} />
        </Scroll>
      </Scroll>
    ), { width: 200, height: 200 });
    const outer = root.children[0]!;
    const inner = outer.children[1]!;
    target!.scrollIntoView();
    relayout();
    expect([inner.scrollX, outer.scrollY]).toEqual([340, 250]);
    expect([target!.x, target!.y]).toEqual([160, 50]);
  });

  test("called while the element is created, it applies on the first layout", () => {
    const { root } = mount(() => (
      <Scroll height={100}>
        <Box height={300} />
        <Box height={20} ref={(e) => e.scrollIntoView()} />
      </Scroll>
    ));
    expect(root.children[0]!.scrollY).toBe(220);
  });

  test("inside an overlay, it never scrolls what is behind the layer", () => {
    let item: ElementRef | undefined;
    const { root, relayout } = mount(() => (
      <Scroll height={100}>
        <Box height={300} />
        <Overlay>
          <Box ref={(e) => (item = e)} height={20} />
        </Overlay>
      </Scroll>
    ));
    item!.scrollIntoView();
    relayout();
    expect(root.children[0]!.scrollY).toBe(0);
  });
});
