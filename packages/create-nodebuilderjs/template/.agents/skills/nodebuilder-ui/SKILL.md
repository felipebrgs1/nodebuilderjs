---
name: nodebuilder-ui
description: nodebuilder widgets, style props and layout (Window, Column, Row, Scroll, Text, Button, TextField, Checkbox, Toggle, RadioGroup, Slider, Select, Tabs, Tooltip, Dialog, ProgressBar, Spinner, Card, For, Index, Show, Switch/Match, ErrorBoundary, theme), scrolling (vertical, horizontal, scrollbars, keyboard, scrollIntoView), context (createContext), ref (focus, scroll, measure), onResize, dark theme (setTheme), animations (createTween, createPresence, animate, easing, mixColor), equal-width columns, absolute positioning and stacking, clip with rounded corners, shadows, events (double/right click, key names), reusable components (MaybeAccessor, read, batch), overlays (modal dialog, dropdown menu, hint/tooltip), opacity and translate, selectable text and clipboard (copy/paste). Use when creating or changing any screen, form, list, sidebar or layout of a nodebuilder app, when the user needs to copy text from the screen, or when an element does not show up, grow or scroll as expected.
---

# UI with nodebuilder

Everything comes from `@nodebuilderjs/core`. There is no DOM and no CSS: widgets are functions and
style is flat props. SolidJS-style reactivity: **only functions are reactive** (see AGENTS.md).

## Widgets

| Widget | What for | Main props |
|---|---|---|
| `Window` | root, one per app, with its own title bar | `title`, `width`, `height` (initial size), `appId`, `onClose` (return `false` to keep it open) |
| `Column` / `Row` / `Box` | flex container (column, row; `Box` is a column) | style + events |
| `Scroll` | scrolling: vertical (default), `horizontal` or `horizontal vertical` (both) | needs `grow={1}` or a size; see "Scrolling" below |
| `Text` | text; wraps at spaces to fit the width | children (`{count}`, `"a"`) or `text={() => ...}`, `wrap` (default `true`), `maxLines` (truncates with "…"), `textAlign`, `lineHeight`, `selectable` |
| `Image` | PNG, JPEG, WebP, AVIF | see the `nodebuilder-images` skill |
| `Icon` | SVG icon (Lucide, Phosphor), color inherited like text | `svg`, `size` (20), `color`, `strokeWidth`; skill `nodebuilder-icons` |
| `Canvas` | free drawing: lines, polygons, arcs, text | `draw={(g) => ...}` + size; skill `nodebuilder-drawing` |
| `Button` | button with focus and keyboard | `label` or children, `variant` (`default`, `primary`, `danger`, `flat`), `disabled`, `onClick` |
| `TextField` | controlled text field | `value` (accessor), `onInput(value)`, `onSubmit`, `placeholder`, `disabled` |
| `Checkbox` | checkbox | `checked` (accessor), `onChange(checked)`, `label`, `disabled` |
| `Toggle` | on/off switch (`Switch` is the control-flow component) | `checked` (accessor), `onChange(on)`, `label`, `disabled` |
| `RadioGroup` | one option among several; a single Tab stop, arrows switch | `value` (accessor), `onChange(v)`, `options=[{ value, label, disabled? }]`, `disabled` |
| `Slider` | number by dragging or with arrows/PageUp/Home/End | `value` (accessor), `onChange(n)`, `min` (0), `max` (100), `step` (1), `width` (200), `disabled` |
| `Select` | dropdown list anchored to the field; full keyboard support | `value` (accessor, may be `undefined`), `onChange(v)`, `options=[{ value, label, disabled? }]`, `placeholder`, `width`, `disabled` |
| `Tabs` | tab bar (the content is yours, with `<Switch>`) | `value` (accessor), `onChange(v)`, `tabs=[{ value, label, disabled? }]` |
| `Tooltip` | hint when the pointer rests over the child | `text`, `placement` (`"top"`), `delay` (500 ms), child |
| `Dialog` | ready-made modal dialog: title, body, actions | `open` (accessor), `onClose`, `title`, `actions`, `width` (420), `dismissible` (true) |
| `ProgressBar` | progress bar, 6 px | `value` from 0 to 1 (without it: indeterminate) |
| `Spinner` | busy, no measure of progress | `size` (20), `color` |
| `Card` | column with background, border, radius 12, padding 16, gap 8 | style |
| `Divider` / `Spacer` | 1 px line / flexible space (optional fixed `size`) | |
| `<For each={list}>{(item, i) => ...}</For>` | list keyed by reference; `i` is an accessor | `fallback` |
| `<Index each={list}>{(item, i) => ...}</Index>` | list by position (primitives); `item` is an accessor, `i` a number | `fallback` |
| `<Show when={() => ...} fallback={...}>` | conditional; a `{(v) => ...}` child gets the value as an accessor | |
| `<Switch fallback={...}><Match when={...}>...</Match></Switch>` | several cases: the first true `Match` | `Match` accepts `{(v) => ...}` |
| `<ErrorBoundary fallback={(error, reset) => ...}>` | replaces children that threw with the `fallback` | `reset()` tries again |

