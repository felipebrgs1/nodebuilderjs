import { beforeEach, describe, expect, test } from "bun:test";
import { Box, Button, Column, Row, Scroll, Text, UINode, Window, createRoot, layout, setTextMeasurer } from "@nodebuilderjs/core";
import type { PointerEvent } from "@nodebuilderjs/core";
import { insert } from "@nodebuilderjs/core/jsx-runtime";
import { createInput } from "../src/runtime/input.js";

setTextMeasurer((text) => ({ width: text.length * 8, ascent: 15, descent: 5 }));

let log: string[];
let now: number;
beforeEach(() => {
  log = [];
  now = 1000;
});

function setup(view: () => any, options: { resizable?: boolean } = {}) {
  const root = new UINode("root");
  root.isRoot = true;
  createRoot(() => insert(root, view));
  layout(root, 300, 200);
  const host = {
    cursor: "",
    calls: [] as string[],
    size: () => ({ width: 300, height: 200 }),
    resizable: () => options.resizable ?? false,
    setCursor(name: string) { host.cursor = name; },
    move() { host.calls.push("move"); },
    resize(edges: number) { host.calls.push(`resize ${edges}`); },
    invalidate() { host.calls.push("invalidate"); },
    now: () => now,
  };
  return { root, host, input: createInput(root, host) };
}

const track = (name: string) => ({
  onPointerEnter: () => log.push(`enter ${name}`),
  onPointerLeave: () => log.push(`leave ${name}`),
});

// A at (0,0) 100x50 with B inside it at (0,0) 50x20; C at (0,50) 100x50.
const tree = () => (
  <Column align="start">
    <Box width={100} height={50} cursor="pointer" {...track("A")} onClick={(e: PointerEvent) => log.push(`click A ${e.clicks}`)}>
      <Box width={50} height={20} {...track("B")} onPointerDown={() => log.push("down B")} />
    </Box>
    <Box width={100} height={50} cursor="text" {...track("C")} onPointerDown={() => log.push("down C")} />
  </Column>
);

describe("hover and cursor", () => {
  test("enter outer to inner, leave what the pointer left", () => {
    const { input } = setup(tree);
    input.pointerMove(10, 10);
    expect(log).toEqual(["enter A", "enter B"]);
    log = [];
    input.pointerMove(80, 30);
    expect(log).toEqual(["leave B"]);
    log = [];
    input.pointerLeave();
    expect(log).toEqual(["leave A"]);
  });

  test("refreshing hover with nothing changed does not ask for a frame", () => {
    // run() calls refreshHover() inside every frame: an invalidate here redraws forever.
    const { input, host } = setup(tree);
    input.refreshHover();
    input.pointerMove(10, 10);
    input.refreshHover();
    input.pointerLeave();
    input.refreshHover();
    expect(host.calls).toEqual([]);
  });

  test("the cursor comes from the nearest node that sets one", () => {
    const { input, host } = setup(tree);
    input.pointerMove(10, 10);
    expect(host.cursor).toBe("pointer"); // B has none, A has "pointer"
    input.pointerMove(10, 60);
    expect(host.cursor).toBe("text");
    input.pointerMove(200, 150);
    expect(host.cursor).toBe("default");
  });

  test("window borders show resize cursors when the window is resizable", () => {
    const fixed = setup(tree);
    fixed.input.pointerMove(299, 100);
    expect(fixed.host.cursor).toBe("default");
    const { input, host } = setup(tree, { resizable: true });
    input.pointerMove(299, 100);
    expect(host.cursor).toBe("e-resize");
    input.pointerMove(299, 199);
    expect(host.cursor).toBe("se-resize");
    input.pointerMove(2, 2);
    expect(host.cursor).toBe("nw-resize");
  });

  test("refreshHover picks up nodes that moved under a still pointer", () => {
    const { root, input } = setup(tree);
    input.pointerMove(10, 60); // over C
    expect(log).toEqual(["enter C"]);
    log = [];
    root.children[0]!.children[0]!.style.height = 100; // A grows over the pointer
    layout(root, 300, 200);
    input.refreshHover();
    expect(log).toEqual(["leave C", "enter A"]);
  });
});

