// App-level frame loop: run() against a fake native core. Counts what reaches the GPU
// (render calls) for idle windows, signal changes, animations and pointer moves.
import { afterEach, describe, expect, test } from "bun:test";
import { Box, Column, Row, Scroll, Text, UINode, Window, animate, createSignal, setTextMeasurer } from "@nodebuilderjs/core";
import type { Child } from "@nodebuilderjs/core";
import { iconImages } from "../src/image/icon.js";
import { setImageBackend } from "../src/image/source.js";
import { invalidate, setDisplayScale } from "../src/render/node.js";
import { runWith, windowControls, windowState } from "../src/runtime/app.js";
import { setFrameClock } from "../src/runtime/frames.js";
import type { Native, NativeEvent } from "../src/runtime/native.js";

const NO_KEYS = { ctrl: false, shift: false, alt: false, super: false };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function fakeNative() {
  let emitEvents: (events: NativeEvent[]) => void = () => {};
  let images = 0;
  const calls = { render: 0, requestFrame: 0, close: 0, icons: [] as { size: number; rgba: Uint8Array }[][], visible: [] as boolean[], titles: [] as string[] };
  const native: Native = {
    open: (options, onEvents) => {
      calls.titles.push(options.title);
      emitEvents = onEvents;
    },
    close: () => void calls.close++,
    render: () => void calls.render++,
    measureText: (text) => [text.length * 8, 15, 5],
    createImage: () => ++images,
    destroyImage: () => {},
    decodeImage: () => {
      throw new Error("not in tests");
    },
    renderOffscreen: () => {
      throw new Error("not in tests");
    },
    setCursor: () => {},
    setTitle: (title) => void calls.titles.push(title),
    setIcon: (images) => void calls.icons.push(images),
    setVisible: (visible) => void calls.visible.push(visible),
    move: () => {},
    resize: () => {},
    setMaximized: () => {},
    minimize: () => {},
    requestFrame: () => void calls.requestFrame++,
    writeClipboard: () => {},
    readClipboard: () => {},
    registerFont: () => [],
    fontFamilies: () => [],
    fontStats: () => ({ faces: 0, variations: 0, specs: 0, styles: 0, sizes: 0 }),
    diagnostics: () => {
      throw new Error("not used by run()");
    },
  };
  return { native, calls, emit: (...events: NativeEvent[]) => emitEvents(events) };
}

interface StartOptions {
  env?: Record<string, string | undefined>;
  now?: () => number;
}

/** Opens `app` on a fake native core; events go through the same path as a real window's. */
async function start(app: () => Child, options: StartOptions = {}) {
  const fake = fakeNative();
  const logs: string[] = [];
  const warnings: string[] = [];
  runWith(fake.native, app, { maxFps: 1000 }, { env: options.env ?? {}, now: options.now, log: (l) => logs.push(l), warn: (w) => warnings.push(w) });
  const send = async (...events: NativeEvent[]) => {
    fake.emit(...events);
    await tick();
  };
  await send({ type: "configure", width: 400, height: 300, scale: 1, maximized: false, activated: true, transparent: true });
  return {
    calls: fake.calls,
    logs,
    warnings,
    send,
    /** `n` compositor frame callbacks, each followed by whatever they schedule. */
    async frames(n: number, each?: () => void) {
      for (let i = 0; i < n; i++) {
        each?.();
        await send({ type: "frame" });
      }
    },
    pointer: (x: number, y: number) => send({ type: "pointermove", x, y, button: 0, ...NO_KEYS }),
  };
}

afterEach(() => {
  windowControls.close();
  setTextMeasurer((text) => ({ width: text.length * 8, ascent: 15, descent: 5 }));
  let id = 0;
  setImageBackend({ create: () => ++id, destroy: () => {} });
  setDisplayScale(1);
  setFrameClock(null);
});

