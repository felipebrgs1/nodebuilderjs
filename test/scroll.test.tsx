import { describe, expect, test } from "bun:test";
import { Box, Button, Column, ErrorBoundary, For, Index, Overlay, Row, Scroll, Show, Text, TextField, createSignal, theme } from "@nodebuilderjs/core";
import type { ElementRef } from "@nodebuilderjs/core";
import { interact, mount } from "@nodebuilderjs/core/testing";
import { commandsOf, drawCommands } from "./helpers.js";

describe("horizontal scroll", () => {
  test("children keep their width and fill the height; the content is as wide as all of them", () => {
    const { root } = mount(() => (
      <Column align="start">
        <Scroll horizontal width={100} height={50} gap={10}>
          {Array.from({ length: 5 }, () => <Box width={40} />)}
        </Scroll>
      </Column>
    ));
    const scroller = root.children[0]!.children[0]!;
    expect(scroller.children.map((c) => [c.x, c.width, c.height])).toEqual([[0, 40, 50], [50, 40, 50], [100, 40, 50], [150, 40, 50], [200, 40, 50]]);
    expect(scroller.contentWidth).toBe(240);
  });

  test("scrollX moves the children left, clamped to the content", () => {
    const { root, relayout } = mount(() => (
      <Column align="start">
        <Scroll horizontal width={100} height={50}>
          {Array.from({ length: 5 }, () => <Box width={40} />)}
        </Scroll>
      </Column>
    ));
    const scroller = root.children[0]!.children[0]!;
    scroller.scrollX = 30;
    relayout();
    expect(scroller.children[0]!.x).toBe(-30);
    scroller.scrollX = 1000;
    relayout();
    expect(scroller.scrollX).toBe(100); // 200 - 100
  });

  test("text inside does not wrap: it has all the width it wants", () => {
    const { root } = mount(() => (
      <Column align="start">
        <Scroll horizontal width={100} height={50}>
          <Text>uma frase com várias palavras</Text>
        </Scroll>
      </Column>
    ));
    const text = root.children[0]!.children[0]!.children[0]!;
    expect([text.width, text.height]).toEqual([29 * 8, 50]);
  });

  test("culling also works across: columns outside the visible width are skipped", () => {
    const { root, relayout } = mount(() => (
      <Column align="start">
        <Scroll horizontal width={100} height={30}>
          <For each={Array.from({ length: 50 }, (_, i) => `c${i}`)}>{(t) => <Column width={40}><Text>{t}</Text></Column>}</For>
        </Scroll>
      </Column>
    ));
    const scroller = root.children[0]!.children[0]!;
    expect(commandsOf(scroller, "text").map((t) => t.text)).toEqual(["c0", "c1", "c2"]);
    scroller.scrollX = 410;
    relayout();
    expect(scroller.children[10]!.culled).toBe(false);
    expect(scroller.children[10]!.children[0]!.x).toBe(-10); // placed again when it comes into view
    expect(commandsOf(scroller, "text").map((t) => t.text)).toEqual(["c10", "c11", "c12"]);
  });
});

describe("minimum sizes", () => {
  test("a horizontal Scroll's content sets no minimum width: a column holding it shrinks in a row", () => {
    const { root } = mount(() => (
      <Row>
        <Box width={100} />
        <Column grow={1}>
          <Text>título</Text>
          <Scroll horizontal height={50}>
            <Box width={1000} />
          </Scroll>
        </Column>
      </Row>
    ), { width: 300, height: 200 });
    const column = root.children[0]!.children[1]!;
    expect([column.x, column.width]).toEqual([100, 200]);
    expect(column.children[1]!.width).toBe(200);
  });

  test("a horizontal Scroll keeps its height in a column that shrinks: only vertical scrolling gives up height", () => {
    const { root } = mount(() => (
      <Column>
        <Scroll horizontal>
          <Box width={1000} height={60} />
        </Scroll>
        <Scroll grow={1}>
          <Box height={1000} />
        </Scroll>
      </Column>
    ), { width: 300, height: 200 });
    const [strip, list] = root.children[0]!.children;
    expect([strip!.height, list!.height]).toEqual([60, 140]);
  });

  test("a Scroll's content does not hold its containers open: a column around it shrinks without minHeight", () => {
    const { root } = mount(() => (
      <Column>
        <Box height={50} />
        <Column grow={1}>
          <Text>título</Text>
          <Scroll grow={1}>
            <Box height={1000} />
          </Scroll>
        </Column>
      </Column>
    ), { width: 300, height: 200 });
    const outer = root.children[0]!;
    const inner = outer.children[1]!;
    const list = inner.children[1]!;
    expect([outer.height, inner.height, list.height, list.contentHeight]).toEqual([200, 150, 130, 1000]);
  });
});

