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

> **Status:** version 0.4, experimental. The API may still change. See the [roadmap](ROADMAP.md).

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

Window does not open, text looks wrong or something fails to load? Run the doctor:

```sh
bun run doctor     # or: bunx nodebuilder doctor
```

```
✓ Bun 1.4.3
✓ native core: @nodebuilderjs/linux-x64 (glibc 2.34 required, system 2.39) · FreeType 2.13.2 · HarfBuzz 8.3.0
✓ Wayland (WAYLAND_DISPLAY=wayland-0)
✓ compose table for pt_BR.UTF-8 (dead keys, accents)
✓ GLES offscreen: Mesa Intel(R) Xe Graphics (OpenGL ES 3.2 Mesa 25.2)
✓ UI font: Noto Sans
! no color emoji font: emoji draw as boxes or in monochrome
    → sudo apt install fonts-noto-color-emoji
- libheif not found: AVIF/HEIC images disabled
```

It checks Bun, the native core and the system libraries it links to (naming the apt, dnf or
pacman package of each missing one), the display server a window would use, the keyboard's
compose table, GL, the UI font and the emoji and CJK fallbacks, and libheif. It exits 1 when
something is broken. `--json` is for scripts and coding agents; `--window` tests GL by opening
a small window for a moment (by default GL is tested offscreen, and on a laptop with two GPUs
the window may use the other one). Paste its output in bug reports.

The `AGENTS.md` and skills in `.agents/skills` that coding agents read describe the framework
version the app was created with. After updating `@nodebuilderjs/core`, bring them along:

```sh
bun run agents:update   # or, in apps created before 0.4.1: bunx nodebuilder agents update
```

It replaces only docs the framework released (it knows the hash of every version). A doc
edited in the app is kept and listed (`--force` replaces it), and in `AGENTS.md` only the block
between the `nodebuilder:begin`/`end` markers is the framework's: notes after it stay. The
doctor warns when the docs are behind.

## How it works, in 30 seconds

- **Components run once.** There is no re-render and no virtual DOM. State is `createSignal`,
  derived values are `createMemo`.
- **Only functions are reactive.** `<Text>{count}</Text>` updates on its own;
  `<Text>{count()}</Text>` reads the value once. The same goes for styles:
  `background={() => (active() ? "#3584e4" : "#ffffff")}`.
- **Styles are props, not CSS:** `padding`, `gap`, `grow`, `align`, `justify`, `background`,
  `radius`, `color`, `fontSize`... The layout is flexbox.
- **Built-in widgets:** `Window` (with `WindowControls` for a custom title bar), `Column`, `Row`, `Scroll`, `Text`, `Image`, `Icon`, `Canvas`,
  `Button`, `TextField`, `Checkbox`, `Toggle`, `RadioGroup`, `Slider`, `Select`, `Tabs`,
  `Tooltip`, `Dialog`, `ProgressBar`, `Spinner`, `Card`, `Divider`, `Spacer`, plus `<For>`/`<Index>`,
  `<Show>`/`<Switch>` and `<ErrorBoundary>` for lists, conditions and errors, and
  `createContext` for values shared down the tree.

Complete examples in [`examples/`](examples): counter, to-do list, images, icons,
freehand drawing, charts, overlays (menu, dialog and tooltip), text (paragraphs, alignment,
ellipsis), scrolling (horizontal, both axes, `scrollIntoView`) and a dashboard
with tabs, a table and a chart.

### Layout

A simplified flexbox: `Column`/`Row`, `gap`, `padding`, `grow`, `align` (stretch by default;
`alignSelf` overrides it for one child), `justify`, `min/max` sizes, `wrap`, `margin`, plus
`Grid` and `aspectRatio`. Sizes (`width`, `height`, `min*`, `max*`) also take a percentage of the
parent's content box, as in CSS (`width="50%"`):

- **`margin`** (`8`, `[v, h]` or `[top, right, bottom, left]`, like `padding`): space outside the
  border that the parent keeps free. It adds to the child's size in everything around it
  (natural sizes, `grow`, shrinking, `Grid` cells, `wrap` lines); a stretched child gets the
  room minus its margins. Negative values pull a neighbor over or let a child bleed into its
  parent's padding (`margin={[0, -16]}` in a `Card` runs edge to edge). It is not painted and
  not clickable. On an absolute child it adds to `left`/`top`/`right`/`bottom`. Margins do not
  collapse (unlike CSS block margins) and add to `gap`.