describe("window icon", () => {
  test("a window without an icon gets the framework's default", async () => {
    const app = await start(() => <Window title="x" />);
    expect(app.calls.icons).toHaveLength(1);
    expect(app.calls.icons[0]!.at(-1)!.rgba).toEqual(iconImages().at(-1)!.rgba);
  });

  test("<Window icon> is rasterized and sent once", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#00ff00"/></svg>`;
    const app = await start(() => <Window title="x" icon={svg} />);
    expect(app.calls.icons).toHaveLength(1);
    expect([...app.calls.icons[0]![0]!.rgba.subarray(0, 4)]).toEqual([0, 255, 0, 255]);
  });

  test("an icon that cannot be read warns and falls back to the default", async () => {
    const app = await start(() => <Window title="x" icon="/nonexistent/icon.png" />);
    expect(app.warnings.some((w) => w.includes("/nonexistent/icon.png"))).toBe(true);
    expect(app.calls.icons[0]!.at(-1)!.rgba).toEqual(iconImages().at(-1)!.rgba);
  });
});

describe("native input events", () => {
  test("modifiers (super is meta) reach pointer, wheel and key handlers; keyup reaches onKeyUp", async () => {
    const seen: string[] = [];
    const app = await start(() => (
      <Window title="x" onKeyDown={(e) => seen.push(`down ${e.key} meta=${e.meta}`)} onKeyUp={(e) => seen.push(`up ${e.key}`)}>
        <Box grow={1} onPointerDown={(e) => seen.push(`press ctrl=${e.ctrl}`)} onScroll={(e) => seen.push(`wheel alt=${e.alt}`)} />
      </Window>
    ));
    await app.send({ type: "pointerdown", x: 100, y: 100, button: 0, ...NO_KEYS, ctrl: true });
    await app.send({ type: "scroll", x: 100, y: 100, dx: 0, dy: 3, ...NO_KEYS, alt: true });
    await app.send({ type: "keydown", key: "s", text: "", repeat: false, ...NO_KEYS, super: true });
    await app.send({ type: "keyup", key: "s", text: "", repeat: false, ...NO_KEYS });
    expect(seen).toEqual(["press ctrl=true", "wheel alt=true", "down s meta=true", "up s"]);
  });
});

describe("window title", () => {
  test("a title accessor opens the window with its value and follows it (title bar and window list)", async () => {
    const [unsaved, setUnsaved] = createSignal(false);
    const app = await start(() => <Window title={() => (unsaved() ? "notes.md •" : "notes.md")} />);
    expect(app.calls.titles).toEqual(["notes.md"]);
    setUnsaved(true);
    await tick();
    expect(app.calls.titles).toEqual(["notes.md", "notes.md •"]);
  });
});

describe("hiding the window", () => {
  test("a hidden window renders nothing until it is shown and configured again", async () => {
    const [count, setCount] = createSignal(0);
    const app = await start(() => (
      <Window title="x">
        <Text>{() => `count ${count()}`}</Text>
      </Window>
    ));
    await app.frames(1);
    expect(windowState.visible()).toBe(true);
    windowControls.hide();
    expect(app.calls.visible).toEqual([false]);
    expect(windowState.visible()).toBe(false);
    const rendered = app.calls.render;
    setCount(1);
    await app.frames(2);
    // A configure while hidden (the compositor resending state) does not draw either.
    await app.send({ type: "configure", width: 400, height: 300, scale: 1, maximized: false, activated: false, transparent: true });
    expect(app.calls.render).toBe(rendered);
    expect(app.calls.requestFrame).toBe(0);

    windowControls.show();
    expect(app.calls.visible).toEqual([false, true]);
    expect(windowState.visible()).toBe(true);
    expect(app.calls.render).toBe(rendered); // waits for the window to be mapped again
    await app.send({ type: "configure", width: 400, height: 300, scale: 1, maximized: false, activated: true, transparent: true });
    expect(app.calls.render).toBe(rendered + 1);
  });

  test("hide and show are idempotent", async () => {
    const app = await start(() => <Window title="x" />);
    windowControls.show();
    windowControls.hide();
    windowControls.hide();
    expect(app.calls.visible).toEqual([false]);
  });
});

