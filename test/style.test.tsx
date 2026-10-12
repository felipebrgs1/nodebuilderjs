import { expect, test } from "bun:test";
import { Box, Button, Column, Row, Show, Slider, Text, TextField, Toggle, createInteraction, createSignal, theme } from "@nodebuilderjs/core";
import type { UINode } from "@nodebuilderjs/core";
import { findByText, interact, mount } from "@nodebuilderjs/core/testing";
import { commandsOf, drawCommands } from "./helpers.js";

test("opacity multiplies the alpha of everything the subtree draws, nesting included", () => {
  const { root } = mount(() => (
    <Column>
      <Box opacity={0.5} background="#ff0000" borderWidth={1} borderColor="#00ff00">
        <Text color="#000000">a</Text>
        <Box opacity={0.5} background="#0000ff" height={10} />
      </Box>
      <Box background="#ff0000" height={10} />
    </Column>
  ));
  const rects = commandsOf(root, "rect");
  expect(rects.map((r) => r.color[3])).toEqual([0.5, 0.25, 1]);
  expect(rects[0]!.borderColor[3]).toBe(0.5);
  expect(commandsOf(root, "text")[0]!.color[3]).toBe(0.5);
});

test("opacity follows a signal; 0 draws nothing", () => {
  const [o, setO] = createSignal(1);
  const { root } = mount(() => <Box opacity={o} background="#ff0000" height={10} />);
  expect(commandsOf(root, "rect")[0]!.color[3]).toBe(1);
  setO(0);
  expect(commandsOf(root, "rect")).toEqual([]);
});

test("translate moves a node and its children after layout, without moving its siblings", () => {
  const { root } = mount(() => (
    <Row align="start" gap={10}>
      <Box width={50} height={20} translateX={5} translateY={7}>
        <Box width={10} height={10} />
      </Box>
      <Box width={50} height={20} />
    </Row>
  ));
  const [moved, sibling] = root.children[0]!.children;
  expect([moved!.x, moved!.y]).toEqual([5, 7]);
  expect([moved!.children[0]!.x, moved!.children[0]!.y]).toEqual([5, 7]);
  expect([sibling!.x, sibling!.y]).toEqual([60, 0]);
});

test("the pointer finds a translated node where it is drawn", () => {
  const log: string[] = [];
  const { root } = mount(() => (
    <Column align="start">
      <Box width={50} height={20} translateX={100} onPointerEnter={() => log.push("enter")} />
    </Column>
  ));
  const ui = interact(root);
  ui.move(10, 10); // where it would be without translate
  expect(log).toEqual([]);
  ui.move(120, 10);
  expect(log).toEqual(["enter"]);
});

test("an absolute child is painted and hit in child order: declared last, it is on top of its siblings", () => {
  const log: string[] = [];
  const { root } = mount(() => (
    <Column align="start">
      <Box width={100} height={100}>
        <Box position="absolute" left={0} top={0} width={50} height={50} background="#ff0000" onClick={() => log.push("first")} />
        <Box height={50} background="#00ff00" onClick={() => log.push("in flow")} />
        <Box position="absolute" left={60} top={0} width={30} height={30} background="#0000ff" onClick={() => log.push("last")} />
        <Box position="absolute" left={120} top={0} width={30} height={30} onClick={() => log.push("outside")} />
      </Box>
    </Column>
  ));
  expect(commandsOf(root, "rect").map((r) => r.color.join())).toEqual(["1,0,0,1", "0,1,0,1", "0,0,1,1"]);
  const ui = interact(root);
  for (const [x, y] of [[10, 10], [70, 10], [130, 10]] as const) (ui.down(x, y), ui.up(x, y));
  // The in-flow box covers the first one; the one outside its parent's box is drawn but not hit.
  expect(log).toEqual(["in flow", "last"]);
});

test("clip with radius clips children to the rounded inside of the border", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Box clip radius={12} borderWidth={2} borderColor="#000000" width={100} height={60}>
        <Box height={60} background="#ff0000" />
      </Box>
    </Column>
  ));
  expect(commandsOf(root, "clip")).toEqual([{ op: "clip", x: 2, y: 2, w: 96, h: 56, radius: 10 }]);
});

test("a shadow is drawn even without a background: the node's rounded box, blurred and offset by y", () => {
  const { root } = mount(() => (
    <Column align="start" padding={20}>
      <Box width={100} height={40} radius={8} shadow={{ color: "#00000080", blur: 12, y: 4 }} />
    </Column>
  ));
  const ops = drawCommands(root);
  expect(ops.map((c) => c.op)).toEqual(["shadow"]);
  expect(ops[0]).toMatchObject({ x: 20, y: 24, w: 100, h: 40, radius: 8, blur: 12 });
});