```tsx
const [name, setName] = createSignal("");
<TextField value={name} onInput={setName} onSubmit={save} placeholder="Name" />
<Checkbox checked={active} onChange={setActive} label="Active" />
<Button label="Save" variant="primary" disabled={() => !name()} onClick={save} />
<Toggle checked={wifi} onChange={setWifi} label="Wi-Fi" />
<Slider value={volume} onChange={setVolume} max={100} step={5} />
```

`disabled` (value or function) on any control: dims it, removes it from Tab order and focus, and
ignores clicks and keys. Do not fake it with `opacity` + an empty `onClick`.

## Style props (any widget)

- Layout: `direction` (`"row"`/`"column"`), `gap`, `padding` (`8`, `[v, h]` or
  `[top, right, bottom, left]`), `width`, `height`, `minWidth`, `minHeight`, `maxWidth`,
  `maxHeight`, `grow`, `align`, `justify`, `position: "absolute"` + `left`/`top`, `clip`.
- Visual: `background`, `radius`, `borderWidth`, `borderColor`, `shadow={{ color, blur, y }}`,
  `opacity` (0 to 1, applies to children), `translateX`/`translateY` (shifts after
  layout, without pushing siblings; for animation).
- `clip` cuts the children to the inside of the border, **rounded** (radius `radius - borderWidth`):
  `<Card clip padding={0}>` + an `Image` or a colored header gets the card's rounded corners.
- `shadow` is the node's rounded box, blurred `blur` px on each side of its edge and moved down
  by `y` (no x offset, no spread). It is drawn even without `background`: then the whole blurred
  shape shows (a soft glow), and a translucent background lets it show through.
- Text (inherited by children): `color`, `fontSize`, `bold`. Cursor: `cursor="pointer"`.
- Colors are hex strings (`"#3584e4"`, `"#00000010"` with alpha) or `"transparent"`.
- Events on any container: `onClick`, `onPointerDown/Up/Enter/Leave`,
  `onPointerMove`, `onScroll`, `onKeyDown`, `onFocus`, `onBlur`. Pointer events carry
  `x`/`y` (window), `localX`/`localY` (relative to the node), `button` (0 left, 1 middle,
  2 right) and `clicks` (2 = double click); while the button is held,
  `onPointerMove` keeps reaching the node where the press started, even outside it (dragging,
  sliders). `onKeyDown` only arrives along the path of the focused element; it gets `key`
  (xkb names: `"Return"`, `"Escape"`, `"Tab"`, `"BackSpace"`, `"space"`, `"Up"`, `"Left"`, `"a"`),
  `text`, `ctrl`, `shift`, `alt`, `repeat`. `onScroll` gets `dx`/`dy`. `onClick` is the left button only
  (context menu: `onPointerDown` with `e.button === 2`) and runs only on the innermost node that
  has one; the other events go up through the parents until a handler calls `e.stop()` (on keys
  and the wheel, that also keeps the surrounding `Scroll` still).
