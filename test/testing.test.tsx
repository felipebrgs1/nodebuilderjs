import { expect, test } from "bun:test";
import { Box, Button, Column, Overlay, Scroll, Text, TextField, createSignal } from "@nodebuilderjs/core";
import type { PointerEvent } from "@nodebuilderjs/core";
import { click, findByText, interact, mount } from "@nodebuilderjs/core/testing";

test("interact: hover, press and release go through the real event delivery", () => {
  const log: string[] = [];
  const { root } = mount(() => (
    <Column align="start">
      <Button label="Salvar" onClick={() => log.push("click")} />
    </Column>
  ));
  const ui = interact(root);
  const label = findByText(root, "Salvar")!;
  ui.hover(label);
  ui.press(label);
  ui.release(label);
  expect(log).toEqual(["click"]);
});

test("interact: type into the focused text field, with keys like BackSpace", () => {
  const [name, setName] = createSignal("");
  const { root } = mount(() => <Column><TextField value={name} onInput={setName} placeholder="Nome" /></Column>);
  const ui = interact(root);
  ui.press(root.children[0]!.children[0]!); // focus the field
  ui.type("Anaa");
  ui.key("BackSpace");
  expect(name()).toBe("Ana");
});

test("interact: drag delivers moves with local positions while pressed", () => {
  const seen: number[] = [];
  const { root } = mount(() => (
    <Column align="start">
      <Box width={200} height={20} onPointerMove={(e: PointerEvent) => seen.push(Math.round(e.localX))} />
    </Column>
  ));
  const track = root.children[0]!.children[0]!;
  interact(root).drag(track, 150, 0); // from the center (100) to 250, past the end
  expect(seen[0]).toBe(100);
  expect(seen[seen.length - 1]).toBe(250);
});

test("interact: scroll over a node", () => {
  const { root } = mount(() => (
    <Scroll height={100}>
      <Box height={500} />
      <Text>fim</Text>
    </Scroll>
  ));
  interact(root).scroll(root.children[0]!, 60);
  expect(root.children[0]!.scrollY).toBe(60);
});

test("interact: wheel with dx or Shift scrolls sideways", () => {
  const { root } = mount(() => (
    <Scroll horizontal height={50}>
      <Box width={2000} />
    </Scroll>
  ));
  const ui = interact(root);
  ui.scroll(root.children[0]!, 0, { dx: 25 });
  ui.scroll(root.children[0]!, 15, { shift: true });
  expect(root.children[0]!.scrollX).toBe(40);
});

test("interact: down/up at a window position, and the cursor the window would show", () => {
  const log: string[] = [];
  const { root } = mount(() => (
    <Column align="start">
      <Box width={100} height={40} cursor="pointer" onClick={() => log.push("click")} />
    </Column>
  ));
  const ui = interact(root);
  ui.move(10, 10);
  expect(ui.cursor).toBe("pointer");
  ui.down(10, 10);
  ui.up(20, 30);
  ui.move(150, 10);
  expect(ui.cursor).toBe("default");
  expect(log).toEqual(["click"]);
});

test("findByText and click also reach overlay content", () => {
  const log: string[] = [];
  const { root } = mount(() => (
    <Column>
      <Overlay>
        <Button label="Renomear" onClick={() => log.push("renomear")} />
      </Overlay>
    </Column>
  ));
  click(findByText(root, "Renomear")!);
  expect(log).toEqual(["renomear"]);
});