describe("pointer buttons", () => {
  test("a click is a press and a release on the same clickable", () => {
    const { input } = setup(tree);
    input.pointerDown(10, 10, 0);
    input.pointerUp(12, 12, 0);
    expect(log).toEqual(["down B", "click A 1"]);
    log = [];
    input.pointerDown(10, 10, 0);
    input.pointerUp(10, 60, 0); // released elsewhere
    input.pointerDown(10, 60, 0);
    input.pointerUp(10, 10, 0); // pressed elsewhere
    expect(log).toEqual(["down B", "down C"]);
  });

  test("double clicks count within 400 ms and 4 px", () => {
    const { input } = setup(tree);
    const clickAt = (x: number, t: number) => {
      now = t;
      input.pointerDown(x, 30, 0);
      input.pointerUp(x, 30, 0);
    };
    clickAt(60, 1000);
    clickAt(61, 1200);
    clickAt(61, 1700); // too late
    clickAt(70, 1800); // too far
    expect(log).toEqual(["click A 1", "click A 2", "click A 1", "click A 1"]);
  });

  test("only the left button clicks", () => {
    const { input } = setup(tree);
    input.pointerDown(60, 30, 2);
    input.pointerUp(60, 30, 2);
    expect(log).toEqual([]);
  });

  test("pointerdown bubbles from the innermost node and stop() ends it", () => {
    const { input } = setup(() => (
      <Box width={100} height={100} onPointerDown={() => log.push("outer")}>
        <Box width={50} height={50} onPointerDown={(e: PointerEvent) => (log.push("inner"), e.stop())} />
      </Box>
    ));
    input.pointerDown(10, 10, 0);
    input.pointerDown(80, 80, 0);
    expect(log).toEqual(["inner", "outer"]);
  });

  test("pressing focuses the nearest focusable; pressing elsewhere blurs it", () => {
    const { input } = setup(() => (
      <Column align="start">
        <Button label="ok" onClick={() => {}} />
        <Box width={50} height={50} />
      </Column>
    ));
    input.pointerDown(5, 5, 0);
    expect(input.focused?.label).toBe("Button");
    input.pointerDown(5, 60, 0);
    expect(input.focused).toBeNull();
  });

  test("title bars move the window; window borders resize it", () => {
    const { input, host } = setup(() => <Window title="t"><Text>x</Text></Window>, { resizable: true });
    input.pointerDown(100, 20, 0);
    input.pointerDown(150, 100, 0); // content: no move
    input.pointerDown(1, 100, 0); // left border
    input.pointerDown(299, 199, 0); // bottom right corner
    expect(host.calls).toEqual(["move", "resize 4", "resize 10"]);
  });

  test("clickable nodes inside a drag region never move the window", () => {
    const { input, host } = setup(() => <Window title="t"><Text>x</Text></Window>);
    const close = input.hitTest(285, 23);
    expect(close?.label).toBe("WindowButton(close)");
    input.pointerDown(285, 23, 0);
    expect(host.calls).toEqual([]);
  });
});

describe("scrolling", () => {
  const view = () => (
    <Scroll height={100} onScroll={() => log.push("scroll")}>
      <Box height={500} />
    </Scroll>
  );

  test("the nearest scrollable takes the wheel, clamped to its content", () => {
    const { root, input, host } = setup(view);
    const scroller = root.children[0]!;
    input.scroll(10, 10, 0, 30);
    expect(scroller.scrollY).toBe(30);
    input.scroll(10, 10, 0, -100);
    expect(scroller.scrollY).toBe(0);
    input.scroll(10, 10, 0, 1000);
    expect(scroller.scrollY).toBe(400);
    expect(host.calls).toEqual(["invalidate", "invalidate", "invalidate"]);
    expect(log).toEqual(["scroll", "scroll", "scroll"]);
  });

  test("onScroll can stop the wheel", () => {
    const { root, input } = setup(() => (
      <Scroll height={100}>
        <Box height={500} onScroll={(e) => e.stop()} />
      </Scroll>
    ));
    input.scroll(10, 10, 0, 30);
    expect(root.children[0]!.scrollY).toBe(0);
  });

  test("nodes scrolled out of view are not hit", () => {
    const { root, input } = setup(() => (
      <Scroll height={100}>
        <Box height={50} onPointerDown={() => log.push("first")} />
        <Box height={50} onPointerDown={() => log.push("second")} />
        <Box height={400} />
      </Scroll>
    ));
    root.children[0]!.scrollY = 50;
    layout(root, 300, 200);
    input.pointerDown(10, 10, 0);
    expect(log).toEqual(["second"]);
  });
});