describe("both axes", () => {
  test("children are at least as wide as the view, wider when their content needs it", () => {
    const { root } = mount(() => (
      <Column align="start">
        <Scroll horizontal vertical width={100} height={100}>
          <Box width={300} height={300} />
          <Text>palavras que quebram na largura</Text>
        </Scroll>
      </Column>
    ));
    const scroller = root.children[0]!.children[0]!;
    const [wide, text] = scroller.children;
    expect(wide!.width).toBe(300);
    expect(text!.width).toBe(100); // wraps at the visible width
    expect(text!.height).toBe(60); // 3 lines
    expect([scroller.contentWidth, scroller.contentHeight]).toEqual([300, 360]);
  });
});

describe("wheel", () => {
  const strip = () => (
    <Scroll height={100}>
      <Scroll horizontal height={50}>
        {Array.from({ length: 20 }, () => <Box width={100} />)}
      </Scroll>
      <Box height={500} />
    </Scroll>
  );

  test("dx scrolls the nearest horizontal scroll, dy the nearest vertical one", () => {
    const { root } = mount(strip, { width: 300, height: 200 });
    const [page] = root.children;
    const row = page!.children[0]!;
    const ui = interact(root);
    ui.scroll(row, 30, { dx: 40 });
    expect([row.scrollX, page!.scrollY]).toEqual([40, 30]);
  });

  test("Shift turns the vertical wheel into horizontal scrolling", () => {
    const { root } = mount(strip, { width: 300, height: 200 });
    const [page] = root.children;
    const row = page!.children[0]!;
    interact(root).scroll(row, 30, { shift: true });
    expect([row.scrollX, page!.scrollY]).toEqual([30, 0]);
  });
});

// A 300x100 Scroll over 500 px of content: the vertical bar's strip is x 286..300 (8 px of
// hover width plus 3 px margins); the thumb runs on y 3..97 and is 24 px long (its minimum).
const list = () => (
  <Scroll height={100}>
    <Box height={500} cursor="text" />
  </Scroll>
);

/** Rects drawn after the content (the scrollbars). */
const bars = (node: Parameters<typeof commandsOf>[0]) => {
  const all = drawCommands(node);
  return all.slice(all.findLastIndex((c) => c.op === "unclip") + 1).filter((c) => c.op === "rect");
};
/** A #rrggbbaa color as the decoded command has it. */
const rgba = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (shift: number) => Math.round((((n >>> shift) & 255) / 255) * 1000) / 1000;
  return [c(24), c(16), c(8), c(0)] as [number, number, number, number];
};

