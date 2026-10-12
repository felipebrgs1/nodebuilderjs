import { beforeEach, describe, expect, test } from "bun:test";
import {
  Box, Button, Column, Row, Scroll, Text, TextField, UINode, Window, WindowControls, createRoot, createSignal, debugTree, layout, setTextMeasurer,
} from "@nodebuilderjs/core";
import type { PointerEvent } from "@nodebuilderjs/core";
import { insert } from "@nodebuilderjs/core/jsx-runtime";
import { interact, mount } from "@nodebuilderjs/core/testing";
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
    toggleMaximize() { host.calls.push("toggleMaximize"); },
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

const center = (n: UINode): [number, number] => [n.x + n.width / 2, n.y + n.height / 2];

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

  test("pointerdown bubbles past a clickable node (a row's context menu), but only it clicks", () => {
    const { root, input } = setup(() => (
      <Box width={100} height={100} onPointerDown={(e: PointerEvent) => log.push(`list ${e.button}`)} onClick={() => log.push("click list")}>
        <Button label="row" onClick={() => log.push("click row")} />
      </Box>
    ));
    const row = root.children[0]!.children[0]!;
    input.pointerDown(...center(row), 2); // right button: the list opens its menu
    input.pointerUp(...center(row), 2);
    now += 1000;
    input.pointerDown(...center(row), 0);
    input.pointerUp(...center(row), 0);
    expect(log).toEqual(["list 2", "list 0", "click row"]);
  });

  test("stop() in a clickable node's onPointerDown keeps the press from its parents", () => {
    const { root, input } = setup(() => (
      <Box width={100} height={100} onPointerDown={() => log.push("outer")}>
        <Box width={50} height={50} onPointerDown={(e: PointerEvent) => e.stop()} onClick={() => log.push("click row")} />
      </Box>
    ));
    const row = root.children[0]!.children[0]!;
    input.pointerDown(...center(row), 0);
    input.pointerUp(...center(row), 0);
    expect(log).toEqual(["click row"]);
  });

  test("pressStyle on a parent shows while a child button is pressed (like CSS :active)", () => {
    const { root, input } = setup(() => (
      <Box width={100} height={100} pressStyle={{ background: "#222222" }}>
        <Button label="row" onClick={() => {}} />
      </Box>
    ));
    const card = root.children[0]!;
    input.pointerDown(...center(card.children[0]!), 0);
    expect(card.style.background).toBe("#222222");
    input.pointerUp(...center(card.children[0]!), 0);
    expect(card.style.background).not.toBe("#222222");
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

  test("title bars move the window, a double click toggles maximize; window borders resize it", () => {
    const { input, host } = setup(() => <Window title="t"><Text>x</Text></Window>, { resizable: true });
    input.pointerDown(100, 20, 0);
    input.pointerDown(150, 100, 0); // content: no move
    input.pointerDown(1, 100, 0); // left border
    input.pointerDown(299, 199, 0); // bottom right corner
    now += 1000;
    input.pointerDown(100, 20, 0);
    now += 100;
    input.pointerDown(100, 20, 0);
    expect(host.calls).toEqual(["move", "resize 4", "resize 10", "move", "toggleMaximize"]);
  });

  test("clickable nodes inside a drag region never move the window", () => {
    const { input, host } = setup(() => <Window title="t"><Text>x</Text></Window>);
    const close = input.hitTest(285, 23);
    expect(close?.label).toBe("WindowButton(close)");
    input.pointerDown(285, 23, 0);
    expect(host.calls).toEqual([]);
  });
});

