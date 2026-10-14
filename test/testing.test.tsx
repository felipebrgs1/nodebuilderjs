import { describe, expect, test } from "bun:test";
import { Box, Button, Canvas, Column, Dialog, For, Overlay, Row, Scroll, Text, TextField, Tooltip, Window, createSignal } from "@nodebuilderjs/core";
import type { PointerEvent } from "@nodebuilderjs/core";
import {
  canUseRealTextMetrics, click, findAllByLabel, findAllByText, findAllByValue, findByLabel, findByPlaceholder, findByText, findByValue, interact, mount,
  shownText, useFakeTextMetrics, useRealTextMetrics,
} from "@nodebuilderjs/core/testing";

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

test("interact: every call on the same root shares one pointer and one focus, like the real window", () => {
  const log: string[] = [];
  const { root } = mount(() => (
    <Column align="start">
      <Button label="Salvar" onClick={() => log.push("click")} />
      <TextField value={() => ""} onInput={() => {}} placeholder="Nome" />
    </Column>
  ));
  const label = findByText(root, "Salvar")!;
  interact(root).press(label);
  interact(root).release(label);
  expect(log).toEqual(["click"]);
  const field = findByPlaceholder(root, "Nome")!;
  interact(root).press(field);
  expect(interact(root).focused).toBe(field);
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

describe("node helpers refuse targets the user could not reach", () => {
  // Chips 100 px wide in a 300 px panel: Funk (300..400) touches the edge, Soul (400..500) is culled.
  const genres = ["Rock", "Jazz", "Pop", "Funk", "Soul"];
  const chips = (log: string[]) => (
    <For each={genres}>{(genre) => <Button label={genre} width={100} onClick={() => log.push(genre)} />}</For>
  );

  test("a culled node (or inside one): the interact helpers and click throw, naming it and the fix", () => {
    const log: string[] = [];
    const { root } = mount(() => (
      <Column align="start">
        <Row width={300} clip>{chips(log)}</Row>
      </Column>
    ));
    const soul = findByText(root, "Soul")!;
    const ui = interact(root);
    const attempts = [
      () => ui.hover(soul),
      () => ui.press(soul),
      () => ui.release(soul),
      () => ui.drag(soul, 10, 0),
      () => ui.scroll(soul, 10),
      () => click(soul),
    ];
    for (const attempt of attempts) expect(attempt).toThrow(/Text "Soul".*culled.*scrollIntoView/s);
    expect(log).toEqual([]);
  });

  test("a node whose center is outside a clipping ancestor: the error names the ancestor", () => {
    const log: string[] = [];
    const { root } = mount(() => (
      <Column align="start">
        <Row width={300} clip>{chips(log)}</Row>
      </Column>
    ));
    // The Button sits on the edge, so it is laid out (its padded label is already culled).
    const funk = findByText(root, "Funk")!.parent!;
    expect(funk.culled).toBe(false);
    expect(() => interact(root).press(funk)).toThrow(/^Button cannot be reached: .*\(350, \d+.*clipped by Row \[0,0 300x\d+\]/s);
    expect(() => click(funk)).toThrow(/clipped by Row/);
    expect(log).toEqual([]);
  });

  test("the window clips too", () => {
    const { root } = mount(() => (
      <Column align="start">
        <Box height={590} />
        <Button label="Below" onClick={() => {}} />
      </Column>
    ), { width: 800, height: 600 });
    const below = findByText(root, "Below")!;
    expect(() => interact(root).press(below.parent!)).toThrow(/^Button cannot be reached: .*clipped by the window/);
    expect(() => interact(root).press(below)).toThrow(/clipped by the window/); // its top shows, its center does not
  });

  test("after scrollIntoView() and relayout() the same node is clickable", () => {
    const log: string[] = [];
    const { root, relayout } = mount(() => (
      <Column align="start">
        <Scroll horizontal width={300}>{chips(log)}</Scroll>
      </Column>
    ));
    const soul = findByText(root, "Soul")!;
    expect(() => click(soul)).toThrow(/culled/);
    soul.scrollIntoView();
    relayout();
    click(soul);
    interact(root).press(findByText(root, "Soul")!);
    expect(log).toEqual(["Soul"]);
  });

  test("a partly clipped node with its center in view still works", () => {
    const log: string[] = [];
    const { root } = mount(() => (
      <Column align="start">
        <Row width={280} clip>{chips(log)}</Row>
      </Column>
    ));
    const ui = interact(root);
    const pop = findByText(root, "Pop")!; // 200..300 inside 280: center 250 is visible
    ui.press(pop);
    ui.release(pop);
    click(pop);
    expect(log).toEqual(["Pop", "Pop"]);
  });

  test("window positions are not checked: down/up at a clipped point just miss", () => {
    const log: string[] = [];
    const { root } = mount(() => (
      <Column align="start">
        <Row width={300} clip>{chips(log)}</Row>
      </Column>
    ));
    const ui = interact(root);
    ui.down(450, 10);
    ui.up(450, 10);
    expect(log).toEqual([]);
  });
});

test("findAllByText returns every match, in tree order", () => {
  const { root } = mount(() => (
    <Column>
      <Text>Play</Text>
      <Text>Pause</Text>
      <Button label="Play" />
    </Column>
  ));
  expect(findAllByText(root, "Play")).toHaveLength(2);
  expect(findAllByText(root, /^P/).map((n) => n.label)).toEqual(['Text "Play"', 'Text "Pause"', 'Text "Play"']);
  expect(findAllByText(root, "Stop")).toEqual([]);
});

describe("ariaLabel", () => {
  test("any widget takes one; findByLabel finds it (string or RegExp) and it can be clicked", () => {
    const log: string[] = [];
    const { root } = mount(() => (
      <Row>
        <Button ariaLabel="Previous" onClick={() => log.push("previous")} />
        <Button ariaLabel="Play" onClick={() => log.push("play")} width={40} height={40} />
        <Box ariaLabel="Cover" width={40} height={40} />
        <Text ariaLabel="Elapsed">1:02</Text>
      </Row>
    ));
    click(findByLabel(root, "Play")!);
    const ui = interact(root);
    ui.press(findByLabel(root, /^prev/i)!);
    ui.release(findByLabel(root, /^prev/i)!);
    expect(log).toEqual(["play", "previous"]);
    expect(findByLabel(root, "Cover")!.label).toBe("Box");
    expect(findAllByLabel(root, /e/).map((n) => n.ariaLabel)).toEqual(["Previous", "Cover", "Elapsed"]);
    expect(findByLabel(root, "Stop")).toBeUndefined();
  });

  test("a reactive ariaLabel follows its signal", () => {
    const [playing, setPlaying] = createSignal(false);
    const { root } = mount(() => <Button ariaLabel={() => (playing() ? "Pause" : "Play")} />);
    expect(findByLabel(root, "Play")).toBeDefined();
    setPlaying(true);
    expect(findByLabel(root, "Play")).toBeUndefined();
    expect(findByLabel(root, "Pause")).toBeDefined();
  });

  test("the window's title-bar buttons are labelled", () => {
    const { root } = mount(() => <Window title="Player"><Text>body</Text></Window>);
    for (const name of ["Minimize", "Maximize", "Close"]) expect(findByLabel(root, name)).toBeDefined();
  });

  test("a Tooltip labels its trigger with the tip, unless the trigger has its own label", () => {
    const { root } = mount(() => (
      <Row>
        <Tooltip text="Shuffle">
          <Button label="⤮" />
        </Tooltip>
        <Tooltip text="Repeat">
          <Button ariaLabel="Repeat all" label="↻" />
        </Tooltip>
      </Row>
    ));
    expect(findByLabel(root, "Shuffle")!.label).toBe("Button");
    expect(findByLabel(root, "Repeat")).toBeUndefined();
    expect(findByLabel(root, "Repeat all")!.label).toBe("Button");
  });

  test("a Tooltip around several nodes labels itself", () => {
    const { root } = mount(() => (
      <Tooltip text="Now playing">
        <Text>Blue in Green</Text>
        <Text>Miles Davis</Text>
      </Tooltip>
    ));
    expect(findByLabel(root, "Now playing")!.label).toBe("Tooltip");
  });
});

describe("text metrics", () => {
  test("fake metrics are the default (8 px per character, 20 px lines); options change them", () => {
    const { root } = mount(() => <Column align="start"><Text>iiii</Text></Column>);
    const text = findByText(root, "iiii")!;
    expect([text.width, text.height]).toEqual([32, 20]);
    useFakeTextMetrics({ charWidth: 10, lineHeight: 24 });
    try {
      const again = mount(() => <Column align="start"><Text>iiii</Text></Column>);
      const t = findByText(again.root, "iiii")!;
      expect([t.width, t.height]).toEqual([40, 24]);
    } finally {
      useFakeTextMetrics();
    }
  });

  test.skipIf(!canUseRealTextMetrics())("useRealTextMetrics: mount measures with the installed fonts until restored", () => {
    const restore = useRealTextMetrics();
    try {
      const { root } = mount(() => (
        <Column align="start">
          <Text>iiii</Text>
          <Text>MMMM</Text>
        </Column>
      ));
      const narrow = findByText(root, "iiii")!.width, wide = findByText(root, "MMMM")!.width;
      expect(narrow).toBeGreaterThan(0);
      expect(wide).toBeGreaterThan(narrow * 2);
    } finally {
      restore();
    }
    const { root } = mount(() => <Column align="start"><Text>iiii</Text></Column>);
    expect(findByText(root, "iiii")!.width).toBe(32); // fake again
  });
});

test("mount: the view callback is untracked, like a component body", () => {
  const [count, setCount] = createSignal(0);
  let runs = 0;
  const { root } = mount(() => {
    runs++;
    setCount(count() + 1);
    return <Text>{() => `count ${count()}`}</Text>;
  });
  expect(runs).toBe(1);
  setCount(7);
  expect(runs).toBe(1);
  expect(findByText(root, "count 7")).toBeDefined();
});

test("findByValue finds a TextField by what was typed; shownText gives what it draws (masked for passwords)", () => {
  const [name, setName] = createSignal("");
  const [secret, setSecret] = createSignal("");
  const { root } = mount(() => (
    <Column>
      <TextField value={name} onInput={setName} placeholder="Name" />
      <TextField password value={secret} onInput={setSecret} placeholder="Password" />
    </Column>
  ));
  const ui = interact(root);
  ui.press(findByPlaceholder(root, "Name")!);
  ui.type("hello");
  ui.press(findByPlaceholder(root, "Password")!);
  ui.type("hunter");
  const field = findByValue(root, "hello")!;
  expect(field).toBe(root.children[0]!.children[0]!);
  expect(shownText(field)).toBe("hello");
  const password = findByValue(root, "hunter")!;
  expect(shownText(password)).toBe("••••••");
  expect(findAllByValue(root, /^h/)).toEqual([field, password]);
});

test("findByText with { in: widget }: the same text in a menu, a dialog title and a dialog button", () => {
  const [open, setOpen] = createSignal(true);
  const { root, relayout } = mount(() => (
    <Column>
      <Text>Sair</Text>
      <Dialog open={open} onClose={() => setOpen(false)} title="Sair">
        <Button label="Sair" onClick={() => setOpen(false)} />
      </Dialog>
    </Column>
  ));
  relayout();
  expect(findAllByText(root, "Sair")).toHaveLength(3);
  const label = findByText(root, "Sair", { in: "Button" })!;
  expect(label.parent!.label).toBe("Button");
  click(label);
  expect(open()).toBe(false);
  expect(findAllByText(root, "Sair", { in: "Button" })).toHaveLength(1);
  expect(findByText(root, "Sair", { in: "Checkbox" })).toBeUndefined();
});

test("mount({ paint: true }) paints after every layout, so Canvas draw callbacks run", () => {
  const draws: number[] = [];
  const [width, setWidth] = createSignal(100);
  const view = () => <Canvas width={width} height={50} draw={(g) => draws.push(g.width)} />;
  mount(view);
  expect(draws).toEqual([]); // layout only, by default
  const { relayout } = mount(view, { paint: true });
  expect(draws).toEqual([100]);
  setWidth(120);
  relayout();
  expect(draws).toEqual([100, 120]);
});

test("mount takes just a width and height, either one, or neither", () => {
  expect(mount(() => <Box grow={1} />, { width: 320 }).root.children[0]!.width).toBe(320);
});