describe("scrollbars", () => {
  test("a thin thumb on the right shows where the view is; none when everything fits", () => {
    const { root, relayout } = mount(list, { width: 300, height: 200 });
    const scroller = root.children[0]!;
    expect(bars(scroller).map((r) => [r.x, r.y, r.w, r.h, r.radius])).toEqual([[293, 3, 4, 24, 2]]);
    expect(bars(scroller)[0]!.color).toEqual(rgba(theme.scrollbar.thumb));
    scroller.scrollTo(400);
    relayout();
    expect(bars(scroller)[0]!.y).toBe(73); // at the end of the track

    const { root: short } = mount(() => <Scroll height={100}><Box height={50} /></Scroll>);
    expect(bars(short.children[0]!)).toEqual([]);
  });

  test("a horizontal scroll has its bar at the bottom; with both, the bars leave the corner free", () => {
    const { root } = mount(() => (
      <Column align="start">
        <Scroll horizontal width={100} height={50}>
          <Box width={400} />
        </Scroll>
        <Scroll horizontal vertical width={100} height={100}>
          <Box width={400} height={400} />
        </Scroll>
      </Column>
    ));
    const [row, both] = root.children[0]!.children;
    expect(bars(row!).map((r) => [r.x, r.y, r.w, r.h])).toEqual([[3, 43, 24, 4]]);
    // In the second Scroll (at y 50), each track stops 14 px before the corner: y 53..133, x 3..83.
    expect(bars(both!).map((r) => [r.x, r.y, r.w, r.h])).toEqual([[93, 53, 4, 24], [3, 143, 24, 4]]);
  });

  test("dragging the thumb scrolls in proportion, even when the pointer leaves the bar", () => {
    let moves = 0;
    const { root } = mount(() => (
      <Scroll height={100}>
        <Box height={500} onPointerMove={() => moves++} />
      </Scroll>
    ), { width: 300, height: 200 });
    const scroller = root.children[0]!;
    const ui = interact(root);
    ui.down(295, 10);
    ui.move(295, 45); // 35 of the 70 px the thumb can travel
    expect(scroller.scrollY).toBe(200);
    ui.move(50, 190);
    expect(scroller.scrollY).toBe(400);
    ui.up(50, 190);
    ui.move(50, 50);
    expect(scroller.scrollY).toBe(400);
    expect(moves).toBe(1); // only the last move, after the release
  });

  test("a press on the track pages toward it", () => {
    const { root } = mount(list, { width: 300, height: 200 });
    const scroller = root.children[0]!;
    const ui = interact(root);
    ui.down(295, 80);
    ui.up(295, 80);
    expect(scroller.scrollY).toBe(88); // 87.5% of the 100 px view
    scroller.scrollTo(300);
    ui.down(295, 5);
    ui.up(295, 5);
    expect(scroller.scrollY).toBe(212);
  });

  test("the bar takes presses from the content only while there is something to scroll", () => {
    const log: string[] = [];
    const { root } = mount(() => (
      <Column>
        <Scroll height={100}>
          <Box height={500} onPointerDown={() => log.push("long")} />
        </Scroll>
        <Scroll height={100}>
          <Box height={50} onPointerDown={() => log.push("short")} />
        </Scroll>
      </Column>
    ), { width: 300, height: 200 });
    const ui = interact(root);
    ui.down(295, 50);
    ui.up(295, 50);
    ui.down(200, 50);
    ui.up(200, 50);
    ui.down(295, 120);
    ui.up(295, 120);
    expect(log).toEqual(["long", "short"]);
  });

  test("under the pointer the thumb widens and darkens, with the default cursor; pressed, darker still", () => {
    const { root } = mount(list, { width: 300, height: 200 });
    const scroller = root.children[0]!;
    const ui = interact(root);
    ui.move(200, 50);
    expect(ui.cursor).toBe("text");
    ui.move(295, 50);
    expect(ui.cursor).toBe("default");
    const [track, thumb] = bars(scroller);
    expect([track!.x, track!.y, track!.w, track!.h, track!.color]).toEqual([289, 3, 8, 94, rgba(theme.scrollbar.track)]);
    expect([thumb!.x, thumb!.w, thumb!.color]).toEqual([289, 8, rgba(theme.scrollbar.hover)]);
    ui.down(295, 10);
    expect(bars(scroller)[1]!.color).toEqual(rgba(theme.scrollbar.pressed));
    ui.up(295, 10);
    ui.move(200, 50);
    expect(bars(scroller).map((r) => r.w)).toEqual([4]);
  });

  test("pressing a scrollbar keeps the keyboard focus where it was", () => {
    const [name, setName] = createSignal("");
    const { root } = mount(() => (
      <Column>
        <TextField value={name} onInput={setName} />
        <Scroll height={100}>
          <Box height={500} />
        </Scroll>
      </Column>
    ), { width: 300, height: 200 });
    const ui = interact(root);
    const field = root.children[0]!.children[0]!;
    ui.press(field);
    ui.down(295, 60);
    ui.up(295, 60);
    expect(ui.focused).toBe(field);
  });

  test("a horizontal bar is dragged sideways", () => {
    const { root } = mount(() => (
      <Column align="start">
        <Scroll horizontal width={100} height={50}>
          <Box width={400} />
        </Scroll>
      </Column>
    ));
    const scroller = root.children[0]!.children[0]!;
    const ui = interact(root);
    ui.down(10, 45);
    ui.move(40, 45); // 30 of the 70 px the thumb can travel, for 300 px of content
    ui.up(40, 45);
    expect(Math.round(scroller.scrollX)).toBe(129);
  });
});