// hoverStyle / pressStyle / createInteraction. The pointer parks at (790, 590), outside every box.
const away = (ui: ReturnType<typeof interact>) => ui.move(790, 590);

test("hoverStyle applies while the pointer is over the widget; leaving restores the base", () => {
  let box!: UINode;
  const { root } = mount(() => (
    <Column align="start">
      <Box ref={(el) => (box = el as UINode)} width={100} height={40} background="#ff0000" hoverStyle={{ background: "#00ff00", radius: 8 }} />
    </Column>
  ));
  const ui = interact(root);
  expect([box.style.background, box.style.radius]).toEqual(["#ff0000", undefined]);
  ui.hover(box);
  expect([box.style.background, box.style.radius]).toEqual(["#00ff00", 8]);
  away(ui);
  expect([box.style.background, box.style.radius]).toEqual(["#ff0000", undefined]);
});

test("the base value stays reactive under hoverStyle, and so do the hover values", () => {
  let box!: UINode;
  const [base, setBase] = createSignal("#ff0000");
  const [hover, setHover] = createSignal("#00ff00");
  const { root } = mount(() => (
    <Column align="start">
      <Box ref={(el) => (box = el as UINode)} width={100} height={40} background={base} hoverStyle={{ background: hover }} />
    </Column>
  ));
  const ui = interact(root);
  setBase("#0000ff");
  expect(box.style.background).toBe("#0000ff");
  ui.hover(box);
  setBase("#ffff00"); // changes underneath while covered
  expect(box.style.background).toBe("#00ff00");
  setHover("#00ffff");
  expect(box.style.background).toBe("#00ffff");
  away(ui);
  expect(box.style.background).toBe("#ffff00");
});

test("pressStyle wins over hoverStyle while pressed", () => {
  let box!: UINode;
  const { root } = mount(() => (
    <Column align="start">
      <Box ref={(el) => (box = el as UINode)} width={100} height={40} background="#ff0000" opacity={1}
        hoverStyle={{ background: "#00ff00" }} pressStyle={{ background: "#0000ff", opacity: 0.8 }} />
    </Column>
  ));
  const ui = interact(root);
  ui.hover(box);
  ui.press(box);
  expect([box.style.background, box.style.opacity]).toEqual(["#0000ff", 0.8]);
  ui.release(box);
  expect([box.style.background, box.style.opacity]).toEqual(["#00ff00", 1]);
  away(ui);
  expect(box.style.background).toBe("#ff0000");
});

test("the user's own pointer handlers still run next to hoverStyle", () => {
  const log: string[] = [];
  let box!: UINode;
  const { root } = mount(() => (
    <Column align="start">
      <Box ref={(el) => (box = el as UINode)} width={100} height={40} hoverStyle={{ background: "#00ff00" }} pressStyle={{ background: "#0000ff" }}
        onPointerEnter={() => log.push("enter")} onPointerLeave={() => log.push("leave")}
        onPointerDown={() => log.push("down")} onPointerUp={() => log.push("up")} />
    </Column>
  ));
  const ui = interact(root);
  ui.hover(box);
  ui.press(box);
  expect(box.style.background).toBe("#0000ff");
  ui.release(box);
  away(ui);
  expect(log).toEqual(["enter", "down", "up", "leave"]);
});

test("a disabled widget ignores hoverStyle and pressStyle, also when disabled while hovered", () => {
  const [disabled, setDisabled] = createSignal(true);
  const { root } = mount(() => (
    <Column align="start">
      <Button label="Save" disabled={disabled} background="#ff0000" hoverStyle={{ background: "#00ff00" }} pressStyle={{ background: "#0000ff" }} />
    </Column>
  ));
  const button = findByText(root, "Save")!.parent!;
  const ui = interact(root);
  ui.hover(button);
  ui.press(button);
  expect(button.style.background).toBe("#ff0000");
  ui.release(button);
  setDisabled(false);
  expect(button.style.background).toBe("#00ff00");
  setDisabled(true);
  expect(button.style.background).toBe("#ff0000");
});