- **`<Row wrap gap={6} rowGap={8}>`** (CSS `flex-wrap: wrap`): children that do not fit start
  a new line (chips, tags). Each line is laid out on its own (`grow`, `justify`, `alignSelf`
  inside the line), is as tall as its tallest child and lines stack from the top, `rowGap`
  (default `gap`) apart. Its natural width is a single line and its minimum the widest child,
  so a stretched or shrunk Row wraps at whatever width it gets and its height follows. A
  `<Column wrap>` breaks into columns at its height (give it one). On `<Text>`, `wrap` is
  word wrapping instead.

  ```tsx
  import { Box, Row, Text } from "@nodebuilderjs/core";

  const Tags = (props: { tags: string[] }) => (
    <Row wrap gap={6}>
      {props.tags.map((t) => <Box padding={[4, 10]} radius={12} background="#00000010"><Text>{t}</Text></Box>)}
    </Row>
  );
  ```

- **`<Grid columns={4} gap={8} rowGap={12}>`:** children flow into rows of equal-width cells
  (CSS `grid-template-columns: repeat(4, 1fr)`); the last row keeps empty cells, so widths stay
  equal. Each row is as tall as its tallest cell and cells stretch to it (`align`/`alignSelf`
  change that). `rowGap` defaults to `gap`. Works with `<For>` (items stay keyed; adding one
  reflows the cells).
- **`<Grid minColumnWidth={180}>`:** as many columns as fit at least 180 px wide, sharing the
  leftover (CSS `repeat(auto-fill, minmax(180px, 1fr))`): the grid reflows as the window
  resizes. `columns` next to it is the most per row.
- **`aspectRatio`** (width / height) on any widget: the free side follows the other, like CSS
  `aspect-ratio`. In a column (or a `Grid` cell) the height follows the width; with a fixed
  `height`, or stretched in a `Row` of known height, the width follows the height. `min/max`
  still clamp; children taller than the ratio make a box taller (an `Image` takes the ratio as
  is). In a `Grid`, an `aspectRatio` cell keeps its shape instead of stretching to the row.

  ```tsx
  import { Grid, Image } from "@nodebuilderjs/core";

  const covers = ["a.jpg", "b.jpg", "c.jpg", "d.jpg"];
  const Covers = () => (
    <Grid columns={3} gap={8}>
      {covers.map((src) => <Image src={src} aspectRatio={1} fit="cover" radius={8} />)}
    </Grid>
  );
  ```
- **Equal or proportional columns in a row:** `width={0} grow={1}` on each child (CSS
  `flex: 1 1 0`); the widths follow the `grow` values (1:1:2), not the content. In a column
  with a height, `height={0} grow={1}` does the same for rows.
- **`position="absolute"`** with `left`/`top`/`right`/`bottom` (from the parent's content box,
  inside its `padding`): out of the flow and at its natural size, unless both `left` and `right`
  (or `top` and `bottom`) are set without a `width` (`height`): then it stretches between them,
  so `left={0} right={0} top={0} bottom={0}` fills the parent. `right` alone places it from the
  right edge. Inside a `Scroll` it scrolls with the content, like CSS. What sticks out of a parent
  that does not `clip` is drawn and clickable there too.
- **`zIndex`** (default 0) orders siblings: higher is drawn and hit above, ties keep child order
  (so without it, a later child covers an earlier one). It only orders siblings, with no global
  stacking context: a raised node stays inside its parent's place in the order. Overlays stay
  above everything.
- `radius` is one number or one per corner, `[topLeft, topRight, bottomRight, bottomLeft]`
  (`radius={[0, 12, 12, 0]}`); borders, `clip` and `shadow` follow it.
- `clip` cuts the children to the box, rounded by `radius`; `shadow={{ color, blur, y }}` is
  drawn around the box, never under it (as in CSS): without a `background`, or with a
  translucent one, the inside stays clear. Like CSS `overflow:
  hidden`, a clipping node may shrink below its content (what it cuts is neither seen nor
  clicked); give it a `minHeight` where that must not happen. `run()` warns about it in
  development.
