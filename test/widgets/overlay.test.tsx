import { expect, test } from "bun:test";
import { Box, Button, Column, Overlay, Row, Scroll, Show, Text, createContext, createSignal, useContext } from "@nodebuilderjs/core";
import type { ElementRef } from "@nodebuilderjs/core";
import { findByText, interact, mount } from "@nodebuilderjs/core/testing";
import { drawCommands } from "../helpers.js";

test("an overlay is drawn after the whole tree and outside the clip of its container", () => {
  const { root } = mount(() => (
    <Column>
      <Scroll height={50}>
        <Overlay>
          <Box background="#ff0000" height={10} />
        </Overlay>
      </Scroll>
      <Box background="#00ff00" height={10} />
    </Column>
  ));
  const ops = drawCommands(root).map((c) => (c.op === "rect" ? `rect ${c.color.join(",")}` : c.op));
  expect(ops).toEqual(["clip", "unclip", "rect 0,1,0,1", "rect 1,0,0,1"]);
});

test("the overlay placeholder takes no room in the layout", () => {
  const { root } = mount(() => (
    <Column gap={10}>
      <Box height={20} />
      <Overlay>
        <Text>flutuante</Text>
      </Overlay>
      <Box height={20} />
    </Column>
  ));
  const boxes = root.children[0]!.children.filter((c) => c.label === "Box");
  expect(boxes.map((b) => b.y)).toEqual([0, 30]);
});

test("without an anchor the overlay covers the window and lays out its children with flex props", () => {
  const { root } = mount(() => (
    <Column>
      <Overlay align="center" justify="center">
        <Box width={100} height={50} />
      </Overlay>
    </Column>
  ), { width: 800, height: 600 });
  const dialog = root.layers[0]!.children[0]!;
  expect([dialog.x, dialog.y, dialog.width, dialog.height]).toEqual([350, 275, 100, 50]);
});

test("an anchored overlay goes below its anchor, or above when there is no room", () => {
  let anchor!: ElementRef;
  const [top, setTop] = createSignal(100);
  const { root, relayout } = mount(() => (
    <Column>
      <Box position="absolute" left={40} top={top} width={120} height={30} ref={(e) => (anchor = e)} />
      <Overlay anchor={() => anchor} offset={4}>
        <Box width={80} height={60} />
      </Overlay>
    </Column>
  ), { width: 800, height: 600 });
  const layer = root.layers[0]!;
  expect([layer.x, layer.y, layer.width, layer.height]).toEqual([40, 134, 80, 60]);
  setTop(520);
  relayout();
  expect([layer.x, layer.y]).toEqual([40, 456]); // 520 - 4 - 60
});

test("an anchored overlay can match the anchor width and stays inside the window", () => {
  let anchor!: ElementRef;
  const { root } = mount(() => (
    <Column>
      <Box position="absolute" left={750} top={10} width={40} height={20} ref={(e) => (anchor = e)} />
      <Overlay anchor={() => anchor} matchWidth>
        <Box height={20} />
      </Overlay>
      <Overlay anchor={() => anchor}>
        <Box width={100} height={20} />
      </Overlay>
    </Column>
  ), { width: 800, height: 600 });
  expect(root.layers[0]!.width).toBe(40);
  expect(root.layers[1]!.x).toBe(690); // too wide to start at the anchor: it ends where the anchor does
});

test("an overlay at a point (a context menu): below and right of it, flipping to fit near the window's edges", () => {
  const [point, setPoint] = createSignal({ x: 100, y: 50 });
  const { root, relayout } = mount(() => (
    <Column>
      <Overlay at={point}>
        <Box width={160} height={120} />
      </Overlay>
    </Column>
  ), { width: 800, height: 600 });
  const layer = root.layers[0]!;
  expect([layer.x, layer.y, layer.width, layer.height]).toEqual([100, 50, 160, 120]);
  setPoint({ x: 700, y: 550 }); // bottom-right corner: opens up and to the left of the pointer
  relayout();
  expect([layer.x, layer.y]).toEqual([540, 430]);
  setPoint({ x: 100, y: 590 }); // only the vertical side flips
  relayout();
  expect([layer.x, layer.y]).toEqual([100, 470]);
});

test("a context menu from onContextMenu + <Overlay at>, dismissed by a press outside", () => {
  const [menu, setMenu] = createSignal<{ x: number; y: number } | null>(null);
  const { root, relayout } = mount(() => (
    <Column width={400} height={300} onContextMenu={(e) => setMenu({ x: e.x, y: e.y })}>
      <Show when={menu}>
        {(at) => (
          <Overlay at={at} onDismiss={() => setMenu(null)}>
            <Text>Rename</Text>
          </Overlay>
        )}
      </Show>
    </Column>
  ), { width: 800, height: 600 });
  const ui = interact(root);
  ui.down(30, 40);
  ui.up(30, 40);
  expect(root.layers).toHaveLength(0);
  ui.contextMenu(root.children[0]!); // its center
  relayout();
  expect([root.layers[0]!.x, root.layers[0]!.y]).toEqual([200, 150]);
  ui.down(300, 250);
  relayout();
  expect(root.layers).toHaveLength(0);
});

test("the pointer reaches overlay content first; empty space of a full overlay lets it through", () => {
  const log: string[] = [];
  const { root } = mount(() => (
    <Column>
      <Button label="embaixo" onClick={() => log.push("embaixo")} />
      <Overlay>
        <Box position="absolute" left={0} top={0} width={30} height={30} onClick={() => log.push("cima")} />
      </Overlay>
    </Column>
  ));
  const ui = interact(root);
  const below = findByText(root, "embaixo")!;
  ui.press(below);
  ui.release(below);
  ui.move(5, 5);
  ui.press(root.layers[0]!.children[0]!);
  ui.release(root.layers[0]!.children[0]!);
  expect(log).toEqual(["embaixo", "cima"]);
});