describe("frame loop", () => {
  test("an idle window renders once and then stays idle", async () => {
    const app = await start(() => (
      <Window title="Idle">
        <Text>nothing happens here</Text>
      </Window>
    ));
    expect(app.calls.render).toBe(1);
    await app.frames(5);
    expect(app.calls.render).toBe(1);
    expect(app.calls.requestFrame).toBe(0);
  });

  test("a signal change renders exactly one more frame", async () => {
    const [count, setCount] = createSignal(0);
    const app = await start(() => <Text>{() => `count ${count()}`}</Text>);
    await app.frames(2);
    setCount(1);
    await tick();
    expect(app.calls.render).toBe(2);
    await app.frames(5);
    expect(app.calls.render).toBe(2);
  });

  test("the run() callback is untracked: reading and then writing a signal there runs it once", async () => {
    const [count, setCount] = createSignal(0);
    let runs = 0;
    const app = await start(() => {
      runs++;
      setCount(count() + 1); // would loop forever if the callback were a reactive slot
      return <Text>{() => `count ${count()}`}</Text>;
    });
    expect(runs).toBe(1);
    expect(app.calls.render).toBe(1);
    setCount(5);
    await app.frames(1);
    expect(runs).toBe(1);
  });

  test("changes before the compositor is ready wait for its frame callback", async () => {
    const [count, setCount] = createSignal(0);
    const app = await start(() => <Text>{() => `count ${count()}`}</Text>);
    setCount(1); // the first frame is still on screen: no frame callback yet
    setCount(2);
    await tick();
    expect(app.calls.render).toBe(1);
    await app.frames(1);
    expect(app.calls.render).toBe(2);
    await app.frames(3);
    expect(app.calls.render).toBe(2);
  });

  test("an animation renders one frame per frame callback until it ends, then stops", async () => {
    let time = 0;
    setFrameClock(() => time);
    const [x, setX] = createSignal(0);
    const app = await start(() => <Text>{() => `x ${Math.round(x())}`}</Text>);
    await app.frames(1);
    const before = app.calls.render;
    animate(0, 100, setX, { duration: 100 });
    await app.frames(12, () => (time += 16));
    expect(x()).toBe(100);
    const rendered = app.calls.render - before;
    expect(rendered).toBeGreaterThanOrEqual(7); // 100 ms at 16 ms per frame
    expect(rendered).toBeLessThanOrEqual(8);
    await app.frames(5, () => (time += 16));
    expect(app.calls.render - before).toBe(rendered);
  });

  test("moving the pointer over plain nodes renders nothing", async () => {
    const app = await start(() => (
      <Column>
        <Text>first line</Text>
        <Text>second line</Text>
      </Column>
    ));
    await app.frames(1);
    for (const [x, y] of [[10, 10], [40, 30], [200, 150], [399, 299]] as const) {
      await app.pointer(x, y);
      await app.frames(1);
    }
    await app.send({ type: "pointerleave" });
    await app.frames(2);
    expect(app.calls.render).toBe(1);
  });

  test("the scrollbar strip re-renders only when the hover changes", async () => {
    const app = await start(() => (
      <Scroll>
        {Array.from({ length: 50 }, (_, i) => <Text>{`row ${i}`}</Text>)}
      </Scroll>
    ));
    await app.frames(1);
    await app.pointer(200, 50);
    await app.frames(1);
    expect(app.calls.render).toBe(1);
    await app.pointer(395, 50); // into the 14 px strip: the bar widens
    await app.frames(1);
    expect(app.calls.render).toBe(2);
    await app.pointer(392, 80);
    await app.frames(2);
    expect(app.calls.render).toBe(2);
    await app.pointer(200, 80); // out again
    await app.frames(1);
    expect(app.calls.render).toBe(3);
    await app.pointer(150, 90);
    await app.frames(2);
    expect(app.calls.render).toBe(3);
  });

  test("closing stops frames: later changes render nothing", async () => {
    const [count, setCount] = createSignal(0);
    const app = await start(() => <Text>{() => `count ${count()}`}</Text>);
    await app.frames(1);
    windowControls.close();
    expect(app.calls.close).toBe(1);
    setCount(1);
    await app.frames(2);
    expect(app.calls.render).toBe(1);
  });
});

/** A node that asks for another frame every time it is painted: the classic frame loop. */
function LoopingNode() {
  const node = new UINode("Looping");
  node.style.height = 10;
  node.paint = function invalidatesWhilePainting() {
    invalidate();
  };
  return node;
}