describe("keyboard", () => {
  const view = () => (
    <Row>
      <Button label="a" onClick={() => log.push("a")} />
      <Button label="b" onClick={() => log.push("b")} />
      <Button label="c" onClick={() => log.push("c")} />
    </Row>
  );
  const key = (k: string, extra: Partial<{ text: string; shift: boolean; ctrl: boolean }> = {}) => ({
    key: k, text: extra.text ?? "", ctrl: extra.ctrl ?? false, shift: extra.shift ?? false, alt: false, repeat: false,
  });

  test("Tab and Shift+Tab move focus in tree order, wrapping around", () => {
    const { input } = setup(view);
    input.keyDown(key("Tab"));
    input.keyDown(key("Return"));
    input.keyDown(key("Tab"));
    input.keyDown(key("Return"));
    input.keyDown(key("ISO_Left_Tab", { shift: true }));
    input.keyDown(key("ISO_Left_Tab", { shift: true }));
    input.keyDown(key("Return"));
    expect(log).toEqual(["a", "b", "c"]);
  });

  test("keys bubble from the focused node; control characters never reach text", () => {
    const seen: string[] = [];
    const { input } = setup(() => (
      <Box width={100} height={100} onKeyDown={(e) => seen.push(JSON.stringify(e.text))}>
        <Button label="x" onClick={() => {}} />
      </Box>
    ));
    input.pointerDown(5, 5, 0); // focus the button
    input.keyDown(key("a", { text: "a" }));
    input.keyDown(key("BackSpace", { text: "\b" }));
    input.keyDown(key("c", { text: "c", ctrl: true }));
    expect(seen).toEqual(['"a"', '""', '""']);
  });
});

describe("pointer move", () => {
  const moves = (name: string) => (e: PointerEvent) => log.push(`${name} ${e.localX},${e.localY} (${e.x},${e.y}) b${e.button}`);
  // outer at (20,20) 100x100 with inner at (30,30) 40x40 (outer has padding 10).
  const view = () => (
    <Box position="absolute" left={20} top={20} width={100} height={100} padding={10} align="start" onPointerMove={moves("outer")}>
      <Box width={40} height={40} onPointerMove={moves("inner")} />
    </Box>
  );

  test("positions local to each handling node, innermost first", () => {
    const { input } = setup(view);
    input.pointerMove(35, 40);
    expect(log).toEqual(["inner 5,10 (35,40) b-1", "outer 15,20 (35,40) b-1"]);
    log = [];
    input.pointerMove(100, 100); // outer only
    expect(log).toEqual(["outer 80,80 (100,100) b-1"]);
    log = [];
    input.pointerMove(5, 5); // nothing listens here
    expect(log).toEqual([]);
  });

  test("stop() keeps outer nodes from seeing the move", () => {
    const { input } = setup(() => (
      <Box width={100} height={100} onPointerMove={() => log.push("outer")}>
        <Box width={50} height={50} onPointerMove={(e: PointerEvent) => (log.push("inner"), e.stop())} />
      </Box>
    ));
    input.pointerMove(10, 10);
    expect(log).toEqual(["inner"]);
  });

  test("while pressed, moves keep going to where the press started (dragging)", () => {
    const { input } = setup(view);
    input.pointerDown(35, 40, 0);
    input.pointerMove(200, 150); // far outside both boxes
    expect(log).toEqual(["inner 170,120 (200,150) b0", "outer 180,130 (200,150) b0"]);
    log = [];
    input.pointerUp(200, 150, 0);
    input.pointerMove(200, 150); // released: back to hit testing, nobody there
    expect(log).toEqual([]);
  });

  test("press, release and click events have local positions too", () => {
    const seen: string[] = [];
    const { input } = setup(() => (
      <Box position="absolute" left={50} top={60} width={40} height={40}
        onPointerDown={(e: PointerEvent) => seen.push(`down ${e.localX},${e.localY}`)}
        onPointerUp={(e: PointerEvent) => seen.push(`up ${e.localX},${e.localY}`)}
        onClick={(e: PointerEvent) => seen.push(`click ${e.localX},${e.localY}`)} />
    ));
    input.pointerDown(55, 70, 0);
    input.pointerUp(58, 71, 0);
    expect(seen).toEqual(["down 5,10", "up 8,11", "click 8,11"]);
  });
});