- Any prop accepts a fixed value or a function: `background={() => (sel() ? a : b)}`.
- `onResize={(s) => ...}`: the node's size (`s.width`, `s.height`) after layout, the first
  time and whenever it changes. Use it to adapt the screen to the available width.
- `ref={(el) => ...}` on any widget: `el.focus()`, `el.blur()`, `el.scrollIntoView()`,
  on a `Scroll` `el.scrollTo(y)` / `el.scrollTo({ x, y })` and `el.scrollX`/`el.scrollY`, and
  `el.x`/`y`/`width`/`height` from the last layout. It is called on creation, before layout:
  keep the `el` and read the box later (in a click, for example).
- `ariaLabel="Play"` on any widget names an element without text (an icon-only button);
  tests find it with `findByLabel`. A `Tooltip` gives its tip to a trigger that has none.

## Hover and press

Do not write `onPointerEnter`/`onPointerLeave` + a signal for hover effects. Use
`hoverStyle`/`pressStyle` (any widget, any style prop, values fixed or functions), and
`createInteraction()` when something else depends on the state (a child shown while its
parent is hovered):

```tsx
import { Box, Button, Column, Show, Text, createInteraction } from "@nodebuilderjs/core";

function SongCard(props: { title: string; onPlay: () => void }) {
  const card = createInteraction();
  return (
    <Box {...card.props} direction="row" align="center" gap={12} padding={12} radius={8}
      background="#181818" hoverStyle={{ background: "#282828" }} pressStyle={{ opacity: 0.85 }}>
      <Column grow={1}>
        <Text color="#ffffff">{props.title}</Text>
      </Column>
      <Show when={card.hovered}>
        <Button label="Play" variant="primary" onClick={props.onPlay} />
      </Show>
    </Box>
  );
}
```

- `pressStyle` wins over `hoverStyle`; on leave the base values come back (a base given as a
  function keeps updating underneath). They win over a widget's own hover colors (`Button`);
  a `disabled` control ignores them.
- `createInteraction()` returns `hovered`, `pressed`, `focused` (accessors) and `props`.
  `{...card.props}` adds to the widget's handlers and to your own `onPointerEnter`... written
  before or after it (nothing is overwritten); the card stays hovered while the pointer is
  over its children. `focused` only changes on focusable widgets (`Button`, `TextField`).
- `hoverStyle` alone does not take the press; `pressStyle` and `card.props` do, so inside a
  window's drag region (title bar) such a widget no longer drags the window.

## Conditions, lists and errors

```tsx
import { Button, ErrorBoundary, Index, Match, Show, Switch, Text, createSignal } from "@nodebuilderjs/core";

const [order, setOrder] = createSignal<{ id: number } | null>(null);
const [step, setStep] = createSignal<"cart" | "payment" | "done">("cart");
const [grades] = createSignal([7, 9, 10]);

<Show when={order} fallback={<Text>No order</Text>}>
  {(o) => <Text>{() => `Order ${o().id}`}</Text>}
</Show>;

<Switch fallback={<Text>Thank you!</Text>}>
  <Match when={() => step() === "cart"}><Text>Your cart</Text></Match>
  <Match when={() => step() === "payment"}><Text>Payment</Text></Match>
</Switch>;

<Index each={grades}>{(grade, i) => <Text>{() => `Test ${i + 1}: ${grade()}`}</Text>}</Index>;

<ErrorBoundary fallback={(error, reset) => <Button label="Try again" onClick={reset} />}>
  <Text>{() => `Order ${order()!.id}`}</Text>
</ErrorBoundary>;
```

- `<For>` vs `<Index>`: `For` tracks each **object** (the row survives reordering; recreating
  the objects recreates the rows). `Index` tracks each **position**: the row stays and the
  `item()` accessor changes; good for lists of numbers/strings or data that always arrives as new
  objects.