describe("NB_STATS and NB_TRACE", () => {
  test("NB_STATS counts frames by reason: invalidate, native event, animation frame", async () => {
    let now = 0;
    let time = 0;
    setFrameClock(() => time);
    const [count, setCount] = createSignal(0);
    const app = await start(() => <Text>{() => `count ${count()}`}</Text>, { env: { NB_STATS: "1" }, now: () => now });
    await app.frames(1); // frame 1: configure (ev)
    setCount(1); // frame 2: inv
    await app.frames(1);
    animate(0, 1, () => {}, { duration: 48 }); // frame 3: inv (the request), then raf frames
    await app.frames(4, () => (time += 16));
    expect(app.logs).toEqual([]);
    now = 1000;
    setCount(2);
    await app.frames(1);
    expect(app.logs).toHaveLength(1);
    expect(app.logs[0]).toContain("why: inv 3 ev 1 raf 2");
  });

  test("NB_TRACE=frames logs what asked for each frame, with its stack", async () => {
    const [count, setCount] = createSignal(0);
    const app = await start(() => <Text>{() => `count ${count()}`}</Text>, { env: { NB_TRACE: "frames" } });
    await app.frames(1);
    expect(app.logs[0]).toMatch(/^frame 1: ev configure/);
    function bumpTheCounter() {
      setCount((c) => c + 1);
    }
    bumpTheCounter();
    await app.frames(1);
    expect(app.logs[1]).toMatch(/^frame 2: inv\n/);
    expect(app.logs[1]).toContain("bumpTheCounter");
    expect(app.logs[1]).not.toContain("[in frame]");
    expect(app.logs[1]!.split("\n").length).toBeLessThanOrEqual(7); // header + top 6 frames
  });

  test("NB_TRACE marks invalidations made while the frame was being built", async () => {
    const app = await start(() => <Column><LoopingNode /></Column>, { env: { NB_TRACE: "frames" } });
    await app.frames(2);
    expect(app.logs[1]).toMatch(/^frame 2: inv \[in frame\]\n/);
    expect(app.logs[1]).toContain("invalidatesWhilePainting");
  });

  test("without NB_TRACE nothing is logged", async () => {
    const [count, setCount] = createSignal(0);
    const app = await start(() => <Text>{() => `count ${count()}`}</Text>);
    setCount(1);
    await app.frames(3);
    expect(app.logs).toEqual([]);
  });

  test("a frame loop is reported once, naming who invalidates", async () => {
    const app = await start(() => <Column><LoopingNode /></Column>);
    await app.frames(29);
    expect(app.warnings).toEqual([]);
    await app.frames(40);
    expect(app.calls.render).toBe(70); // the loop itself is not stopped, only reported
    expect(app.warnings).toHaveLength(1);
    expect(app.warnings[0]).toContain("frame loop");
    expect(app.warnings[0]).toContain("invalidatesWhilePainting");
  });

  test("an animation is not a frame loop", async () => {
    let time = 0;
    setFrameClock(() => time);
    const app = await start(() => <Text>moving</Text>);
    animate(0, 1, () => {}, { duration: 16 * 60 });
    await app.frames(60, () => (time += 16));
    expect(app.calls.render).toBeGreaterThan(50);
    expect(app.warnings).toEqual([]);
  });

  test("the frame loop warning is off in production", async () => {
    const app = await start(() => <Column><LoopingNode /></Column>, { env: { NODE_ENV: "production" } });
    await app.frames(40);
    expect(app.warnings).toEqual([]);
  });
});

describe("overflow warnings", () => {
  /** A 300px clipped panel with 342px of chips; `label` changes force new layouts. */
  const Panel = (props: { label: () => string }) => (
    <Column>
      <Text>{props.label}</Text>
      <Box width={300} clip ariaLabel="panel">
        <Row gap={6}>
          <Text width={110}>Home</Text>
          <Text width={110}>Albums</Text>
          <Text width={110}>Artists</Text>
        </Row>
      </Box>
    </Column>
  );

  test("in development each overflow is printed once, however many frames show it", async () => {
    const [label, setLabel] = createSignal("a");
    const app = await start(() => <Panel label={label} />);
    expect(app.warnings).toEqual([
      'layout: Row > Text("Artists") overflows Box(panel) by 42px (children need 342px, 300px available)',
    ]);
    for (const next of ["b", "c", "d"]) {
      setLabel(next);
      await app.frames(1);
    }
    expect(app.calls.render).toBe(4);
    expect(app.warnings).toHaveLength(1);
  });

  test("production is silent", async () => {
    const app = await start(() => <Panel label={() => "a"} />, { env: { NODE_ENV: "production" } });
    expect(app.calls.render).toBe(1);
    expect(app.warnings).toEqual([]);
  });
});