test("on a Button, hoverStyle wins over the theme's hover color; leaving gives the theme's colors back", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Button label="Save" hoverStyle={{ background: "#00ff00" }} />
      <Button label="Plain" />
    </Column>
  ));
  const button = findByText(root, "Save")!.parent!;
  const plain = findByText(root, "Plain")!.parent!;
  const ui = interact(root);
  ui.hover(button);
  expect(button.style.background).toBe("#00ff00");
  ui.press(button); // no pressStyle: the hover style stays, not the theme's pressed color
  expect(button.style.background).toBe("#00ff00");
  ui.release(button);
  away(ui);
  expect(button.style.background).toBe(theme.control.base);
  ui.hover(plain); // the theme's own hover still works without hoverStyle
  expect(plain.style.background).toBe(theme.control.hover);
});

test("pressStyle works on controls that handle the press themselves", () => {
  const [value, setValue] = createSignal(0.5);
  const [text, setText] = createSignal("");
  const [on, setOn] = createSignal(false);
  const style = { background: "#0000ff" };
  const { root } = mount(() => (
    <Column align="start" gap={10}>
      <Slider ariaLabel="slider" value={value} onChange={setValue} width={200} pressStyle={style} />
      <TextField ariaLabel="field" value={text} onInput={setText} width={200} pressStyle={style} />
      <Toggle ariaLabel="toggle" checked={on} onChange={setOn} pressStyle={style} />
    </Column>
  ));
  const ui = interact(root);
  for (const node of root.children[0]!.children) {
    ui.press(node);
    expect([node.ariaLabel, node.style.background]).toEqual([node.ariaLabel, "#0000ff"]);
    ui.release(node);
  }
});

test("createInteraction: a child shows while the pointer is anywhere over the card", () => {
  const card = createInteraction();
  let box!: UINode;
  const { root, relayout } = mount(() => (
    <Column align="start">
      <Box ref={(el) => (box = el as UINode)} {...card.props} width={200} height={100} background={() => (card.hovered() ? "#eeeeee" : "#ffffff")}>
        <Text>Song</Text>
        <Show when={card.hovered}>
          <Button label="Play" />
        </Show>
      </Box>
    </Column>
  ));
  const ui = interact(root);
  expect(findByText(root, "Play")).toBeUndefined();
  ui.hover(box);
  relayout();
  expect(box.style.background).toBe("#eeeeee");
  const play = findByText(root, "Play")!;
  ui.hover(play); // over the child, the card is still hovered
  ui.press(play);
  expect([card.hovered(), findByText(root, "Play")]).toEqual([true, play]);
  ui.release(play);
  away(ui);
  expect([card.hovered(), findByText(root, "Play")]).toEqual([false, undefined]);
});

test("createInteraction props add to the user's handlers, written before or after the spread", () => {
  const log: string[] = [];
  const card = createInteraction();
  const { root } = mount(() => (
    <Row align="start">
      <Box onPointerEnter={() => log.push(`before ${card.hovered()}`)} {...card.props} width={50} height={50} />
      <Box {...card.props} onPointerEnter={() => log.push(`after ${card.hovered()}`)} width={50} height={50} />
    </Row>
  ));
  const [first, second] = root.children[0]!.children;
  const ui = interact(root);
  ui.hover(first!);
  ui.hover(second!);
  expect(log).toEqual(["before true", "after true"]);
});

test("createInteraction on a widget that tracks its own hover: both work, and so do two interactions", () => {
  const a = createInteraction();
  const b = createInteraction();
  const { root } = mount(() => (
    <Column align="start">
      <Button label="Save" {...a.props} {...b.props} />
    </Column>
  ));
  const button = findByText(root, "Save")!.parent!;
  const ui = interact(root);
  ui.hover(button);
  expect([a.hovered(), b.hovered(), button.style.background]).toEqual([true, true, theme.control.hover]);
  ui.press(button);
  expect([a.pressed(), button.style.background]).toEqual([true, theme.control.pressed]);
  ui.release(button);
  expect(a.pressed()).toBe(false);
  ui.key("Tab");
  expect([a.focused(), b.focused()]).toEqual([true, true]);
});

test("hoverStyle alone does not claim the press: no pointer down/up handlers (window drag regions keep working)", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Box width={50} height={50} hoverStyle={{ background: "#00ff00" }} />
      <Box width={50} height={50} pressStyle={{ background: "#00ff00" }} />
    </Column>
  ));
  const [hoverOnly, pressing] = root.children[0]!.children;
  expect([hoverOnly!.handlers.onPointerDown, hoverOnly!.handlers.onPointerUp]).toEqual([undefined, undefined]);
  expect(typeof pressing!.handlers.onPointerDown).toBe("function");
});