- **Gradients:** `background={{ linear: ["#1db954", "#121212"], angle: 180 }}` is a CSS
  `linear-gradient`: `angle` in degrees (0 = to top, 90 = to right, default 180 = to bottom),
  stops as colors or `[color, offset]` (offset 0 to 1; missing offsets are spread evenly).
  Corners, `radius`, borders and `opacity` work as with a color, and it can be reactive
  (`background={() => ({ linear: [theme.accent.base, "transparent"] })}` follows the theme).
  Colors are interpolated in premultiplied space like CSS, so fading to `"transparent"` never
  turns gray. Borders, text and shadows stay solid colors.
- **Overflow warnings (development):** when children need more room than their container
  gives them (after wrapping text and `grow` children have shrunk) and the excess is hidden by
  a `clip` ancestor or the window, `run()` prints it once per node, e.g.
  `layout: Row > Text("Artists") overflows Box(panel) by 42px (children need 342px, 300px
  available)`, and `debugTree()` marks the container `[overflow +42]`. Content past a `Scroll`
  on its scrolling axis is not reported (scrolling shows it). Silent with
  `NODE_ENV=production` and in packaged executables. Fix it with a `Scroll horizontal`,
  wrapping, `minWidth={0}` plus `clip` on the child that may be cut, or more room.

### Hover and press

`hoverStyle` and `pressStyle` work on every widget (CSS `:hover` and `:active`). They take
any style props, static or as accessors, shown over the base style while the pointer is over
the widget or pressing it:

```tsx
<Box padding={12} radius={8} background="#ffffff"
  hoverStyle={{ background: "#f2f2f4" }} pressStyle={{ background: "#e6e6ea", opacity: 0.9 }}>
  <Text>Row</Text>
</Box>
```

- `pressStyle` wins over `hoverStyle`; leaving brings back the base values, which stay
  reactive underneath (a signal that changed meanwhile shows its latest value).
- `focusStyle` applies while the widget has the keyboard focus (a custom focus ring); hover
  and press win over it.
- They win over a widget's own hover colors (a `Button`'s theme background); a `disabled`
  widget ignores them.
- `hoverStyle` alone leaves presses alone; `pressStyle` (and `createInteraction().props`)
  make the widget handle the press, so inside a window's drag region it no longer moves the
  window.
- Like `:active`, a parent's `pressStyle` also shows while a child (a button in the card) is
  pressed; `onPointerDown={(e) => e.stop()}` on the child (or on a `Box` around a `Button`)
  keeps the press to the child.

When something else depends on the state, such as a play button that only shows while its card
is hovered, `createInteraction()` gives `hovered`, `pressed` and `focused` accessors and
`props` to spread on the widget:

```tsx
const card = createInteraction();
<Box {...card.props} padding={12} background={() => (card.hovered() ? "#f2f2f4" : "#ffffff")}>
  <Text>Song</Text>
  <Show when={card.hovered}>
    <Button label="Play" onClick={() => {}} />
  </Show>
</Box>;
```

The pointer is still over the card while it is over the play button. `props` adds to the
widget's own handlers and to `onPointerEnter`/`onPointerLeave`/... written next to it,
before or after the spread; nothing is replaced, and several interactions can share a widget.
`focused` only changes on focusable widgets (`Button`, `TextField`...).

### Events

Any widget takes `onClick`, `onPointerDown`/`Up`/`Enter`/`Leave`/`Move`, `onScroll`,
`onKeyDown`, `onFocus` and `onBlur` (controls too: they are added to the control's own
handlers, never replace them). Pointer events carry `x`/`y` (window), `localX`/`localY`
(node), `button` (0 left, 1 middle, 2 right) and `clicks` (2 = double click).

- `onClick` is the left button only and runs on the innermost node that has one (pressed and
  released on it): a button inside a clickable card clicks the button, not the card.