describe("custom title bar", () => {
  const [query, setQuery] = createSignal("");
  // A header row merged with the title bar: search field, a button, window controls.
  const header = () => (
    <Window title="t" decorations={false}>
      <Row dragRegion height={40} align="center" gap={8} padding={[0, 8]}>
        <Text>App</Text>
        <TextField width={100} value={query} onInput={setQuery} />
        <Button label="Go" onClick={() => log.push("go")} />
        <Box grow={1} height={40} />
        <WindowControls gap={4} />
      </Row>
      <Text>body</Text>
    </Window>
  );
  const find = (root: UINode, label: string): UINode => {
    if (root.label === label || root.label.startsWith(`${label} `)) return root;
    for (const c of root.children) {
      try { return find(c, label); } catch {}
    }
    throw new Error(`no ${label}`);
  };

  test("decorations={false} has no built-in title bar or divider", () => {
    const { root } = setup(() => <Window title="t" decorations={false}><Text>body</Text></Window>);
    const tree = debugTree(root);
    expect(tree).not.toContain("Titlebar");
    expect(tree).not.toContain("Divider");
    expect(tree).toContain('Text "body"');
    // The content starts right below the border.
    expect(find(root, "Text").y).toBe(1);
    expect(setup(() => <Window title="t"><Text>body</Text></Window>).root.children[0]!.children[0]!.label).toBe("Titlebar");
  });

  test("borders still resize a window without decorations", () => {
    const { input, host } = setup(() => <Window title="t" decorations={false}><Text>body</Text></Window>, { resizable: true });
    input.pointerDown(1, 100, 0);
    expect(host.calls).toEqual(["resize 4"]);
  });

  test("a dragRegion moves the window from its empty space and from plain text", () => {
    const { root, input, host } = setup(header);
    input.pointerDown(...center(find(root, "Text")), 0);
    now += 1000;
    input.pointerDown(...center(find(root, "Box")), 0); // the spacer
    expect(host.calls).toEqual(["move", "move"]);
  });

  test("a double click on a dragRegion toggles maximize instead of moving", () => {
    const { root, input, host } = setup(header);
    const spacer = center(find(root, "Box"));
    input.pointerDown(...spacer, 0);
    now += 100;
    input.pointerDown(...spacer, 0);
    expect(host.calls).toEqual(["move", "toggleMaximize"]);
  });

  test("a press on a control inside a dragRegion never moves the window", () => {
    const { root, input, host } = setup(header);
    for (const label of ["TextField", "Button", "WindowButton(minimize)", "WindowButton(maximize)", "WindowButton(close)"]) {
      now += 1000;
      const node = find(root, label);
      let hit = input.hitTest(...center(node));
      while (hit && hit !== node) hit = hit.parent;
      expect(hit).toBe(node);
      input.pointerDown(...center(node), 0);
      input.pointerUp(...center(node), 0);
    }
    expect(host.calls).toEqual([]);
    expect(log).toEqual(["go"]);
  });

  test("only the left button drags", () => {
    const { root, input, host } = setup(header);
    input.pointerDown(...center(find(root, "Box")), 2);
    expect(host.calls).toEqual([]);
  });

  test("a node with its own press handler or focus inside a dragRegion keeps the press", () => {
    const { root, input, host } = setup(() => (
      <Row dragRegion height={40}>
        <Box width={40} onPointerDown={() => log.push("down")} />
        <Box width={40} ref={(el) => ((el as UINode).focusable = true)} />
        <Box width={40} />
      </Row>
    ));
    const [a, b, c] = root.children[0]!.children;
    for (const n of [a!, b!, c!]) {
      now += 1000;
      input.pointerDown(...center(n), 0);
    }
    expect(log).toEqual(["down"]);
    expect(host.calls).toEqual(["move"]);
  });

  test("a hoverStyle child keeps dragging the window; a pressStyle child keeps the press", () => {
    const { root, input, host } = setup(() => (
      <Row dragRegion height={40}>
        <Box width={40} hoverStyle={{ background: "#111111" }} />
        <Box width={40} pressStyle={{ background: "#222222" }} />
      </Row>
    ));
    const [hover, press] = root.children[0]!.children;
    input.pointerDown(...center(hover!), 0);
    now += 1000;
    input.pointerDown(...center(press!), 0);
    expect(host.calls.filter((c) => c === "move")).toEqual(["move"]);
    expect(press!.style.background).toBe("#222222");
  });

  test("the press still bubbles past a control to the dragRegion's own handler, without moving", () => {
    const { root, input, host } = setup(() => (
      <Row dragRegion height={40} onPointerDown={() => log.push("row")}>
        <Box width={40} onPointerDown={() => log.push("inner")} />
      </Row>
    ));
    input.pointerDown(...center(root.children[0]!.children[0]!), 0);
    expect(log).toEqual(["inner", "row"]);
    expect(host.calls).toEqual([]);
  });

  test("WindowControls labels its buttons and takes style props", () => {
    const { root } = setup(() => <WindowControls gap={20} />);
    const controls = root.children[0]!;
    expect(controls.children.map((n) => n.ariaLabel)).toEqual(["Minimize", "Maximize", "Close"]);
    expect(controls.children[1]!.x - controls.children[0]!.x).toBe(26 + 20);
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

describe("stacking (zIndex) and overflow", () => {
  // An absolute box declared first, (0,0) 60x60, overlapping an in-flow sibling (0,0) 100x40.
  const stacked = (z?: number) => () => (
    <Box width={100} height={100} align="start">
      <Box position="absolute" left={0} top={0} width={60} height={60} zIndex={z} {...track("abs")} onPointerDown={() => log.push("down abs")} />
      <Box width={100} height={40} {...track("flow")} onPointerDown={() => log.push("down flow")} />
    </Box>
  );

  test("with equal zIndex, the later sibling is on top", () => {
    const { input } = setup(stacked());
    input.pointerDown(10, 10, 0);
    expect(log).toEqual(["down flow"]);
  });

  test("a higher zIndex is hit first, where it is painted above its siblings", () => {
    const { input } = setup(stacked(1));
    input.pointerDown(10, 10, 0);
    input.pointerDown(80, 10, 0); // only the in-flow box is there
    expect(log).toEqual(["down abs", "down flow"]);
  });

  test("hover enters and leaves the topmost sibling", () => {
    const { input } = setup(stacked(1));
    input.pointerMove(10, 10);
    input.pointerMove(80, 10);
    input.pointerMove(10, 50); // below the in-flow box, on the raised one
    expect(log).toEqual(["enter abs", "leave abs", "enter flow", "leave flow", "enter abs"]);
  });

  // A card at (20,20) 100x50 with a badge at (110,10) 20x20: its top right part sticks out.
  const card = (clip: boolean) => () => (
    <Column padding={20} align="start">
      <Box width={100} height={50} clip={clip} {...track("card")} onPointerDown={() => log.push("down card")}>
        <Box position="absolute" left={90} top={-10} width={20} height={20} {...track("badge")} onPointerDown={() => log.push("down badge")} />
      </Box>
    </Column>
  );

  test("the part of an absolute child outside a parent that does not clip is clickable", () => {
    const { input } = setup(card(false));
    input.pointerMove(125, 15); // outside the card, on the badge
    expect(log).toEqual(["enter card", "enter badge"]); // the card contains the badge, as in CSS
    log = [];
    input.pointerDown(125, 15, 0);
    expect(log).toEqual(["down badge", "down card"]); // bubbling still follows the tree
    log = [];
    input.pointerMove(30, 30);
    expect(log).toEqual(["leave badge"]);
  });

  test("with clip, the part outside the parent is not clickable", () => {
    const { input } = setup(card(true));
    input.pointerDown(125, 15, 0);
    expect(log).toEqual([]);
    input.pointerDown(115, 25, 0); // inside the card, on the badge
    expect(log).toEqual(["down badge", "down card"]);
  });

  test("the testing helpers reach a node shown outside a parent that does not clip", () => {
    let badge!: UINode;
    const { root } = mount(() => (
      <Column padding={20} align="start">
        <Box width={100} height={50}>
          <Box ref={(n) => (badge = n as UINode)} position="absolute" left={95} top={-20} width={10} height={10}
            onPointerDown={() => log.push("down badge")} />
        </Box>
      </Column>
    ));
    interact(root).press(badge); // its center (120,5) is outside the card
    expect(log).toEqual(["down badge"]);
  });
});