- A function child of `Show`/`Match` gets the value only when it takes a parameter: `{(o) => ...}`
  gets the value as an accessor; `{() => ...}` (no parameter) is a plain reactive child.
- `Switch` only accepts `Match` children, written in JSX (not generated by a function).
- `ErrorBoundary` catches errors while creating the children and later in their effects (e.g. a click
  changes a signal and a text throws). It disposes everything the children created and shows the
  `fallback`; `reset()` recreates the children. What the `onClick` itself throws is not caught:
  handle it with `try/catch` in the handler.

## Context, ref and size

```tsx
import { Column, Scroll, TextField, Text, createContext, createSignal, useContext } from "@nodebuilderjs/core";
import type { Accessor, ElementRef } from "@nodebuilderjs/core";

// Value shared through the tree (theme, language, logged-in user), without passing props.
const User = createContext<Accessor<string>>(() => "anonymous");
function Greeting() {
  const user = useContext(User);
  return <Text>{() => `Hello, ${user()}`}</Text>;
}
const [user, setUser] = createSignal("Ana");
<User.Provider value={user}><Greeting /></User.Provider>;

// Focus a field on open and scroll a list to the end.
const [search, setSearch] = createSignal("");
let list: ElementRef | undefined;
<Column grow={1}>
  <TextField ref={(el) => el.focus()} value={search} onInput={setSearch} />
  <Scroll ref={(el) => (list = el)} grow={1}>{/* ... */}</Scroll>
</Column>;
const scrollToEnd = () => list?.scrollTo(Infinity);
```

- The context value is read once, when the component runs. For a value that changes, pass
  an accessor (signal) and call it inside a reactive function, as above.
- `useContext` only works in the component body (not inside an `onClick` or `setTimeout`):
  read it there and keep it in a variable.

## Your own components

```tsx
import { Column, Row, Text, batch, createSignal, read } from "@nodebuilderjs/core";
import type { Child, MaybeAccessor } from "@nodebuilderjs/core";

// A prop that may be fixed or reactive: MaybeAccessor + read() inside a function.
function Stat(props: { label: string; value: MaybeAccessor<number>; children?: Child }) {
  return (
    <Row gap={8} align="center">
      <Text>{props.label}</Text>
      <Text bold>{() => read(props.value).toLocaleString()}</Text>
      {props.children}
    </Row>
  );
}

const [plays, setPlays] = createSignal(0);
const [likes, setLikes] = createSignal(0);
<Column>
  <Stat label="Plays" value={plays} />
  <Stat label="Year" value={2024} />
</Column>;
batch(() => { setPlays(1200); setLikes(80); }); // several writes, effects run once at the end
```

- `untrack(() => ...)` reads signals without subscribing; `createMemo(() => ...)` caches a
  derived value; `StyleProps` (type) is every style prop, to accept and pass them on.

## Scrolling

```tsx
import { Button, Card, For, Row, Scroll, Text } from "@nodebuilderjs/core";
import type { ElementRef } from "@nodebuilderjs/core";

const items = Array.from({ length: 200 }, (_, i) => `Item ${i}`);
const rows: ElementRef[] = [];
<>
  {/* Strip that scrolls sideways: children keep their width. */}
  <Scroll horizontal gap={12} padding={[0, 0, 14, 0]}>
    <For each={items}>{(t) => <Card width={160}><Text>{t}</Text></Card>}</For>
  </Scroll>
  <Button label="Go to 150" onClick={() => rows[150]?.scrollIntoView()} />
  <Scroll grow={1}>
    <For each={items}>{(t, i) => <Row ref={(el) => (rows[i()] = el)} padding={8}><Text>{t}</Text></Row>}</For>
  </Scroll>
  {/* Wide and long table: scrolls on both axes. */}
  <Scroll horizontal vertical height={300}>{/* rows with fixed widths */}</Scroll>
</>;
```

- `<Scroll>` scrolls vertically. `horizontal`: a row whose children keep their width (text
  inside does not wrap, unless given `width`/`maxWidth`). `horizontal vertical`: a column
  that scrolls on both axes; each child is at least the visible width and grows if the
  content asks for it.