- `onPointerDown`, `onPointerUp`, `onPointerMove`, `onScroll` and `onKeyDown` bubble from the
  innermost node to the root until a handler calls `e.stop()`, also past nodes with `onClick`:
  a list's `onPointerDown` with `e.button === 2` (context menu) sees a right press on any of
  its clickable rows. On keys and the wheel, `stop()` also keeps the surrounding `Scroll` still.
- While a button is held, `onPointerMove` keeps reaching the node where the press started.
- Keys start at the focused element; with nothing focused they go to the `Window` (and, with
  a modal open, to the modal first): `<Window onKeyDown={...}>` sees every key nothing below
  took, which makes window-wide shortcuts. On a control, the app's `onKeyDown` runs first and
  `e.stop()` takes the key from the control.
- `focusable` on a container (`<Column focusable onKeyDown={...}>`) lets a page or a menu hold
  the keyboard: a click focuses it, without a focus ring; `tabStop` adds it to the Tab order.

### Images

```tsx
import { Column, Image } from "@nodebuilderjs/core";
import logo from "./logo.png" with { type: "file" };
import photo from "./photo.jpg" with { type: "file" };

<Column gap={8}>
  <Image src={logo} width={64} />                                 {/* height follows the aspect ratio */}
  <Image src={photo} width={200} height={120} fit="cover" radius={12} opacity={0.8} />
</Column>
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
import { Button, Icon, Row, Text } from "@nodebuilderjs/core";

<Row gap={8}>
  <Icon svg={camera} />                        {/* 20 px, color inherited like text */}
  <Icon svg={heart} size={32} color="#e01b24" />
  <Button variant="primary"><Icon svg={Star} size={16} /><Text>Favorite</Text></Button>
  <Icon svg={Star} fill />                     {/* solid: outline icons filled with their color */}
</Row>
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

Many icons: let the CLI write the imports into one module instead of by hand.

```sh
bun add lucide-static
nodebuilder icons add play pause heart arrow-left       # -> src/icons.ts (--out to change)
nodebuilder icons add heart-fill house --from @phosphor-icons/core   # weights by suffix
nodebuilder icons list arrow                            # names containing "arrow"
```

Each icon becomes one sorted, deduplicated line, `import arrowLeft from
"lucide-static/icons/arrow-left.svg" with { type: "text" }; export { arrowLeft };` (camelCase
name; the rest of the file is kept), so `import { arrowLeft } from "./icons.js"` gives the SVG
text and `nodebuilder package` embeds it. Each file is checked in `node_modules`; an unknown
name fails with close matches (`did you mean heart-crack?`) and writes nothing. Not
`export { default as x } from "x.svg" with { type: "text" }`: Bun drops the attribute on a
re-export and gives the file's path; the command rewrites such lines it finds.

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
`g.text(text, x, y, color, size?, bold?, { maxWidth, ellipsis, weight, italic, letterSpacing, family, features, variations })`
draws one line; with `maxWidth` text that does not fit is cut and ends in "…" (`ellipsis:
false` just cuts it; nothing is drawn when not even the "…" fits); `weight` wins over `bold`.
`g.measureText(text, size?, bold?, { weight, italic, letterSpacing, family, features, variations })`
(`{ width, height }`) measures it, to align it. Without `family`, `features` or `variations`,
canvas text uses the `fontFamily`, `fontFeatures` and `fontVariations` around the canvas, so
charts follow the app's font.
Lines take a dash pattern (`g.line(..., cap, [4, 3])`, `g.polyline(..., { dash })`).
`g.linearGradient(x0, y0, x1, y1, stops)` returns a gradient (from offset 0 at the first point
to 1 at the second, in canvas coordinates) that every shape takes in place of a color:
`g.polygon(area, g.linearGradient(0, 0, 0, g.height, ["#3584e480", "transparent"]))`.
Limits: a self-intersecting polygon is not drawn, and lines with a translucent color get darker
at the joins.

### Charts

```tsx
import { LineChart, Line, Area, AreaChart, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Legend } from "@nodebuilderjs/core/charts";

const sales = [{ month: "Jan", revenue: 120, target: 100 }, { month: "Feb", revenue: 150, target: 110 }];

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
import { Box, Column, Scroll, TextField, Text, createContext, createSignal, onMount, useContext, type ElementRef } from "@nodebuilderjs/core";

