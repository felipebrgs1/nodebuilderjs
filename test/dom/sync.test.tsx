// The DOM renderer's sync against a fake document: elements per node, CSS diffed, children
// moved instead of recreated, boxes read back, text and fields, overlays, canvases, focus.
import { afterEach, describe, expect, test } from "bun:test";
import { Box, Button, Canvas, Checkbox, Column, For, Overlay, Row, Scroll, Show, Slider, Text, TextField, UINode, createRoot, createSignal } from "@nodebuilderjs/core";
import type { Child, ElementRef } from "@nodebuilderjs/core";
import { insert } from "@nodebuilderjs/core/jsx-runtime";
import { type CanvasPainter, createDomRenderer } from "../../src/dom/sync.js";
import { createInput } from "../../src/runtime/input.js";
import { setNativeText } from "../../src/runtime/platform.js";
import { setTextMeasurer } from "../../src/render/node.js";
import { type FakeElement, fakeContainer } from "./fake-dom.js";

setTextMeasurer((text) => ({ width: text.length * 8, ascent: 15, descent: 5 }));
afterEach(() => setNativeText(false));

function recordingPainter() {
  const calls: string[] = [];
  const painter: CanvasPainter = {
    opacity: 1,
    begin: (_c, x, y, scale) => void calls.push(`begin ${x},${y} x${scale}`),
    rect: (x, y, w, h, color) => void calls.push(`rect ${x},${y} ${w}x${h} ${color}`),
    shadow() {}, text() {}, image() {}, line() {}, triangles() {}, arc() {}, clip() {}, unclip() {},
  };
  return { painter, calls };
}

function setup(view: () => Child) {
  const { doc, container, el } = fakeContainer();
  const { painter, calls } = recordingPainter();
  const renderer = createDomRenderer(el, { painter, scale: () => 2 });
  const root = new UINode("root");
  root.isRoot = true;
  let dispose = () => {};
  createRoot((d) => {
    dispose = d;
    insert(root, view);
  });
  const render = () => renderer.render(root);
  render();
  const elementOf = (n: UINode) => renderer.elementOf(n) as unknown as FakeElement;
  return { doc, container, root, renderer, render, paints: calls, elementOf, dispose, top: () => container.children[0]! };
}

describe("tree", () => {
  test("one element per node, in child order, with its CSS", () => {
    const { top } = setup(() => (
      <Column gap={4}>
        <Box width={10} />
        <Text>hi</Text>
      </Column>
    ));
    const column = top();
    expect(column.className).toBe("nb");
    expect(column.style.props.get("gap")).toBe("4px");
    expect(column.children.map((c) => c.className)).toEqual(["nb", "nb nb-text"]);
    expect(column.children[0]!.style.props.get("width")).toBe("10px");
    expect(column.children[1]!.textContent).toBe("hi");
  });

  test("<For> moves the elements of reordered items instead of recreating them", () => {
    const [items, setItems] = createSignal(["a", "b", "c"]);
    const { top, render, doc } = setup(() => <Column><For each={items}>{(item) => <Text>{item}</Text>}</For></Column>);
    const before = [...top().children];
    const created = doc.created;
    setItems(["c", "a", "b"]);
    render();
    expect(top().children.map((c) => c.textContent)).toEqual(["c", "a", "b"]);
    expect(top().children).toEqual([before[2]!, before[0]!, before[1]!]);
    expect(doc.created).toBe(created);
  });

  test("only the properties that changed are written", () => {
    const [color, setColor] = createSignal("#ff0000");
    const { top, render } = setup(() => <Box width={10} height={10} padding={4} background={color} />);
    const style = top().style;
    const writes = style.writes;
    render();
    expect(style.writes).toBe(writes);
    setColor("#00ff00");
    render();
    expect(style.writes).toBe(writes + 1);
    expect(style.props.get("background")).toBe("#00ff00");
  });

  test("a style that goes away is removed", () => {
    const [width, setWidth] = createSignal<number | undefined>(10);
    const { top, render } = setup(() => <Box width={() => width()!} />);
    setWidth(undefined);
    render();
    expect(top().style.props.has("width")).toBe(false);
  });

  test("disposed nodes leave the DOM", () => {
    const [shown, setShown] = createSignal(true);
    const { top, render } = setup(() => <Column><Show when={shown}><Text>gone</Text></Show><Text>stays</Text></Column>);
    setShown(false);
    render();
    expect(top().children.map((c) => c.textContent)).toEqual(["stays"]);
  });
});