- The user scrolls with the wheel (Shift+wheel goes sideways; touchpad on both axes), by dragging
  the scrollbar thumb, by clicking the track (one page) and with the keyboard: PageUp/PageDown,
  Home/End and the arrows scroll the `Scroll` around the focused element (with no focus, the one under
  the mouse), unless an `onKeyDown` calls `e.stop()`. `TextField` keeps Home/End and ←/→;
  ↑/↓ scroll.
- Scrollbars sit **on top of** the content, in a 14 px strip along the right edge (and the
  bottom one), and only exist when there is something to scroll: leave `padding` on that edge if
  buttons touch it (like the `padding={[0, 0, 14, 0]}` above).
- `el.scrollIntoView()` (on any element, via `ref`) scrolls the surrounding `Scroll`s the minimum
  needed for it to show; it takes effect on the next frame, even for a just-created or off-screen
  element. `el.scrollTo({ x, y })` accepts just one of the axes.
- An open `<Overlay modal>` blocks the wheel, keys and scrollbars of what is behind it.

## Dialogs, menus and hints: `<Overlay>`

For the common cases use the ready-made widgets (`Dialog`, `Select`, `Tooltip`), which already handle
focus, keyboard and closing. `<Overlay>` is for what they do not cover (options menu, toast,
custom popover):

No `zIndex` and no `position: fixed`: whatever must stay on top of everything (outside the
clipping of a `Scroll` or `Card`) goes in an `<Overlay>`, almost always inside a `<Show>`.

```tsx
import { Button, Card, Overlay, Row, Show, Text, createSignal, theme } from "@nodebuilderjs/core";
import type { ElementRef } from "@nodebuilderjs/core";

const [menu, setMenu] = createSignal(false);
const [confirm, setConfirm] = createSignal(false);
let button: ElementRef | undefined;
<>
  <Button ref={(el) => (button = el)} label="Options" onClick={() => setMenu((m) => !m)} />
  <Show when={menu}>
    <Overlay anchor={() => button} matchWidth onDismiss={() => setMenu(false)}>
      <Card padding={4} shadow={{ color: "#00000030", blur: 16, y: 4 }}>
        <Button label="Delete" variant="flat" onClick={() => (setMenu(false), setConfirm(true))} />
      </Card>
    </Overlay>
  </Show>
  <Show when={confirm}>
    <Overlay modal background="#00000059" align="center" justify="center" onDismiss={() => setConfirm(false)}>
      <Card width={320} gap={12}>
        <Text bold>Delete file?</Text>
        <Row gap={8} justify="end">
          <Button label="Cancel" variant="flat" onClick={() => setConfirm(false)} />
          <Button label="Delete" variant="danger" onClick={() => setConfirm(false)} />
        </Row>
      </Card>
    </Overlay>
  </Show>
</>;
```

- `anchor={() => el}` (always as a function): sits next to the element, `placement`
  `"bottom"` (default), `"top"`, `"right"` or `"left"`, flips side if it does not fit, never leaves the
  window; `offset` (4) and `matchWidth` (same width, for menus).
- Without `anchor`: covers the window; position it with `align`/`justify`/`padding` or with
  `position="absolute"` + `left`/`top`. Empty space lets clicks through (toasts, hints).
- `modal`: blocks clicks and Tab on what is behind; `background` dims the backdrop.
- `onDismiss`: click outside (when modal, on the dimmed backdrop; never on the anchor) or Esc. Close the
  `<Show>` there.
- Declare the `<Overlay>` **outside** a `Button` (next to it, as above): events inside
  the overlay bubble up through the parents of the place where it was declared.
- Transition: animate `opacity` and `translateY` with a signal updated in
  `requestAnimationFrame` (see `examples/overlays.tsx` in the nodebuilder repository).

## Layout rules (simplified flexbox)

- Default `align` is **stretch**: children take the full width of a column. Use
  `align="start"`/`"center"` to shrink them to their content.
