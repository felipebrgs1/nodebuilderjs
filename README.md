# nodebuilder

**Native Linux** desktop apps written in TypeScript and TSX.

No DOM, no Electron, no GTK/Qt: your components are drawn by a small native core
(Wayland/X11 + OpenGL ES), with SolidJS-style reactivity. The result starts fast, uses
**between a quarter and half the memory** of an equivalent Electron app, and becomes an
AppImage, `.deb` or `.rpm` with one command.

```tsx
import { Button, Column, Text, Window, createSignal, run } from "@nodebuilderjs/core";

function App() {
  const [count, setCount] = createSignal(0);
  return (
    <Window title="Counter" width={400} height={300}>
      <Column grow={1} align="center" justify="center" gap={16}>
        <Text fontSize={40} bold>{count}</Text>
        <Button label="+1" variant="primary" onClick={() => setCount((c) => c + 1)} />
      </Column>
    </Window>
  );
}

run(() => <App />);
```

> **Status:** version 0.2, experimental. The API may still change. See the [roadmap](ROADMAP.md).

## Getting started

Requirements: Linux with Wayland or X11 and [Bun](https://bun.sh) 1.4+.

```sh
bun create nodebuilderjs my-app
cd my-app
bun run dev        # opens the window and restarts on save
```

The project comes with an example test (`bun test`, no window), TypeScript already
configured (`bun run typecheck`) and an `AGENTS.md` that explains the framework to coding
agents such as Claude Code.

## How it works, in 30 seconds

- **Components run once.** There is no re-render and no virtual DOM. State is `createSignal`,
  derived values are `createMemo`.
- **Only functions are reactive.** `<Text>{count}</Text>` updates on its own;
  `<Text>{count()}</Text>` reads the value once. The same goes for styles:
  `background={() => (active() ? "#3584e4" : "#ffffff")}`.
- **Styles are props, not CSS:** `padding`, `gap`, `grow`, `align`, `justify`, `background`,
  `radius`, `color`, `fontSize`... The layout is flexbox.
- **Built-in widgets:** `Window`, `Column`, `Row`, `Scroll`, `Text`, `Image`, `Icon`, `Canvas`,
  `Button`, `TextField`, `Checkbox`, `Toggle`, `RadioGroup`, `Slider`, `Select`, `Tabs`,
  `Tooltip`, `Dialog`, `ProgressBar`, `Spinner`, `Card`, `Divider`, `Spacer`, plus `<For>`/`<Index>`,
  `<Show>`/`<Switch>` and `<ErrorBoundary>` for lists, conditions and errors, and
  `createContext` for values shared down the tree.

Complete examples in [`examples/`](examples): counter, to-do list, images, icons,
freehand drawing, charts, overlays (menu, dialog and tooltip), text (paragraphs, alignment,
ellipsis), scrolling (horizontal, both axes, `scrollIntoView`) and a dashboard
with tabs, a table and a chart.

### Layout

A simplified flexbox: `Column`/`Row`, `gap`, `padding`, `grow`, `align` (stretch by default),
`justify`, `min/max` sizes. There are no percentages or grid:

- **Equal or proportional columns:** `width={0} grow={1}` on each child (CSS `flex: 1 1 0`);
  the widths follow the `grow` values, not the content. In a column with a height,
  `height={0} grow={1}` does the same for rows.
- **`position="absolute"`** with `left`/`top` (from the parent's corner, inside its `padding`; no
  `right`/`bottom`): out of the flow and at its natural size (it does not stretch), so give it
  `width`/`height`, taken from the parent's `onResize` to fill it. There is no `zIndex`:
  children are drawn and hit in order, so declare it last to be on top. Inside a `Scroll` it
  stays fixed in the visible area; inside an in-flow child of the `Scroll`, it scrolls with it.
- `clip` cuts the children to the box, rounded by `radius`; `shadow={{ color, blur, y }}` is
  drawn even without a `background` (the blurred box shows through).

### Images

```tsx
import logo from "./logo.png" with { type: "file" };

<Image src={logo} width={64} />                                   // height follows the aspect ratio
<Image src={photo} width={200} height={120} fit="cover" radius={12} opacity={0.8} />
```

`fit` can be `contain` (default: the whole image, centered), `cover` (fills and crops)
or `fill` (stretches). Without `width`/`height`, the image uses its own size in pixels. The
`with { type: "file" }` makes `nodebuilder package` embed the file in the executable; `src`
also accepts a path, a `file:` `URL`, the file's bytes (`Uint8Array`) or already decoded
pixels (`{ width, height, data }` in RGBA).

Formats: **PNG, JPEG and WebP** are decoded in TypeScript (JPEG honors the EXIF
orientation, and all of them produce the same result, byte for byte, as libpng, libjpeg-turbo
and libwebp). **AVIF and HEIC** use the system `libheif`, loaded only when needed: without it,
only those formats fail, and the generated packages suggest it without requiring it. SVG is
drawn by `<Icon>` (below).

### Icons

```tsx
import camera from "lucide-static/icons/camera.svg" with { type: "text" };  // bun add lucide-static
import heart from "@phosphor-icons/core/assets/duotone/heart-duotone.svg" with { type: "text" };
import { Star } from "lucide";                                              // or the lucide data

<Icon svg={camera} />                          // 20 px, color inherited like text
<Icon svg={heart} size={32} color="#e01b24" />
<Button variant="primary"><Icon svg={Star} size={16} /><Text>Favorite</Text></Button>
<Icon svg={Star} fill />                       // solid: outline icons filled with their color
```

`<Icon>` draws SVG with its own renderer, written in TypeScript and built for icons: paths
(with arcs and curves), shapes, strokes with caps and joins, `transform`, opacity and
`currentColor`. Lucide and Phosphor come out practically identical to librsvg (mean difference
of 0.8 out of 255 on stroke edges). A single-color icon is rasterized once, at the exact
screen size (sharp on HiDPI too), and the color is applied on the GPU: changing the color, on
hover for example, costs nothing. `strokeWidth` changes the thickness of outline icons, as in
Lucide. `fill` makes them solid, also as in Lucide: it replaces the fill of the root `<svg>`
(Lucide's is `none`), so the shapes are filled with the icon's color (`fill`) or another one
(`fill="#e01b24"`) and keep their stroke; a fill that a group or shape sets itself, `none`
included, still wins. It can be reactive (`fill={liked}`). Gradients, text, filters, masks and `<use>` are not supported yet, so complex
illustrations should be turned into PNG. React packages (`lucide-react`,
`@phosphor-icons/react`) don't work: use `lucide-static`, `lucide` or `@phosphor-icons/core`.

### Freehand drawing

```tsx
<Canvas height={160} draw={(g) => {
  const pts = data().flatMap((v, i) => [i * 10, g.height - v]);    // signals read here trigger a redraw
  g.polygon([0, g.height, ...pts, g.width, g.height], "#3584e433"); // area
  g.polyline(pts, theme.accent.base, 2);                            // line
  g.arc(80, 80, 60, 40, 0, Math.PI, "#26a269");                     // donut: radii, start, sweep
}} />
```

`<Canvas>` draws with antialiased GPU primitives: thick lines with round, butt or square
caps, filled polygons (concave ones included), circles and arcs (pie, donut, gauges) and
text. Coordinates are local to the canvas; `g.width` and `g.height` give its size. `draw` is
reactive: it runs inside an effect, so the signals it reads (data, `theme` colors) are tracked
and changing one of them redraws. Geometry is computed when the data changes, not every frame.
`g.text(text, x, y, color, size?, bold?)` draws one line, with no maximum width or ellipsis:
measure with `g.measureText(text, size?, bold?)` (`{ width, height }`) to align or cut it.
Lines take a dash pattern (`g.line(..., cap, [4, 3])`, `g.polyline(..., { dash })`).
Limits: a self-intersecting polygon is not drawn, and lines with a translucent color get darker
at the joins.

### Charts

```tsx
import { LineChart, Line, Area, AreaChart, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Legend } from "@nodebuilderjs/core/charts";

<LineChart data={sales} height={240}>         {/* data can be a signal: the chart follows it */}
  <CartesianGrid vertical={false} />
  <XAxis dataKey="month" />
  <YAxis tickFormatter={(v) => `$${v}`} />
  <Line dataKey="revenue" name="Revenue" />
  <Line dataKey="target" stroke="#e5a50a" type="monotone" dot={false} />
  <Legend />
</LineChart>
```

The API follows Recharts: `LineChart`, `AreaChart`, `BarChart`, `ComposedChart` and
`PieChart`, with `Line`, `Area`, `Bar`, `Pie`/`Cell`, `XAxis`, `YAxis`, `CartesianGrid` and
`Legend` as children. Axes use round steps (like d3), the y axis includes zero, and
`type="monotone"` smooths the curve. There is also `<Tooltip>` (guide line and the values of
the category under the mouse; on a pie, the slice), stacking with `stackId`, `strokeDasharray`
on lines and grid, `label` on slices and bars, and the x axis drops labels that overlap.
Everything is drawn with `<Canvas>`, on the GPU, and ships in the core itself: if you don't
import `@nodebuilderjs/core/charts`, none of it ends up in the executable (if you do, ~15 KB).
Scatter and radar charts, `ReferenceLine`, `Brush` and secondary axes don't exist yet.

### Conditions, lists and errors

As in SolidJS: components that decide when to create (and dispose of) their children.

```tsx
import { Button, Column, ErrorBoundary, For, Index, Match, Show, Switch, Text, createSignal } from "@nodebuilderjs/core";

const [user, setUser] = createSignal<{ name: string } | null>(null);
const [status, setStatus] = createSignal<"loading" | "error" | "ok">("loading");
const [tasks] = createSignal([{ title: "Buy bread" }]);
const [scores] = createSignal([7, 9, 10]);

// Show: with a function child, it receives the (truthy) value as an accessor.
<Show when={user} fallback={<Text>Sign in to your account</Text>}>
  {(u) => <Text>{() => `Hello, ${u().name}`}</Text>}
</Show>;

// Switch: the first truthy Match; the content is only recreated when the chosen Match changes.
<Switch fallback={<Text>All good</Text>}>
  <Match when={() => status() === "loading"}><Text>Loading...</Text></Match>
  <Match when={() => status() === "error"}><Text color="#c01c28">Failed</Text></Match>
</Switch>;

// For: keyed by reference (the row follows the object); i is an accessor.
<For each={tasks} fallback={<Text>Nothing to do</Text>}>
  {(t, i) => <Text>{() => `${i() + 1}. ${t.title}`}</Text>}
</For>;

// Index: by position (good for primitives); item is an accessor, i is a fixed number.
<Index each={scores}>{(score, i) => <Text>{() => `Test ${i + 1}: ${score()}`}</Text>}</Index>;

// ErrorBoundary: an error while creating the children or in one of their effects shows the fallback.
<ErrorBoundary
  fallback={(error, retry) => (
    <Column gap={8}>
      <Text>{`Something went wrong: ${error instanceof Error ? error.message : String(error)}`}</Text>
      <Button label="Try again" onClick={retry} />
    </Column>
  )}
>
  <Text>{() => user()!.name}</Text>
</ErrorBoundary>;
```

- `when` accepts a value or an accessor. The function child must declare its parameter
  (`{(u) => ...}`); a function without parameters (`{() => ...}`) is still a plain reactive
  child. The accessor keeps the last truthy value, so an effect in the row that runs before
  the row is disposed doesn't see `null`.
- `<Switch>` only accepts `<Match>` as a child (or `false`/`null`, for `{cond && <Match>}`);
  `<Match>` outside a `<Switch>` is an error.
- `<ErrorBoundary>` catches what is thrown while creating the child components and, after
  that, by their effects and memos (including when a click changes a signal and an effect
  fails). Whatever the children created is disposed of (effects, `onCleanup`, overlays). The
  `fallback` can be content or a function `(error, reset)`; `reset()` creates the children
  again. It doesn't catch what the handler itself (`onClick`...) throws: that error reaches
  whoever called the handler, as in React and Solid. Errors without a boundary still show up
  as before.

### Context, `ref` and size

```tsx
import { Box, Column, TextField, Text, createContext, createSignal, useContext } from "@nodebuilderjs/core";

// Context: a value any descendant can read, without passing props through every level.
const Language = createContext("en");
function Greeting() {
  return <Text>{useContext(Language) === "en" ? "Hello" : "Olá"}</Text>;
}
<Language.Provider value="pt"><Greeting /></Language.Provider>;

// ref: the widget's element, to focus, scroll and read the box from the last layout.
const [name, setName] = createSignal("");
<TextField ref={(el) => el.focus()} value={name} onInput={setName} />;

// onResize: the node's size after layout (the first time and whenever it changes).
const [width, setWidth] = createSignal(0);
<Box grow={1} onResize={(s) => setWidth(s.width)}>
  <Column>{() => (width() > 600 ? "wide" : "narrow")}</Column>
</Box>;
```

- For a value that changes, pass an accessor in the context (`value={mode}`, with `mode` a
  signal) and call it where you use it (`useContext(Mode)()`).
- `ref` receives an `ElementRef`: `x`, `y`, `width` and `height` from the last layout (window
  coordinates), `focus()`, `blur()`, `scrollIntoView()` and, on a `Scroll`, `scrollTo(y)` or
  `scrollTo({ x, y })`, `scrollX` and `scrollY`. `ref` is called when the widget is created,
  before layout; a `focus()` or `scrollIntoView()` at that point takes effect as soon as the
  widget enters the tree.
- `ariaLabel` (any widget, fixed or a function) names an element that has no text, such as an
  icon-only button: `<Button ariaLabel="Play">`. Tests find it with `findByLabel` (see
  [Testing](#testing)). The window's title-bar buttons are labelled `"Minimize"`,
  `"Maximize"`/`"Restore"` and `"Close"`, and a `Tooltip` gives its text to a trigger without
  a label. There is no screen reader support yet (see the limitations).

### Scrolling

```tsx
import { Button, Card, For, Row, Scroll, Text } from "@nodebuilderjs/core";
import type { ElementRef } from "@nodebuilderjs/core";

const items = Array.from({ length: 200 }, (_, i) => `Item ${i}`);
const rows: ElementRef[] = [];
<>
  <Scroll horizontal gap={12}>                    {/* strip that scrolls sideways */}
    <For each={items}>{(t) => <Card width={160}><Text>{t}</Text></Card>}</For>
  </Scroll>
  <Button label="Go to 150" onClick={() => rows[150]?.scrollIntoView()} />
  <Scroll grow={1}>
    <For each={items}>{(t, i) => <Row ref={(el) => (rows[i()] = el)} padding={8}><Text>{t}</Text></Row>}</For>
  </Scroll>
  <Scroll horizontal vertical height={300}>{/* wide, long table */}</Scroll>
</>;
```

- `<Scroll>` scrolls vertically; `horizontal` makes a row whose children keep their width
  (text inside doesn't wrap, unless it has `width`/`maxWidth`); `horizontal vertical` scrolls
  on both axes, in a column where each child is at least as wide as the visible area.
- Mouse wheel and touchpad on both axes; Shift+wheel scrolls sideways. The scrollbars are thin,
  drawn over the content (as in GTK and macOS), and widen under the mouse: dragging the thumb
  scrolls along, clicking the track moves one page. They only take the click (in a 14 px strip
  along the edge) when there is something to scroll.
- Keyboard: PageUp/PageDown, Home/End and the arrow keys scroll the `Scroll` around the
  focused element (with no focus, the one under the mouse), unless an `onKeyDown` calls
  `e.stop()`. `TextField` keeps Home/End and ←/→ for the cursor.
- `scrollIntoView()` scrolls each `Scroll` around the element by the minimum needed, on the
  next frame (also for an element that was just created or that is far away, off screen).
- The content of a `Scroll` doesn't hold up the size of its container: a column with a
  `Scroll grow={1}` inside shrinks without `minHeight={0}`.
- An open `<Overlay modal>` blocks the wheel, keys and scrollbars of what is behind it.

### Controls

```tsx
import { ProgressBar, RadioGroup, Slider, Toggle, createSignal } from "@nodebuilderjs/core";

const [wifi, setWifi] = createSignal(true);
const [size, setSize] = createSignal("m");
const [volume, setVolume] = createSignal(40);
<Toggle checked={wifi} onChange={setWifi} label="Wi-Fi" />;
<RadioGroup value={size} onChange={setSize} options={[
  { value: "s", label: "Small" },
  { value: "m", label: "Medium" },
  { value: "l", label: "Large", disabled: true },
]} />;
<Slider value={volume} onChange={setVolume} min={0} max={100} step={5} />;
<ProgressBar value={() => volume() / 100} />; // without value: indeterminate
```

- Every control accepts `disabled` (value or function): it is dimmed
  (`theme.disabledOpacity`), leaves the Tab order, loses focus and doesn't respond.
- Keyboard: `Toggle`/`Checkbox`/`Button` with Space or Enter; `RadioGroup` is a single Tab
  stop and the arrow keys change the option (skipping disabled ones); `Slider` with the arrow
  keys (one `step`), PageUp/PageDown (one tenth), Home/End.
- `Toggle` is the on/off switch: the name `Switch` is already taken by the control flow
  component.
- `Spinner` spins while it is on screen (`size`, `color`).

```tsx
import { Button, Dialog, Match, Select, Switch, Tabs, Text, Tooltip, createSignal } from "@nodebuilderjs/core";

const [city, setCity] = createSignal<string | undefined>(undefined);
const [tab, setTab] = createSignal("general");
const [confirming, setConfirming] = createSignal(false);
<Select value={city} onChange={setCity} placeholder="City" options={[
  { value: "poa", label: "Porto Alegre" },
  { value: "sp", label: "São Paulo" },
]} />;
<Tabs value={tab} onChange={setTab} tabs={[{ value: "general", label: "General" }, { value: "account", label: "Account" }]} />;
<Switch>
  <Match when={() => tab() === "general"}><Text>General</Text></Match>
  <Match when={() => tab() === "account"}><Text>Account</Text></Match>
</Switch>;
<Tooltip text="Deletes permanently"><Button label="Delete" onClick={() => setConfirming(true)} /></Tooltip>;
<Dialog open={confirming} onClose={() => setConfirming(false)} title="Delete file?"
  actions={<Button label="Delete" variant="danger" onClick={() => setConfirming(false)} />}>
  <Text>This action cannot be undone.</Text>
</Dialog>;
```

- `Select`: the list opens below (or above, if it doesn't fit) with the width of the field;
  the arrow keys move the highlight, Enter picks, Esc closes. Focus stays on the field.
- `Tabs` is only the bar (one Tab stop, the arrow keys switch tabs); the content of each tab
  is up to you, with `<Switch>`/`<Show>`.
- `Tooltip` appears after `delay` ms (500) with the pointer still, on the `placement` side
  (`"top"`); it hides on leave or click.
- `Dialog` is a ready-made `<Overlay modal>`: it focuses the first control when it opens and
  gives focus back when it closes; Esc and the backdrop call `onClose` (`dismissible={false}`
  turns that off).

### Dark theme and animations

```tsx
import { Box, Text, Toggle, colorScheme, createPresence, createSignal, createTween, setTheme, theme } from "@nodebuilderjs/core";

// Theme: switches everything at once; colors read inside functions follow it.
<Toggle checked={() => colorScheme() === "dark"} onChange={(on) => setTheme(on ? "dark" : "light")} label="Dark theme" />;
<Text color={() => theme.text.secondary}>caption</Text>;

// A number that moves smoothly to its target; and something that fades out before leaving the tree.
const [open, setOpen] = createSignal(false);
const width = createTween(() => (open() ? 240 : 64), { duration: 200 });
const panel = createPresence(open, { enter: 180, exit: 120 });
<Box width={width} opacity={panel.progress} />;
```

- `setTheme("dark" | "light")` or a custom theme (`{ ...darkTheme, accent: { ...darkTheme.accent,
  base: "#9141ac" } }`); `colorScheme()` tells which one is in use. `theme.x = ...` also updates.
- **Theme colors inside functions:** `color={() => theme.text.secondary}` follows the switch;
  `color={theme.text.secondary}` keeps the color from that moment. The built-in widgets
  already follow it.
- `animate(from, to, onUpdate, { duration, easing, onDone })` returns a function that stops it;
  `createTween(source, { duration, easing })` follows a value; `createPresence(when, { enter,
  exit, easing })` gives `mounted` (stays `true` until the exit finishes, for use in `<Show>`)
  and `progress` (0 to 1). Durations in ms (default 200; presence 180 in, 120 out), default
  curve `easing.easeOut` (also `linear`, `easeIn`, `easeInOut`, or any `(t) => number`).
- `mixColor(a, b, t)` blends two colors into `"#rrggbbaa"`, alpha included and not
  premultiplied: to fade a color out, mix it with the same color at alpha 0, not `"transparent"`
  (which passes through gray).
- `Dialog`, `Select`, `Tooltip` and `Toggle` already animate. Without a window (in tests) every
  animation finishes immediately; `frames()` from `@nodebuilderjs/core/testing` controls time.

### Text

`<Text>` wraps at spaces to fit the width it gets, as on the web; `\n` always breaks the
line. A word longer than the line overflows (it isn't cut in the middle).

```tsx
import { Row, Text, theme } from "@nodebuilderjs/core";

<Text textAlign="center" lineHeight={1.4}>A long paragraph that wraps across several lines.</Text>;
<Row gap={8}>
  <Text grow={1} maxLines={1}>a-very-long-file-name.pdf</Text>
  <Text color={theme.text.secondary}>12 MB</Text>
</Row>;
```

- `wrap={false}`: a single line (apart from `\n` breaks), even if it overflows.
- `maxLines`: truncates and ends the last line with "…"; `maxLines={1}` shortens a single line.
- `textAlign` (`"start"`, `"center"`, `"end"`) and `lineHeight` (a multiple of the font's line
  spacing, default 1).
- In a `Row` without room, children with `grow` shrink first (like Flutter's `Expanded`); text
  that wraps can shrink down to its longest word, and with `maxLines` down to the "…".

### Overlays: dialogs, menus and tooltips

`<Overlay>` draws its content on a layer above the whole window, outside the clipping of its
container, and still sees the context and text color of the place where it was declared.

```tsx
import { Button, Card, Overlay, Show, Text, createSignal } from "@nodebuilderjs/core";
import type { ElementRef } from "@nodebuilderjs/core";

// Menu anchored to a button: below it (above, if it doesn't fit), with the same width.
const [open, setOpen] = createSignal(false);
let button: ElementRef | undefined;
<>
  <Button ref={(el) => (button = el)} label="Options" onClick={() => setOpen((o) => !o)} />
  <Show when={open}>
    <Overlay anchor={() => button} matchWidth onDismiss={() => setOpen(false)}>
      <Card padding={4}><Text>Rename</Text></Card>
    </Overlay>
  </Show>
</>;

// Modal dialog: covers the window, dims the background and blocks clicks and Tab behind it.
<Overlay modal background="#00000059" align="center" justify="center" onDismiss={() => setOpen(false)}>
  <Card width={320}><Text>Delete file?</Text></Card>
</Overlay>;
```

- Without `anchor`, the layer covers the window and positions its children with the flex
  props (`align`, `justify`, `padding`) or with `position="absolute"`. Empty space lets clicks
  through, unless it is `modal`.
- With `anchor`: `placement` (`"bottom"`, `"top"`, `"right"`, `"left"`), `offset` (4) and
  `matchWidth`. Pass the anchor as a function (`() => button`), because `ref` is only filled
  in when the button is created.
- `onDismiss` is called on a click outside (for a modal, on the backdrop; never on the anchor)
  and on Esc.
- An overlay opened later stays on top of the earlier ones.

`opacity` (0 to 1) and `translateX`/`translateY` work on any widget and are meant for
transitions, as in the `bun run overlays` example. They update with a signal and
`requestAnimationFrame`. `translate` moves the node and its children after layout, without
pushing its siblings, like CSS `transform`.

### Clipboard

```tsx
import { Button, clipboard, createSignal } from "@nodebuilderjs/core";

const [text, setText] = createSignal("");
<Button label="Copy" onClick={() => clipboard.writeText(text())} />
<Button label="Paste" onClick={async () => setText(await clipboard.readText())} /> // "" if there is no text
```

Static text can be selected and copied with `<Text selectable>`: dragging selects,
double-click picks the word, triple-click the line, Ctrl+A everything and Ctrl+C copies. It is
off by default, so labels and buttons don't get selected by accident.

It is the system clipboard (Wayland and X11), text only. `TextField` pastes with Ctrl+V or
Shift+Insert (line breaks become spaces). Without a window, as in tests, it is an in-memory
clipboard. On Wayland, the compositor only accepts a copy right after a key press or click
(the usual case: Ctrl+C, a "Copy" button).

### Testing

`@nodebuilderjs/core/testing` runs the app in `bun test` without a window, with fake text
metrics (8 px per character, 20 px lines) so layout is deterministic:

```tsx
import { expect, test } from "bun:test";
import { Button, Row, Text, createSignal } from "@nodebuilderjs/core";
import { click, findAllByText, findByLabel, interact, mount } from "@nodebuilderjs/core/testing";

test("play and pause", () => {
  const [playing, setPlaying] = createSignal(false);
  const { root } = mount(() => (
    <Row>
      <Text>Blue in Green</Text>
      <Button ariaLabel={() => (playing() ? "Pause" : "Play")} label="▶" onClick={() => setPlaying((p) => !p)} />
      <Text>Blue in Green</Text>
    </Row>
  ));
  click(findByLabel(root, "Play")!);
  expect(playing()).toBe(true);
  const ui = interact(root); // real event delivery: hit testing, hover, focus, capture
  ui.press(findByLabel(root, "Pause")!);
  ui.release(findByLabel(root, "Pause")!);
  expect(playing()).toBe(false);
  expect(findAllByText(root, "Blue in Green")).toHaveLength(2);
});
```

- `findByText`/`findAllByText` match `Text` content (a string or a RegExp);
  `findByLabel`/`findAllByLabel` match `ariaLabel`; `findAll(root, predicate)` is free-form.
  All of them also search open overlays.
- `click(node)` calls the nearest `onClick` directly; `interact(root)` delivers pointer and
  keyboard input like a window does (`hover`, `press`, `release`, `drag`, `scroll`, `key`,
  `type`, plus `down`/`up`/`move` at window positions). `frames()` controls time for
  animations.
- `click` and the node helpers of `interact` throw when a user could not reach the node: it
  is culled (outside the visible area in the last layout, e.g. overflowing a `clip` panel or
  a `Scroll`) or its center is clipped by an ancestor or the window. The error names the node
  and the ancestor; bring it into view with `scrollIntoView()` and `relayout()`, or give it
  room. Window positions (`down(x, y)`...) are not checked.

## Distributing

```sh
bun run package
```

Generates in `dist/` an **AppImage**, a **`.deb`**, an **`.rpm`** and a **`.tar.gz`**, each with
a single executable (Bun + your app + native core), a menu entry and an icon. Works on
Ubuntu 22.04+, Debian 12+, Fedora, RHEL 9+ and derivatives.

## Benchmarks

The same two scenes built with five technologies, measured in the same session:

| | Language | How it draws |
|---|---|---|
| **Electron 44** | JS + HTML/CSS | bundled Chromium |
| **Tauri 2** | JS + HTML/CSS (Rust only in the shell) | system WebKitGTK |
| **Flutter 3.47** | Dart | own engine (OpenGL ES) |
| **egui 0.36** | Rust | immediate mode, wgpu (Vulkan) |
| **nodebuilder** | TypeScript | own core (OpenGL ES) |

Electron and Tauri run exactly the same HTML/JS, with no framework. Machine: i7-12700H,
Intel Iris Xe, KDE Plasma (Wayland), 240 Hz monitor.

**Tauri and Flutter don't go above 60 fps on Linux**, even on a 240 Hz monitor. To compare
the same work, the table caps everyone at 60 fps. Each cell: **fps · CPU · memory**; 100% CPU
is one full core, memory is the summed PSS of all processes.

| Scene | Electron | Tauri | Flutter | egui | nodebuilder |
|---|---|---|---|---|---|
| **Dashboard** ([dashboard.tsx](examples/dashboard.tsx)): overview | 59 · 58% · 337 MB | 60 · 66% · 267 MB | 59 · 45% · 126 MB | 59 · 27% · 105 MB | 59 · 33% · 91 MB |
| Dashboard: table with 500 rows | 59 · 64% · 383 MB | 59 · 62% · 292 MB | 59 · 41% · 133 MB¹ | 54 · 72% · 112 MB | 49 · 54% · 161 MB |
| Dashboard: live logs | 59 · 94% · 408 MB | 59 · 142% · 298 MB | 59 · 47% · 135 MB¹ | 59 · 42% · 108 MB | 56 · 45% · 157 MB |
| Dashboard: settings | 59 · 44% · 308 MB | 60 · 51% · 267 MB | 60 · 38% · 123 MB | 60 · 23% · 105 MB | 59 · 24% · 83 MB |
| Dashboard: tab switch every 30 frames | 58 · 70% · 384 MB | 59 · 85% · 321 MB | 59 · 45% · 141 MB | 58 · 45% · 114 MB | 55 · 43% · 166 MB |
| **Grid** ([bench.tsx](examples/bench.tsx)): 1000 static cells | 0% · 310 MB | 0% · 216 MB | 0% · 147 MB | 0% · 106 MB | 1% · 81 MB |
| Grid: 1000 cells, one text changes | 58 · 58% · 321 MB | 60 · 37% · 228 MB | 59 · 51% · 155 MB | 59 · 49% · 108 MB | 57 · 39% · 110 MB |
| Grid: 1000 cells, all change | 59 · 128% · 413 MB | 29 · 147% · 277 MB | 21 · 96% · 173 MB | 59 · 68% · 113 MB | 58 · 44% · 139 MB |
| Grid: 3000 cells, all change | 49 · 172% · 447 MB | 20 · 123% · 351 MB | 7 · 140% · 243 MB | 46 · 84% · 128 MB | 50 · 94% · 194 MB |

¹ Flutter uses virtualized lists (`ListView.builder`), its default: it only builds the
visible rows. In the other four, every row exists.

**In short:**
- **The two web runtimes are the heaviest:** 216 to 447 MB, and much more CPU when a lot of
  text changes. Tauri uses 13% to 33% less memory than Electron, but can't sustain 60 fps
  in the heaviest scenes (29 and 20 fps).
- **egui is nodebuilder's closest rival:** almost constant memory (105 to 128 MB, no
  garbage collector) and the lowest CPU on the light dashboard tabs. Being immediate mode, it
  rebuilds the whole interface every frame, and that weighs on it when there are many
  elements: it loses on the table (72% vs. 54%) and when 1000 texts change (68% vs. 44%).
- **Flutter** uses little memory and little CPU on the dashboard, but is locked at 60 fps and
  drops to 21 and 7 fps when thousands of texts change every frame.
- **nodebuilder** has the lowest memory when idle (81 MB) and on the light dashboard tabs, and
  the lowest CPU when 1000 texts change every frame (44%; with 3000, egui uses less, but at
  46 fps vs. 50). In this round it lost fps on the 500-row table (49 vs. 54 to 59)
  because it measured and drew what was off screen; that has since been fixed (see below).
  On the table, the logs and the tab switching it uses more memory than egui and Flutter (157
  to 166 MB): that is the JavaScript heap.
- **With a 120 fps cap**, only Electron, egui and nodebuilder go above 60: Electron stays
  between 107 and 117 fps, egui between 102 and 119 and nodebuilder between 80 and 118 (with
  3000 cells, all of them at 45–51 fps).
- **After this round**, nodebuilder started skipping what is outside the visible area
  (culling). Measured before and after in the same session: the 500-row table went from 78 to
  104 fps with a 120 cap (CPU from 82% to 51%) and, with a 60 cap, from 55% to 40% CPU;
  "one text changes out of 1000" dropped from 39% to 23% CPU. With a 60 cap, fps still stays
  below 59 in every scene, because of frame scheduling ([roadmap](ROADMAP.md)).
- **Size:** Tauri is 5.7 MB (it uses the system WebKit), egui 15 MB, Flutter 23 MB,
  nodebuilder ~91 MB (~31 MB compressed, almost all of it the Bun runtime) and Electron
  ~280 MB.

Ergonomics matter too: with egui you write Rust; with Flutter, Dart; with Electron and Tauri,
HTML/CSS/JS (with Rust for Tauri's native side); with nodebuilder, TypeScript with JSX, which
is what most web devs (and LLMs) already write.

### Why is Tauri so close to Electron?

Tauri swaps Electron's browser (Chromium) for the system one (on Linux, WebKitGTK), but it is
still a browser. The expensive work, which is running the JS, applying the CSS, laying out the
DOM and painting, happens in a full engine in both cases; Tauri's Rust only opens the window.
Measuring process by process in the logs scene:

| Process | Tauri | Electron |
|---|---|---|
| Page (JS, DOM, CSS, layout, painting) | 172 MB · 131% CPU | 163 MB · 82% CPU |
| Window / main process | 87 MB | 86 MB |
| GPU, network and utilities | 33 MB (1 process) | 115 MB (5 processes) |

- **Memory:** the page process costs almost the same in both. Tauri only saves on the helper
  processes, which gives 13% to 33% less memory than Electron in the measured scenes.
- **CPU:** WebKitGTK paints the page on the CPU (`SkiaCPUWorker` threads, ~45% of a core),
  while Chromium paints on the GPU. That is why Tauri spends more precisely when a lot of text
  changes every frame.
- **"Tauri is lightweight"** mostly refers to the download size: it doesn't ship a browser
  along with it.

nodebuilder has no browser engine: there is no CSS cascade or DOM to recompute, a signal
updates the node that changed directly, everything is drawn on the GPU with one draw call per
frame, and it is a single process. In exchange, it offers fewer features than the web (see
limitations below).

These numbers apply to Linux. On Windows Tauri uses WebView2 (Chromium) and on macOS the
system WebKit; the results there may differ.

Measured on 2026-10-11. To reproduce, see [ARCHITECTURE.md](ARCHITECTURE.md#measuring-performance).

## Current limitations

- Linux x64 only (arm64, Windows and macOS are on the roadmap).
- Text with a single font (emojis don't show up); a word longer than the line overflows.
- Text field without selection, copy or undo (paste works).
- SVG only in the icon subset (no gradients, text, filters); AVIF/HEIC depend on the system
  `libheif`.
- The dark theme doesn't follow the system preference on its own (on Linux it comes from the
  XDG portal over D-Bus, not read yet): call `setTheme` from an app option.
- An indeterminate `ProgressBar` and `Spinner` request frame after frame while they are shown
  (low CPU, but not zero); hide them when the wait is over.
- Animations of numbers only (`opacity`, `translate`, sizes, colors with `mixColor`): no
  `scale`/`rotate`, declarative style transitions (CSS `transition`) or springs. No
  accessibility or IME (keyboards for Asian languages).
- `opacity` is applied to each thing drawn, not to the group: overlapping children
  show through each other.
- Scrolling without inertia or animation (the wheel and keys jump straight there), without
  auto-scroll when dragging a selection to the edge and without repeat when holding the click
  on the scrollbar track.

## Contributing

```sh
git clone https://github.com/felipebrgs1/nodebuilderjs && cd nodebuilderjs
bun install
bun run build:native     # compiles the C core (needs the Wayland, X11, EGL... headers)
bun run counter          # runs an example
bun test && bun run typecheck
```

Development follows TDD: new behavior or a bug fix starts with a failing test
(`bun test` runs without a window, in ~0.1 s). [ARCHITECTURE.md](ARCHITECTURE.md) explains how
the framework is organized internally, and [AGENTS.md](AGENTS.md) has the rules, the
conventions and how to test each layer.

## License

[MIT](LICENSE)