describe("boxes", () => {
  test("are read back into the nodes in window coordinates (from the container's corner)", () => {
    const { container, root, render, elementOf } = setup(() => <Column><Box /></Column>);
    container.rect = { left: 100, top: 50, width: 400, height: 300 };
    const column = root.children[0]!, box = column.children[0]!;
    elementOf(column).rect = { left: 100, top: 50, width: 400, height: 300 };
    elementOf(box).rect = { left: 110, top: 60, width: 40, height: 20 };
    render();
    expect([root.width, root.height]).toEqual([400, 300]);
    expect([box.x, box.y, box.width, box.height]).toEqual([10, 10, 40, 20]);
  });

  test("onResize gets the size the browser gave, once per change", () => {
    const sizes: string[] = [];
    const { root, render, elementOf } = setup(() => <Box onResize={(s) => sizes.push(`${s.width}x${s.height}`)} />);
    elementOf(root.children[0]!).rect = { left: 0, top: 0, width: 40, height: 20 };
    render();
    render();
    expect(sizes).toEqual(["0x0", "40x20"]);
  });

  test("a Scroll: the app's scrollTo is written, a scroll by the user is read back", () => {
    let scroller!: ElementRef;
    const { root, render, elementOf } = setup(() => <Scroll ref={(r) => (scroller = r)} height={100}><Box height={400} /></Scroll>);
    const node = root.children[0]!;
    const el = elementOf(node);
    el.scrollHeight = 400;
    scroller.scrollTo(120);
    render();
    expect(el.scrollTop).toBe(120);
    el.scrollTop = 200; // the user scrolled
    render();
    expect([node.scrollY, node.contentHeight]).toEqual([200, 400]);
  });

  test("what holds a Scroll may shrink below the Scroll's content, as in the native layout", () => {
    const { top } = setup(() => (
      <Row>
        <Column width={100}><Text>fixed</Text></Column>
        <Column grow={1}><Scroll horizontal><Box width={2000} /></Scroll></Column>
        <Column><Text>plain</Text></Column>
      </Row>
    ));
    const [, holder, plain] = top().children;
    expect(holder!.style.props.get("min-width")).toBe("0px");
    expect(plain!.style.props.has("min-width")).toBe(false);
  });

  test("scrollIntoView() asks the element", () => {
    let target!: ElementRef;
    const { render, elementOf } = setup(() => <Scroll height={100}><Box height={400} /><Box ref={(r) => (target = r)} height={20} /></Scroll>);
    target.scrollIntoView();
    render();
    expect(elementOf(target as UINode).revealed).toBe(1);
  });
});

describe("text", () => {
  test("Text: line height from the font (as on the desktop), wrapping, lines, alignment, selection", () => {
    const { top } = setup(() => (
      <Column>
        <Text lineHeight={1.5}>a</Text>
        <Text wrap={false}>b</Text>
        <Text maxLines={1}>c</Text>
        <Text maxLines={3} textAlign="center" selectable>d</Text>
      </Column>
    ));
    const [a, b, c, d] = top().children.map((n) => n.style.props);
    expect(a!.get("line-height")).toBe("30px"); // (15 + 5) * 1.5
    expect(b!.get("white-space")).toBe("pre");
    expect([c!.get("white-space"), c!.get("text-overflow")]).toEqual(["pre", "ellipsis"]);
    expect([d!.get("-webkit-line-clamp"), d!.get("text-align")]).toEqual(["3", "center"]);
    expect(top().children[3]!.classList.contains("nb-selectable")).toBe(true);
  });

  test("a reactive Text rewrites its text only when it changes", () => {
    const [n, setN] = createSignal(1);
    const { top, render } = setup(() => <Text>{() => `count ${n()}`}</Text>);
    setN(2);
    render();
    expect(top().textContent).toBe("count 2");
  });

  test("TextField is an <input>: value, placeholder, password; what is typed goes to onInput, not back", () => {
    setNativeText(true);
    const [value, setValue] = createSignal("hi");
    const [secret, setSecret] = createSignal(false);
    const { root, render, renderer } = setup(() => <TextField value={value} onInput={setValue} placeholder="Name" password={secret} />);
    const input = renderer.inputOf(root.children[0]!) as unknown as FakeElement;
    expect(input.tagName).toBe("input");
    expect(input.value).toBe("hi");
    expect(input.attributes.get("placeholder")).toBe("Name");
    expect(input.attributes.get("type")).toBe("text");
    input.value = "hi!";
    input.dispatch("input");
    expect(value()).toBe("hi!");
    let written = 0;
    Object.defineProperty(input, "value", { get: () => "hi!", set: () => void written++ });
    render();
    expect(written).toBe(0); // the caret stays where the user put it
    setSecret(true);
    render();
    expect(input.attributes.get("type")).toBe("password");
  });

  test("a value the app sets is written to the <input>", () => {
    setNativeText(true);
    const [value, setValue] = createSignal("a");
    const { root, render, renderer } = setup(() => <TextField value={value} onInput={setValue} />);
    setValue("reset");
    render();
    expect((renderer.inputOf(root.children[0]!) as unknown as FakeElement).value).toBe("reset");
  });
});