- `justify`: `start`, `center`, `end`, `space-between`. There is no `space-around`/`evenly`.
- `grow={1}` splits the leftover space. Without `grow`, the size is the content's.
- A child **does not shrink below its own content** (like CSS `min-size: auto`), except
  `Scroll`, `clip` or an explicit `minWidth/minHeight`. A long list inside a column
  that keeps growing? Wrap it in `<Scroll grow={1}>`.
- The content of a `Scroll` does not count toward that minimum: the column (or row) around it
  shrinks without needing `minHeight={0}`/`minWidth={0}`. A `Scroll horizontal` does not
  lose height (only what scrolls vertically gives up height).
- In a `Row` without room, whoever has `grow` shrinks first: the long text gets
  `grow={1}` (and `maxLines={1}` to become "…"), the short labels next to it stay whole.
- Text wraps by itself at the width it gets (`\n` also breaks); a word longer than the line
  overflows. A single line: `wrap={false}` (overflows) or `maxLines={1}` (truncates with "…").
- There are no percentages, `flex-wrap` or grid: build rows with `Row` and fixed widths (see
  tables: `Text width={110}`), `grow`, or proportional columns (below).
- **Equal (or proportional) columns:** `width={0} grow={1}` on each child, like CSS
  `flex: 1 1 0`. The fixed width is the base `grow` adds to, so the widths follow only the
  `grow` values (1:1:2...), not the content; text inside wraps to the column. Plain `grow={1}`
  only shares the *leftover* space, so wider content makes a wider column. Rows of equal height
  in a `Column` with a height: `height={0} grow={1}`. Content wider than its column overflows
  into the next one (`clip` cuts it), and the row's own natural width is just its gaps: give it
  room (stretched in a column, or `grow`).
- **`position="absolute"`** takes the child out of the flow: `left`/`top` count from the
  parent's content corner (inside its `padding`; negative values work); there is no
  `right`/`bottom`. It keeps its natural size (it does not stretch): give it `width`/`height`,
  or, to fill the parent, its size from `onResize` (below). It does not take space or change the
  parent's size. No `zIndex`: nodes are drawn and hit in child order, so declare it **after**
  the siblings it must cover. It is drawn outside its parent's box (unless the parent clips),
  but only clicked inside it.
- Inside a `Scroll`, an absolute child **stays put** relative to the visible area (it does not
  scroll with the content): good for a pinned badge. To scroll with the content, put it inside
  an in-flow child (the row it belongs to).

```tsx
import { Box, Column, Row, Text, createSignal } from "@nodebuilderjs/core";

// Three columns: 1 : 1 : 2, whatever their content.
<Row gap={12}>
  <Column width={0} grow={1}><Text>Now playing</Text></Column>
  <Column width={0} grow={1}><Text>Up next, a much longer title that wraps</Text></Column>
  <Column width={0} grow={2}><Text>Lyrics (twice as wide)</Text></Column>
</Row>;

// A layer over the whole cover and a badge on its corner (declared last: on top).
const [size, setSize] = createSignal({ width: 0, height: 0 });
<Box width={160} radius={12} clip background="#1f1f24" onResize={setSize}>
  <Column padding={16} gap={4}><Text color="#ffffff">Album</Text></Column>
  <Box position="absolute" left={0} top={0} width={() => size().width} height={() => size().height} background="#00000066" />
  <Text position="absolute" left={8} top={8} padding={[2, 6]} radius={8} background="#e01b24" color="#ffffff">NEW</Text>
</Box>;
```

Keep the `padding` on an inner child (as above) when an absolute layer must cover the padding
too. `onResize` reports after layout, so the layer takes the size one frame later.

## Theme and window

- Default colors and sizes in `theme` (`theme.text.secondary`, `theme.accent.base`,
  `theme.danger.base`, `theme.divider`...). Dark theme: `setTheme("dark")` (or `"light"`, or
  `{ ...darkTheme, accent: {...} }`), at any time; `colorScheme()` tells which one is active.