describe("keyboard", () => {
  // A button (36 px) inside a 100 px tall Scroll over 520 px of content (range 420).
  const page = () => (
    <Scroll height={100}>
      <Button label="topo" />
      <Box height={484} />
    </Scroll>
  );

  test("PageUp/PageDown, Home/End and the arrows scroll the Scroll around the focused element", () => {
    const { root } = mount(page, { width: 300, height: 200 });
    const scroller = root.children[0]!;
    const ui = interact(root);
    ui.key("Tab");
    const seen: number[] = [];
    for (const key of ["Next", "Next", "Prior", "End", "Home", "Down", "Down", "Up", "KP_Next", "Page_Down"]) {
      ui.key(key);
      seen.push(scroller.scrollY);
    }
    expect(seen).toEqual([88, 176, 88, 420, 0, 40, 80, 40, 128, 216]);
  });

  test("left and right scroll sideways; page keys go to the nearest vertical Scroll", () => {
    const { root } = mount(() => (
      <Scroll height={100}>
        <Scroll horizontal height={50}>
          <Button label="a" />
          <Box width={1000} />
        </Scroll>
        <Box height={500} />
      </Scroll>
    ), { width: 300, height: 200 });
    const outer = root.children[0]!;
    const row = outer.children[0]!;
    const ui = interact(root);
    ui.key("Tab");
    ui.key("Right");
    ui.key("Right");
    ui.key("Left");
    ui.key("Next");
    expect([row.scrollX, outer.scrollY]).toEqual([40, 88]);
  });

  test("Home/End in a Scroll that only goes sideways reach its start and end", () => {
    const { root } = mount(() => (
      <Scroll horizontal height={50}>
        <Button label="a" />
        <Box width={1000} />
      </Scroll>
    ), { width: 300, height: 200 });
    const row = root.children[0]!;
    const ui = interact(root);
    ui.key("Tab");
    ui.key("End");
    expect(row.scrollX).toBe(row.contentWidth - 300);
    ui.key("Home");
    expect(row.scrollX).toBe(0);
  });

  test("keys a TextField handles stay in it (Home, End, Left); Up and Down scroll", () => {
    const [text, setText] = createSignal("abc");
    const { root } = mount(() => (
      <Scroll height={100}>
        <TextField value={text} onInput={setText} />
        <Box height={500} />
      </Scroll>
    ), { width: 300, height: 200 });
    const scroller = root.children[0]!;
    const ui = interact(root);
    ui.key("Tab");
    ui.key("Home");
    ui.type("x");
    ui.key("End");
    ui.key("Left");
    ui.type("y");
    expect(text()).toBe("xabyc");
    expect(scroller.scrollY).toBe(0);
    ui.key("Down");
    expect(scroller.scrollY).toBe(40);
  });

  test("a handler's stop() keeps the key from scrolling", () => {
    const { root } = mount(() => (
      <Scroll height={100} onKeyDown={(e) => e.stop()}>
        <Button label="a" />
        <Box height={500} />
      </Scroll>
    ), { width: 300, height: 200 });
    const ui = interact(root);
    ui.key("Tab");
    ui.key("Next");
    expect(root.children[0]!.scrollY).toBe(0);
  });

  test("without focus, the keys scroll the Scroll under the pointer", () => {
    const { root } = mount(() => (
      <Column>
        <Scroll height={100}><Box height={500} /></Scroll>
        <Scroll height={100}><Box height={500} /></Scroll>
      </Column>
    ), { width: 300, height: 200 });
    const [first, second] = root.children[0]!.children;
    const ui = interact(root);
    ui.key("Next");
    expect([first!.scrollY, second!.scrollY]).toEqual([0, 0]);
    ui.move(100, 150);
    ui.key("Next");
    expect([first!.scrollY, second!.scrollY]).toEqual([0, 88]);
  });
});