test("onDismiss: a press outside the overlay or Escape; a press inside does not", () => {
  let anchor!: ElementRef;
  let dismissed = 0;
  const { root } = mount(() => (
    <Column>
      <Box height={20} ref={(e) => (anchor = e)} />
      <Box height={200} />
      <Overlay anchor={() => anchor} onDismiss={() => dismissed++}>
        <Box width={50} height={50} />
      </Overlay>
    </Column>
  ));
  const ui = interact(root);
  ui.press(root.layers[0]!);
  expect(dismissed).toBe(0);
  ui.press(root.children[0]!.children[1]!);
  expect(dismissed).toBe(1);
  ui.key("Escape");
  expect(dismissed).toBe(2);
});

test("overlay content keeps context and inherited style from where it is declared, and goes away with it", () => {
  const Lang = createContext("pt");
  const [open, setOpen] = createSignal(true);
  function Label() {
    return <Text>{useContext(Lang)}</Text>;
  }
  const { root, relayout } = mount(() => (
    <Lang.Provider value="en">
      <Column color="#ff0000">
        <Show when={open}>
          <Overlay>
            <Label />
          </Overlay>
        </Show>
      </Column>
    </Lang.Provider>
  ));
  const text = drawCommands(root).find((c) => c.op === "text");
  expect(text).toMatchObject({ text: "en", color: [1, 0, 0, 1] });
  setOpen(false);
  relayout();
  expect(root.layers).toEqual([]);
  expect(drawCommands(root).filter((c) => c.op === "text")).toEqual([]);
});

test("a later overlay is drawn above an earlier one", () => {
  const [second, setSecond] = createSignal(false);
  const { root, relayout } = mount(() => (
    <Row>
      <Overlay>
        <Box background="#ff0000" height={10} />
      </Overlay>
      <Show when={second}>
        <Overlay>
          <Box background="#0000ff" height={10} />
        </Overlay>
      </Show>
    </Row>
  ));
  setSecond(true);
  relayout();
  const colors = drawCommands(root).flatMap((c) => (c.op === "rect" ? [c.color.join(",")] : []));
  expect(colors).toEqual(["1,0,0,1", "0,0,1,1"]);
});

test("a press on the anchor is not outside: the trigger toggles the overlay itself", () => {
  let anchor!: ElementRef;
  const [open, setOpen] = createSignal(true);
  const { root, relayout } = mount(() => (
    <Column align="start">
      <Button ref={(e) => (anchor = e)} label="menu" onClick={() => setOpen((o) => !o)} />
      <Show when={open}>
        <Overlay anchor={() => anchor} onDismiss={() => setOpen(false)}>
          <Box width={50} height={50} />
        </Overlay>
      </Show>
    </Column>
  ));
  relayout();
  const ui = interact(root);
  ui.press(anchor as never);
  ui.release(anchor as never);
  expect(open()).toBe(false);
});

test("a modal overlay blocks the pointer below it; a press on its backdrop is outside", () => {
  const log: string[] = [];
  const { root } = mount(() => (
    <Column>
      <Button label="embaixo" onClick={() => log.push("embaixo")} />
      <Overlay modal background="#00000059" align="center" justify="center" onDismiss={() => log.push("dismiss")}>
        <Box width={100} height={100} onClick={() => log.push("conteúdo")} />
      </Overlay>
    </Column>
  ));
  const ui = interact(root);
  const below = findByText(root, "embaixo")!;
  ui.press(below);
  ui.release(below);
  const content = root.layers[0]!.children[0]!;
  ui.press(content);
  ui.release(content);
  expect(log).toEqual(["dismiss", "conteúdo"]);
});

test("Tab stays inside the topmost modal overlay", () => {
  const { root } = mount(() => (
    <Column>
      <Button label="fora" />
      <Overlay modal>
        <Button label="a" />
        <Button label="b" />
      </Overlay>
    </Column>
  ));
  const ui = interact(root);
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    ui.key("Tab");
    seen.push(ui.focused!.children[0]!.label);
  }
  expect(seen).toEqual(['Text "a"', 'Text "b"', 'Text "a"']);
});

test("an anchored overlay with wrapping text is as tall as its lines at the width it gets", () => {
  let anchor!: ElementRef;
  const { root } = mount(() => (
    <Column>
      <Box position="absolute" left={0} top={0} width={60} height={20} ref={(e) => (anchor = e)} />
      <Overlay anchor={() => anchor} matchWidth offset={0}>
        <Text>aaa bbb ccc</Text>
      </Overlay>
    </Column>
  ));
  const layer = root.layers[0]!;
  expect([layer.width, layer.height]).toEqual([60, 40]);
});

test("a modal overlay with inset leaves that strip usable (a title bar): presses there reach it and do not dismiss", () => {
  const log: string[] = [];
  const { root, relayout } = mount(() => (
    <Column>
      <Box height={40} onClick={() => log.push("titlebar")} />
      <Overlay modal inset={[40, 0, 0, 0]} background="#00000080" onDismiss={() => log.push("dismiss")}>
        <Text>dialog</Text>
      </Overlay>
    </Column>
  ), { width: 300, height: 200 });
  relayout();
  const layer = root.layers[0]!;
  expect([layer.x, layer.y, layer.width, layer.height]).toEqual([0, 40, 300, 160]);
  const ui = interact(root);
  ui.down(150, 20);
  ui.up(150, 20);
  expect(log).toEqual(["titlebar"]);
  ui.down(150, 150); // the backdrop
  expect(log).toEqual(["titlebar", "dismiss"]);
});