- **Theme colors always inside a function** (`color={() => theme.text.secondary}`): that way they
  follow theme changes. `color={theme.text.secondary}` keeps the color of that moment.
- `windowControls.close()`, `.minimize()`, `.toggleMaximize()`, `.setTitle(t)`;
  `windowState.width()`, `.height()`, `.maximized()`, `.activated()` are accessors.
- Animation: see the next section.
- Not available yet: theme following the system, `scale`/`rotate`, selection in `TextField`
  (and Ctrl+C in it), IME, multiple windows.

## Animation

```tsx
import { Box, animate, createInteraction, createSignal, createTween, easing, mixColor, theme } from "@nodebuilderjs/core";

const row = createInteraction();
// Moves smoothly toward its source; a new target starts from wherever it is now.
const t = createTween(() => (row.hovered() ? 1 : 0), { duration: 150, easing: easing.easeInOut });
<Box
  {...row.props} height={56} radius={8}
  background={() => mixColor(theme.card.background, "#1db954", t() * 0.2)}
  translateY={() => -2 * t()}
/>;

// One-off: calls back once per frame; returns a function that stops it.
const [x, setX] = createSignal(0);
const stop = animate(0, 300, setX, { duration: 400, easing: easing.linear, onDone: () => console.log("done") });
<Box width={40} height={40} translateX={x} />;
```

- `createTween(source, { duration, easing })`: an accessor that follows `source` (a function
  returning a number). `animate(from, to, onUpdate, { duration, easing, onDone })`.
  `duration` in ms (default 200), `easing` default `easing.easeOut`.
- `createPresence(when, { enter, exit, easing })` (ms, defaults 180/120): `mounted` stays true
  until the exit ends (use it in `<Show when={p.mounted}>`), `progress` goes 0→1→0 (for
  `opacity`, `translateY`).
- `easing.linear`, `.easeIn`, `.easeOut`, `.easeInOut`, or any `(t: number) => number`.
- `mixColor(a, b, t)`: `a` blended toward `b` (t 0..1), as `"#rrggbbaa"`; any hex form works.
  It mixes the alpha straight, so fading to `"transparent"` passes through gray: fade toward the
  same color with alpha 0 (`"#1db95400"`), or animate `opacity`.
- Animate numbers only (`opacity`, `translateX/Y`, `width`, colors via `mixColor`). For a
  custom loop, `requestAnimationFrame((time) => ...)` runs right before the next frame.
- `Dialog`, `Select`, `Tooltip` and `Toggle` already animate on their own. Without a window
  (tests) every animation jumps to its end; `frames()` (skill `nodebuilder-testing`) moves time.

## Selecting and copying text

Plain text **does not select**, on purpose (labels, buttons, titles). Text the user
may want to copy (ids, links, paths, error messages, results) gets `selectable`:

```tsx
<Text selectable>{order.id}</Text>
<Text selectable color={theme.danger.base}>{error}</Text>
```

With `selectable`: dragging selects, double-click takes the word, triple-click the line,
Ctrl+A everything and Ctrl+C copies; the cursor becomes the text cursor. It is not in the Tab order, and inside
the title bar it selects instead of dragging the window. Selection is one `Text` at a time
(it does not span several) and there is no Shift+click or Shift+arrows yet.

The system clipboard (text only) is in `clipboard`:

```tsx
import { Button, clipboard, createSignal } from "@nodebuilderjs/core";

const [link, setLink] = createSignal("https://example.com");
<Button label="Copy link" onClick={() => clipboard.writeText(link())} />;
<Button label="Paste" onClick={async () => setLink(await clipboard.readText())} />;
```

- `readText()` is asynchronous (another program holds the content) and returns `""` if there
  is no text.
- Copy from a click or key press (as above): on Wayland the system ignores copies that
  do not come right after a user interaction (a `setTimeout` will not do).
- `TextField` already pastes with Ctrl+V / Shift+Insert (line breaks become spaces), but
  does not select or copy yet.