describe("painted and measured nodes", () => {
  test("a node with paint gets a canvas, drawn in window coordinates with a margin around the box", () => {
    const { root, render, elementOf, paints } = setup(() => (
      <Canvas width={40} height={20} draw={(g) => g.rect(0, 0, 40, 20, "#ff0000")} />
    ));
    const node = root.children[0]!;
    elementOf(node).rect = { left: 30, top: 10, width: 40, height: 20 };
    paints.length = 0;
    render();
    expect(paints).toEqual(["begin 22,2 x2", "rect 30,10 40x20 #ff0000"]);
    const canvas = elementOf(node).children[0]!;
    expect(canvas.className).toBe("nb-canvas");
    expect([canvas.width, canvas.height]).toEqual([112, 72]); // (40 + 16) * 2, (20 + 16) * 2
  });

  test("a node with measure gets a hidden sizer of its measured size", () => {
    const measuredNode = () => {
      const n = new UINode("Measured");
      n.measure = () => ({ width: 120, height: 30 });
      return n;
    };
    const { root, elementOf } = setup(measuredNode);
    const sizer = elementOf(root.children[0]!).findAll("nb-sizer")[0]!;
    expect([sizer.style.props.get("width"), sizer.style.props.get("height")]).toEqual(["120px", "30px"]);
  });

  test("a measured node whose height follows its width is sized at the width it got", () => {
    const { root, render, elementOf } = setup(() => <Canvas padding={5} measure={(w) => w / 2} draw={() => {}} />);
    const node = root.children[0]!;
    elementOf(node).rect = { left: 0, top: 0, width: 210, height: 0 };
    render();
    const sizer = elementOf(node).findAll("nb-sizer")[0]!;
    expect(sizer.style.props.get("height")).toBe("100px");
    expect(elementOf(node).style.props.get("min-width")).toBe("10px"); // it may narrow to its padding
  });
});

describe("overlays", () => {
  test("layers go in the root after the tree; a covering one fills the window inside its inset", () => {
    const { container, root } = setup(() => (
      <Column>
        <Text>page</Text>
        <Overlay inset={[10, 0, 0, 0]}><Text>over</Text></Overlay>
      </Column>
    ));
    expect(root.layers).toHaveLength(1);
    const layer = container.children[1]!;
    expect(layer.textContent).toBe("over");
    expect(["position", "left", "top", "right", "bottom"].map((k) => layer.style.props.get(k))).toEqual(["absolute", "0px", "10px", "0px", "0px"]);
  });

  test("the pointer goes through a covering layer's empty space (not a modal's: its backdrop takes it)", () => {
    const { container } = setup(() => (
      <Column>
        <Overlay><Text>toast</Text></Overlay>
        <Overlay modal><Text>dialog</Text></Overlay>
      </Column>
    ));
    const [covering, modal] = [container.children[1]!, container.children[2]!];
    expect(covering.style.props.get("pointer-events")).toBe("none");
    expect(covering.classList.contains("nb-pass")).toBe(true);
    expect(modal.style.props.has("pointer-events")).toBe(false);
  });

  test("an anchored layer is placed below its anchor once the boxes are read (flipping when it does not fit)", () => {
    let anchor!: ElementRef;
    const { container, root, render, elementOf } = setup(() => (
      <Column>
        <Box ref={(r) => (anchor = r)} width={50} height={20} />
        <Overlay anchor={() => anchor} offset={4}><Text>menu</Text></Overlay>
      </Column>
    ));
    elementOf(anchor as UINode).rect = { left: 20, top: 30, width: 50, height: 20 };
    const layer = root.layers[0]!;
    elementOf(layer).rect = { left: 0, top: 0, width: 80, height: 40 };
    render();
    const el = container.children[1]!;
    expect([el.style.props.get("left"), el.style.props.get("top")]).toEqual(["20px", "54px"]);
    expect(el.style.props.get("width")).toBe("max-content");
  });

  test("a layer inherits the text style of where it is declared, not of the root", () => {
    const { container } = setup(() => (
      <Column color="#ff0000" fontSize={20} bold>
        <Overlay><Text>over</Text></Overlay>
      </Column>
    ));
    const layer = container.children[1]!.style.props;
    expect([layer.get("color"), layer.get("font-size"), layer.get("font-weight")]).toEqual(["#ff0000", "20px", "700"]);
  });
});

