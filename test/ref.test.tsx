import { expect, test } from "bun:test";
import { Box, Checkbox, Column, Row, Scroll, Text, TextField, createSignal } from "@nodebuilderjs/core";
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

test("focus() called while the element is created takes effect once it is in the tree", async () => {
  const [name, setName] = createSignal("");
  const { root } = mount(() => (
    <Column>
      <TextField ref={(e) => e.focus()} value={name} onInput={setName} />
    </Column>
  ));
  const ui = interact(root);
  await Promise.resolve();
  ui.type("Ana");
  expect(name()).toBe("Ana");
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