// Context: a value any descendant can read, without passing props through every level.
const Language = createContext("en");
function Greeting() {
  return <Text>{useContext(Language) === "en" ? "Hello" : "Olá"}</Text>;
}
<Language.Provider value="pt"><Greeting /></Language.Provider>;

// ref: the widget's element, to focus, scroll and read the box from the last layout.
const [name, setName] = createSignal("");
<TextField ref={(el) => el.focus()} value={name} onInput={setName} />;

// onMount: runs once the component's nodes are in the tree and its refs are set.
function Chat() {
  let list: ElementRef | undefined;
  onMount(() => list!.scrollTo(1e9));
  return <Scroll ref={(el) => (list = el)} height={200}><Text>...</Text></Scroll>;
}

// onResize: the node's size after layout (the first time and whenever it changes).
// What it changes is laid out in the same frame.
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
  widget enters the tree. Code that uses the element once it exists goes in `onMount` (an
  effect in the component body runs before the JSX below it, so the ref is still unset).
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
- `Spinner` spins while it is on screen (`size`, `color`). `ProgressBar` and `Slider` take
  `color` (the filled part) and `background` (the track).
- `Button`'s `variant` may be a function: the colors, hover and weight follow it.
- `<TextField password>` draws `•` for each character (the value stays real; a function
  toggles it for a "show password" button). A `TextField` keeps the app's `borderColor` and
  `borderWidth` when focused; `focusBorderColor`/`focusBorderWidth` restyle its focus ring.

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
  turns that off). `inset={[theme.window.titlebarHeight + 1, 0, 0, 0]}` leaves the title bar
  usable while it is open (the same prop works on `<Overlay>`).

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
- `mixColor(a, b, t)` blends two colors into `"#rrggbbaa"`, alpha included, in premultiplied
  space like CSS: `mixColor("#ff0000", "transparent", 0.5)` is red at half alpha, not gray.
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
- `fontWeight` (1..1000, as in CSS: 300 light, 400 regular, 600 semibold, 700 bold, 900
  black) picks the closest face the system font has (a variable font gets exactly that
  weight); `bold` is shorthand for 700 (`bold={false}`: 400), and on the same widget
  `fontWeight` wins. `italic` uses the italic face, or slants the upright one when the family
  has none. `letterSpacing` (px, may be negative) goes after every character, the last one
  too, as in browsers; it turns ligatures off. All three are inherited, like `fontSize`:
  `<Column fontWeight={500}>`. Wrapping, selection and `underline` follow them.

```tsx
import { Text } from "@nodebuilderjs/core";

<Text fontWeight={300} fontSize={28}>Light headline</Text>;
<Text fontSize={12} bold letterSpacing={1.5}>SECTION</Text>;
<Text italic>An aside</Text>;
```

### Fonts

`fontFamily` takes a CSS family list, inherited like `fontSize`: fonts the app registers,
installed families by name, and the generic `sans-serif` (the default, the system UI font),
`serif`, `monospace`, `cursive`, `fantasy`, `emoji`, `math` and `system-ui`. Names match without
case and may be quoted. Each character uses the first family of the list that has it, then the
system's fallback; families that are not there are skipped.

`registerFont(source, options?)` adds a font file to the families, like CSS `@font-face`:
`source` is a path or the file's bytes, and an import `with { type: "file" }` keeps working in
the packaged executable. TrueType (`.ttf`), OpenType/CFF (`.otf`), collections (`.ttc`, every
face), WOFF and WOFF2; family, weight and slant come from the file (`{ family, weight, italic }`
override them; `weight: [100, 900]` for a range). Register every weight and slant under the
same family: text picks among them with the CSS rules (a variable font covers its whole `wght`
range), and synthesizes what the family lacks: bold (thicker outlines) and italic (slanted
glyphs). It returns the faces it added. Text already on screen is measured and drawn again.