describe("focus", () => {
  test("the element of the focused node gets the DOM focus (an <input> for a field)", () => {
    setNativeText(true);
    const [value, setValue] = createSignal("");
    const { doc, root, render, renderer, elementOf } = setup(() => (
      <Column>
        <Box focusable />
        <TextField value={value} onInput={setValue} />
      </Column>
    ));
    const input = createInput(root, {
      size: () => ({ width: 400, height: 300 }), resizable: () => false, setCursor() {}, move() {}, toggleMaximize() {}, resize() {}, invalidate() {}, now: () => 0,
    });
    const [box, field] = root.children[0]!.children;
    expect(elementOf(box!).attributes.get("tabindex")).toBe("-1");
    root.focusHost!.setFocus(box!);
    render();
    expect(doc.activeElement).toBe(elementOf(box!));
    input.keyDown({ key: "Tab", text: "", ctrl: false, shift: false, alt: false, repeat: false });
    render();
    expect(doc.activeElement).toBe(renderer.inputOf(field!) as unknown as FakeElement);
    root.focusHost!.setFocus(null);
    render();
    expect(doc.activeElement).toBe(doc.body);
  });

  test("hitTest: the node of the element under a window point", () => {
    const { doc, container, root, renderer, elementOf } = setup(() => <Column><Box /></Column>);
    container.rect = { left: 10, top: 20, width: 400, height: 300 };
    const box = root.children[0]!.children[0]!;
    doc.hit = elementOf(box);
    expect(renderer.hitTest(5, 5)).toBe(box);
    expect(doc.pointsAsked).toEqual(["15,25"]);
    doc.hit = null;
    expect(renderer.hitTest(5, 5)).toBe(null);
  });

  test("nodeAt finds the node of an event target, from a child element too", () => {
    setNativeText(true);
    const [value, setValue] = createSignal("");
    const { root, renderer } = setup(() => <TextField value={value} onInput={setValue} />);
    const field = root.children[0]!;
    expect(renderer.nodeAt(renderer.inputOf(field) as unknown as Node)).toBe(field);
  });
});

describe("semantics", () => {
  test("roles and states become ARIA attributes, kept up to date", () => {
    const [on, setOn] = createSignal(false);
    const { root, render, elementOf } = setup(() => (
      <Column>
        <Checkbox checked={on} onChange={setOn} label="Done" />
        <Button label="Go" disabled={on} onClick={() => {}} />
        <Slider value={() => 30} onChange={() => {}} min={10} max={50} />
      </Column>
    ));
    const [checkbox, button, slider] = root.children[0]!.children.map(elementOf);
    expect([checkbox!.attributes.get("role"), checkbox!.attributes.get("aria-checked")]).toEqual(["checkbox", "false"]);
    expect(button!.attributes.get("role")).toBe("button");
    expect(button!.attributes.has("aria-disabled")).toBe(false);
    expect(["aria-valuenow", "aria-valuemin", "aria-valuemax"].map((k) => slider!.attributes.get(k))).toEqual(["30", "10", "50"]);
    setOn(true);
    render();
    expect(checkbox!.attributes.get("aria-checked")).toBe("true");
    expect(button!.attributes.get("aria-disabled")).toBe("true");
  });

  test("a label for assistive technology", () => {
    const { top } = setup(() => <Box ariaLabel="Close" />);
    expect(top().attributes.get("aria-label")).toBe("Close");
  });
});