describe("with overlays", () => {
  test("a Scroll inside an overlay takes the wheel; what is behind stays put", () => {
    let anchor: ElementRef | undefined;
    const { root } = mount(() => (
      <Scroll height={200}>
        <Box ref={(e) => (anchor = e)} height={20} />
        <Box height={1000} />
        <Overlay anchor={() => anchor} matchWidth offset={0}>
          <Scroll height={100}>
            <Box height={400} />
          </Scroll>
        </Overlay>
      </Scroll>
    ), { width: 300, height: 200 });
    const page = root.children[0]!;
    const list = root.layers[0]!.children[0]!;
    interact(root).scroll(list, 50);
    expect([list.scrollY, page.scrollY]).toEqual([50, 0]);
  });

  test("pressing a scrollbar outside a dropdown closes it, and still scrolls", () => {
    const [open, setOpen] = createSignal(true);
    let anchor: ElementRef | undefined;
    const { root, relayout } = mount(() => (
      <Scroll height={200}>
        <Box ref={(e) => (anchor = e)} width={100} height={20} />
        <Box height={1000} />
        <Show when={open}>
          <Overlay anchor={() => anchor} onDismiss={() => setOpen(false)}>
            <Box width={100} height={50} />
          </Overlay>
        </Show>
      </Scroll>
    ), { width: 300, height: 200 });
    const page = root.children[0]!;
    const ui = interact(root);
    ui.down(295, 150);
    ui.up(295, 150);
    relayout();
    expect([open(), page.scrollY]).toEqual([false, 175]);
  });
});

describe("with a modal open", () => {
  test("the wheel, the keys and the scrollbar do not reach the Scroll behind it", () => {
    const [open, setOpen] = createSignal(false);
    const { root, relayout } = mount(() => (
      <Scroll height={200}>
        <Button label="atrás" />
        <Box height={1000} />
        <Show when={open}>
          <Overlay modal background="#00000059">
            <Box height={50} />
          </Overlay>
        </Show>
      </Scroll>
    ), { width: 300, height: 200 });
    const scroller = root.children[0]!;
    const ui = interact(root);
    ui.key("Tab"); // the focus stays behind when the modal opens
    setOpen(true);
    relayout();
    ui.move(100, 100);
    ui.scroll(scroller, 30);
    expect(scroller.scrollY).toBe(0);
    ui.key("Next");
    expect(scroller.scrollY).toBe(0);
    ui.down(295, 150);
    ui.up(295, 150);
    expect(scroller.scrollY).toBe(0);
    setOpen(false);
    relayout();
    ui.key("Next");
    expect(scroller.scrollY).toBe(175); // closed: the keys reach it again
  });
});

describe("with control flow", () => {
  test("scrollIntoView reaches a row that <Index> added after the list grew", () => {
    const [items, setItems] = createSignal(Array.from({ length: 5 }, (_, i) => `linha ${i}`));
    const rows: ElementRef[] = [];
    const { root, relayout } = mount(() => (
      <Scroll height={100}>
        <Index each={items}>{(item, i) => <Box ref={(el) => (rows[i] = el)} height={40}><Text>{item}</Text></Box>}</Index>
      </Scroll>
    ));
    setItems(Array.from({ length: 50 }, (_, i) => `linha ${i}`));
    relayout();
    rows[40]!.scrollIntoView();
    relayout();
    const scroller = root.children[0]!;
    expect(scroller.scrollY).toBe(40 * 40 + 40 - 100);
    expect(rows[40]!.y + rows[40]!.height).toBe(100);
  });

  test("an ErrorBoundary inside a Scroll swaps the rows for its fallback, and the scroll extent follows", () => {
    const [broken, setBroken] = createSignal(false);
    function Row40() {
      return <Box height={40}><Text>{() => { if (broken()) throw new Error("falhou"); return "ok"; }}</Text></Box>;
    }
    const { root, relayout } = mount(() => (
      <Scroll height={100}>
        <ErrorBoundary fallback={(err) => <Text>{`erro: ${(err as Error).message}`}</Text>}>
          {Array.from({ length: 10 }, () => <Row40 />)}
        </ErrorBoundary>
      </Scroll>
    ));
    const scroller = root.children[0]!;
    expect(scroller.contentHeight).toBe(400);
    setBroken(true);
    relayout();
    expect(scroller.contentHeight).toBe(20);
    expect(commandsOf(scroller, "text").map((t) => t.text)).toEqual(["erro: falhou"]);
  });
});