`fontFeatures` turns OpenType features on and off (`"tnum"`, `"smcp, onum"`, `"-liga"`,
`'"ss01" 1'`: CSS `font-feature-settings` syntax, or HarfBuzz's) and `fontVariations` sets the
axes of variable fonts (`"wdth 75, opsz 12"`, CSS `font-variation-settings`; a `wght` there wins
over `fontWeight`). Both are inherited. `fontFamilies()` lists the installed and registered
families (sorted), e.g. for a font picker.

```tsx
import { Column, Text, registerFont } from "@nodebuilderjs/core";
import interRegular from "./fonts/Inter-Regular.woff2" with { type: "file" };
import interBold from "./fonts/Inter-Bold.woff2" with { type: "file" };

registerFont(interRegular);
registerFont(interBold);

<Column fontFamily="Inter, sans-serif">
  <Text bold>Inter Bold</Text>
  <Text fontFamily="monospace" fontFeatures="zero">0O 1l</Text>
  <Text fontFeatures="tnum">1,234.50</Text>
</Column>;
```

- `underline`: a line under each line of text, in the text color (it follows wrapping,
  `textAlign` and the "…" of `maxLines`). Like `color`, `fontSize` and `bold` it is inherited,
  so `<Button underline>` or a `Row underline` underlines the text inside; `underline={false}`
  turns it off again below. `TextField` ignores it. A link that underlines on hover:
  `<Text underline={hovered} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>`.
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
import { Button, Row, clipboard, createSignal } from "@nodebuilderjs/core";

const [text, setText] = createSignal("");
<Row gap={8}>
  <Button label="Copy" onClick={() => clipboard.writeText(text())} />
  <Button label="Paste" onClick={async () => setText(await clipboard.readText())} /> {/* "" if there is no text */}
</Row>
```

Static text can be selected and copied with `<Text selectable>`: dragging selects,
double-click picks the word, triple-click the line, Ctrl+A everything and Ctrl+C copies. It is
off by default, so labels and buttons don't get selected by accident.

It is the system clipboard (Wayland and X11), text only. `TextField` pastes with Ctrl+V or
Shift+Insert (line breaks become spaces). Without a window, as in tests, it is an in-memory
clipboard. On Wayland, the compositor only accepts a copy right after a key press or click
(the usual case: Ctrl+C, a "Copy" button).

### Window and title bar

`<Window>` draws its own title bar (title and the minimize, maximize and close buttons), border,
rounded corners and resize edges. For a header merged with the title bar (a search field next
to the window buttons, as in music players and browsers), turn it off with
`decorations={false}` and build your own:

```tsx
import { Row, Spacer, Text, TextField, Window, WindowControls, createSignal } from "@nodebuilderjs/core";

const [query, setQuery] = createSignal("");
<Window title="Player" decorations={false}>
  <Row dragRegion height={56} align="center" gap={12} padding={[0, 12]}>
    <Text bold>Player</Text>
    <TextField width={280} value={query} onInput={setQuery} placeholder="Search" />
    <Spacer />
    <WindowControls />
  </Row>
  {/* content */}
</Window>
```

- **`dragRegion`** works on any widget: pressing on it moves the window and a double click
  maximizes or restores it. A press on something inside it that handles the press (a button,
  a text field, anything clickable, focusable or with `onPointerDown`) stays with that
  child, so plain text and empty space drag, controls don't.
- **`<WindowControls />`** is the built-in bar's three buttons, labelled "Minimize",
  "Maximize"/"Restore" and "Close"; it takes style props (`gap`, `padding`...).
- Without decorations the border, corners and resizing from the edges stay. For your own
  buttons, `windowControls.minimize()`, `.toggleMaximize()`, `.close()` and `.setTitle(t)`;
  `windowState.maximized()`, `.activated()` (the window has focus), `.width()` and
  `.height()` are reactive.

**Icon.** `<Window icon={icon}>` sets the icon the taskbar and the window switcher show:
SVG markup or an `.svg`, PNG, JPEG or WebP file, imported with `with { type: "file" }` so it
gets into the package. Without one, the window gets the nodebuilder icon instead of the
compositor's generic one. On Wayland it needs the `xdg-toplevel-icon` protocol (KDE Plasma 6.1+);
without it (GNOME), the compositor shows the icon of the installed `.desktop` file whose name
matches `appId`, which `nodebuilder package` installs.

```tsx
import { Window } from "@nodebuilderjs/core";
import icon from "./icon.svg" with { type: "file" };

<Window title="Notes" appId="com.example.notes" icon={icon}>{/* content */}</Window>;
```

**Hiding.** `windowControls.hide()` takes the window off the screen and the taskbar while the
app keeps running (in the tray, below); `windowControls.show()` brings it back and
`windowState.visible()` is reactive.

### System tray

`createTray` shows an icon in the system tray while the scope that created it lives (closing
the window disposes it). Every option may be an accessor; the item updates when it changes:

```tsx
import { Window, createSignal, createTray, run, windowControls, windowState } from "@nodebuilderjs/core";

run(() => {
  const [unread, setUnread] = createSignal(0);
  let quitting = false;
  const tray = createTray({
    tooltip: () => `${unread()} unread`,
    onClick: () => (windowState.visible() ? windowControls.hide() : windowControls.show()),
    menu: () => [
      { label: "Mark all read", onClick: () => setUnread(0), enabled: unread() > 0 },
      "separator",
      { label: "Quit", onClick: () => ((quitting = true), windowControls.close()) },
    ],
  });
  // Closing hides to the tray, if there is one.
  return <Window title="Mail" onClose={() => quitting || !tray.available() || (windowControls.hide(), false)} />;
});
```

- `icon` takes the same inputs as `<Window icon>` (default: the nodebuilder icon); `title` names
  the item; `onMiddleClick` handles the middle button. Without `onClick`, a left click opens the
  menu too.
- Menu items: `label`, `onClick`, `enabled`, `visible`, `checked` (a checkmark; with `radio`, a
  radio dot) and `children` (a submenu); `"separator"` draws a line.
- `tray.available()` is true while a panel shows the item. It is a StatusNotifierItem over D-Bus
  (our own client, no libdbus): KDE Plasma, Xfce, Cinnamon, Budgie and others show it; GNOME
  only with the AppIndicator extension. Without a tray, `available()` stays false: keep a way to
  quit that does not depend on it.

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

- `findByText`/`findAllByText` match `Text` content (a string or a RegExp), in tree order with
  open overlays last; `{ in: "Button" }` keeps only text inside that kind of widget (the
  "Quit" button, not the dialog title that says the same). `findByLabel`/`findAllByLabel`
  match `ariaLabel`; `findByValue`/`findAllByValue` match what a `TextField` holds and
  `findByPlaceholder` an empty one; `shownText(node)` is what a node draws (`"•••"` for a
  password); `findAll(root, predicate)` is free-form. All of them also search open overlays.
- The `mount` (and `run`) callback runs once, untracked, like a component body: reading and
  setting a signal there does not loop. An effect that keeps writing a signal it reads throws
  "reactive update loop detected" instead of hanging.
- A `ref` that calls `focus()` while the tree is created focuses as soon as it is inserted:
  `interact(root).key(...)` right after `mount` reaches it. Nodes built by an `onResize`
  handler are placed by the same `relayout()`.
- `click(node)` calls the nearest `onClick` directly; `interact(root)` delivers pointer and
  keyboard input like a window does (`hover`, `press`, `release`, `drag`, `scroll`, `key`,
  `type`, plus `down`/`up`/`move` at window positions). `frames()` controls time for
  animations.
- `click` and the node helpers of `interact` throw when a user could not reach the node: it
  is culled (outside the visible area in the last layout, e.g. overflowing a `clip` panel or
  a `Scroll`) or its center is clipped by an ancestor or the window. The error names the node
  and the ancestor; bring it into view with `scrollIntoView()` and `relayout()`, or give it
  room. Window positions (`down(x, y)`...) are not checked.
- `layoutWarnings()` (returned by `mount`, or `layoutWarnings(root)`) lists the overflow
  warnings of the last layout (see Layout); `expect(layoutWarnings()).toEqual([])` catches a
  child hidden by a too-narrow panel before a click finds it. `mount` does not fail on them by
  itself: a deliberate overflow (a clipped marquee) is allowed.
- **Text metrics:** fake by default. `useFakeTextMetrics({ charWidth, lineHeight })` changes
  them; `useRealTextMetrics()` makes this and every later `mount` measure with the installed
  fonts (the native core's FreeType + HarfBuzz, still no window) and returns a function that
  puts the previous metrics back. Real metrics catch overflow that 8 px per character hides,
  but they depend on the machine's fonts: assert relations ("fits", "narrower than"), not
  exact pixels, and guard with `test.skipIf(!canUseRealTextMetrics())`.

```tsx
import { afterEach, expect, test } from "bun:test";
import { Row, Text } from "@nodebuilderjs/core";
import { canUseRealTextMetrics, layoutWarnings, mount, useFakeTextMetrics, useRealTextMetrics } from "@nodebuilderjs/core/testing";

afterEach(() => useFakeTextMetrics());

test.skipIf(!canUseRealTextMetrics())("the header fits with real fonts", () => {
  useRealTextMetrics();
  const { root } = mount(() => (
    <Row width={240} clip>
      <Text>Recently played</Text>
    </Row>
  ));
  expect(layoutWarnings(root)).toEqual([]);
});
```

#### Seeing the UI: screenshots without a window

Tests check boxes and draw commands, not how the result looks. A screenshot renders the real
pixels (fonts, colors, shadows, icons, images) with the GPU but **no window and no display
server** (EGL surfaceless: works in CI, containers and agent sandboxes):

```sh
nodebuilder screenshot src/main.tsx shot.png                    # the app at its <Window> size
nodebuilder screenshot src/main.tsx shot@2x.png --scale 2 --theme dark --width 1024 --height 700
```

The command runs the app with `NB_SCREENSHOT=<out.png>` set, so `run()` lays out, lets
animations finish on a simulated clock (`--wait-frames <n>` to stop earlier), renders one
frame offscreen, writes the PNG and exits. To shoot a given page, let the top component take
its initial state as props and render the component a file exports, with those props (the
file must not call `run()` itself; `--export` picks a named export instead of the default):

```sh
nodebuilder screenshot src/App.tsx settings.png --export App --props '{"page":"settings"}'
```

In tests:

```tsx
import { expect, test } from "bun:test";
import { Box } from "@nodebuilderjs/core";
import { canScreenshot, mount, savePNG, screenshot } from "@nodebuilderjs/core/testing";

test.skipIf(!canScreenshot())("the banner is red", () => {
  const { root } = mount(() => <Box height={40} background="#e01b24" />, { width: 200, height: 40 });
  const shot = screenshot(root, { scale: 2 }); // 400x80 device pixels, real text metrics
  expect(shot.pixel(10, 10)).toEqual([0xe0, 0x1b, 0x24, 255]);
  savePNG(shot, "banner.png"); // or shot.toPNG()
});
```

`screenshot(root | view, { width, height, scale, background })` returns `{ width, height,
scale, rgba, pixel(x, y), toPNG() }` (a view that is a `<Window>` is shot at its `width` and
`height`, filled by it, as in the app; so is `mount()` without a size); `rgba` has straight (not premultiplied) alpha, rows top
to bottom, and what nothing covers stays transparent (the window's rounded corners too). The
tree is laid out with real fonts for the shot and gets its own metrics (fake, by default) back afterwards.
Pixels depend on the installed fonts and GPU driver: compare colors at points, not whole images.

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
- Screenshots (`nodebuilder screenshot`, `screenshot()`) need a GPU driver with EGL
  (Mesa or NVIDIA); a process that took one can't open a window afterwards.
- A family without the weight or slant asked for uses the closest face, emboldened or slanted
  (synthetic, like browsers). A word longer than the line overflows. Characters the UI font lacks (symbols, CJK, emoji) come from the
  system's fallback fonts and color emoji are drawn in color (Noto Color Emoji and other
  CBDT, sbix or COLRv0 fonts; COLRv1-only fonts are not rendered in color). No bidi: a
  right-to-left run is shaped, but lines are not reordered.
- Text field without selection, copy or undo (paste works).
- The window icon needs the `xdg-toplevel-icon` Wayland protocol (KDE Plasma 6.1+); GNOME shows
  the `.desktop` icon matching `appId` (installed by `nodebuilder package`). The tray needs a
  StatusNotifierItem host (GNOME: the AppIndicator extension).
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
- Linear gradients only (no radial or conic ones), as backgrounds and Canvas fills; borders,
  text and shadows are solid colors.
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
