---
name: nodebuilder-ui
description: nodebuilder widgets, style props and layout (gradient backgrounds, per-corner radius, percentage sizes, responsive Grid minColumnWidth, password fields, window-wide keys (Window onKeyDown, focusable containers), onMount, Window, custom title bar with dragRegion and WindowControls, Column, Row, Scroll, Text, Button, TextField, TextArea (multi-line, selection, undo), RichText (styled spans, links), Checkbox, Toggle, RadioGroup, Slider, Select, Tabs, Tooltip, Dialog, ProgressBar, Spinner, Card, For, Index, Show, Switch/Match, ErrorBoundary, theme), scrolling (vertical, horizontal, scrollbars, keyboard, scrollIntoView), context (createContext), ref (focus, scroll, measure), onResize, dark theme (setTheme), animations (createTween, createPresence, animate, easing, mixColor), equal-width columns, absolute positioning and stacking (zIndex), clip with rounded corners, shadows, events (double/right click, key names), reusable components (MaybeAccessor, read, batch), overlays (modal dialog, dropdown menu, hint/tooltip), opacity and translate, selectable text and clipboard (copy/paste). Use when creating or changing any screen, form, list, sidebar or layout of a nodebuilder app, when the user needs to copy text from the screen, or when an element does not show up, grow or scroll as expected.
---

# UI with nodebuilder

Everything comes from `@nodebuilderjs/core`. There is no DOM and no CSS: widgets are functions and
style is flat props. SolidJS-style reactivity: **only functions are reactive** (see AGENTS.md).

## Widgets

| Widget | What for | Main props |
|---|---|---|
| `Window` | root, one per app, with its own title bar | `title`, `width`, `height` (initial size), `appId`, `icon` (SVG markup or an imported `.svg`/PNG file; default: the nodebuilder icon), `onClose` (return `false` to keep it open), `decorations={false}` (your own title bar, see "Theme and window") |
| `WindowControls` | minimize, maximize/restore and close buttons, for a custom title bar | style (`gap`...) |
| `Column` / `Row` / `Box` | flex container (column, row; `Box` is a column) | style + events |
| `Grid` | children in rows of equal-width cells (cards, covers, galleries) | `columns`, `gap`, `rowGap` (default `gap`); see "Layout rules" |
| `Scroll` | scrolling: vertical (default), `horizontal` or `horizontal vertical` (both) | needs `grow={1}` or a size; see "Scrolling" below |
| `RichText` | one paragraph of styled spans (markdown, links inside a sentence) | `spans` (array or accessor) of strings or `{ text, color, size, bold, weight, italic, family, letterSpacing, underline, background, onClick }`, `lineHeight`, `textAlign`; a span with `onClick` is a link (pointer cursor; other clicks go to the parent) |
| `Text` | text; wraps at spaces to fit the width | children (`{count}`, `"a"`) or `text={() => ...}`, `wrap` (default `true`), `maxLines` (truncates with "…"), `textAlign`, `lineHeight`, `underline`, `selectable`, `variant` (`muted`, `caption`, `title` or `defineTextVariants`) |
| `Image` | PNG, JPEG, WebP, AVIF | see the `nodebuilder-images` skill |
| `Icon` | SVG icon (Lucide, Phosphor), color inherited like text | `svg`, `size` (20), `color`, `strokeWidth`; skill `nodebuilder-icons` |
| `Canvas` | free drawing: lines, polygons, arcs, text | `draw={(g) => ...}` + size; skill `nodebuilder-drawing` |
| `Button` | button with focus and keyboard | `label` or children, `variant` (`default`, `primary`, `danger`, `flat`; a value or a function), `disabled`, `onClick` |
| `TextField` | controlled text field, one line | `value` (accessor), `onInput(value)`, `onSubmit` (Return), `placeholder`, `disabled`, `password` (draws `•`; a function for "show password"), `selection` (accessor of `{ anchor, focus }`: moves the caret), `onSelectionChange`, `borderColor`/`borderWidth` (kept when focused), `focusBorderColor`/`focusBorderWidth` |
| `TextArea` | controlled multi-line text (notes, editors) | the `TextField` props (no `password`) plus `rows` (minimum lines, 3); grows with its content (in a `Scroll`, the caret stays in view) or scrolls itself with a `height`; Return inserts a line, Ctrl+Return is `onSubmit` |
| `Checkbox` | checkbox | `checked` (accessor), `onChange(checked)`, `label`, `disabled` |
| `Toggle` | on/off switch (`Switch` is the control-flow component) | `checked` (accessor), `onChange(on)`, `label`, `disabled` |
| `RadioGroup` | one option among several; a single Tab stop, arrows switch | `value` (accessor), `onChange(v)`, `options=[{ value, label, disabled? }]`, `disabled` |
| `Slider` | number by dragging or with arrows/PageUp/Home/End | `value` (accessor), `onChange(n)`, `min` (0), `max` (100), `step` (1), `width` (200), `disabled`; `color` (the fill), `background` (the track) |
| `Select` | dropdown list anchored to the field; full keyboard support | `value` (accessor, may be `undefined`), `onChange(v)`, `options=[{ value, label, disabled? }]`, `placeholder`, `width`, `disabled` |
| `Tabs` | tab bar (the content is yours, with `<Switch>`) | `value` (accessor), `onChange(v)`, `tabs=[{ value, label, disabled? }]` |
| `Tooltip` | hint when the pointer rests over the child | `text`, `placement` (`"top"`), `delay` (500 ms), child |
| `Dialog` | ready-made modal dialog: title, body, actions | `open` (accessor), `onClose`, `title`, `actions`, `width` (420), `dismissible` (true), `inset` (leave the title bar uncovered) |
| `ProgressBar` | progress bar, 6 px | `value` from 0 to 1 (without it: indeterminate); `color` (the fill), `background` (the track) |
| `Spinner` | busy, no measure of progress | `size` (20), `color` |
| `Card` | column with background, border, radius 12, padding 16, gap 8 | style |
| `Divider` / `Spacer` | 1 px line / flexible space (optional fixed `size`) | |
| `<For each={list}>{(item, i) => ...}</For>` | list keyed by reference; `i` is an accessor | `fallback` |
| `<Index each={list}>{(item, i) => ...}</Index>` | list by position (primitives); `item` is an accessor, `i` a number | `fallback` |
| `<Show when={() => ...} fallback={...}>` | conditional; a `{(v) => ...}` child gets the value as an accessor. **No compiler:** `{f(x)}` inside runs even when `when` is false; write `{() => f(x)}` or use the `{(v) => ...}` child (components inside do wait) | |
| `<Switch fallback={...}><Match when={...}>...</Match></Switch>` | several cases: the first true `Match`; the content is recreated only when a different `Match` wins, not when the value of `when` changes (read it with `{(v) => ...}`) | `Match` accepts `{(v) => ...}` |
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

Every widget takes the event props (`onPointerEnter`, `onKeyDown`, `onFocus`...) next to its
own: they are added to the widget's handlers, never replace them (a `Button` keeps its hover
color). On a control, an `onKeyDown` runs first and `e.stop()` keeps the key from the control.

## Style props (any widget)

- Layout: `direction` (`"row"`/`"column"`), `gap`, `padding` (`8`, `[v, h]` or
  `[top, right, bottom, left]`), `margin` (same forms, negative allowed), `width`, `height`, `minWidth`, `minHeight`, `maxWidth`,
  `maxHeight` (px, or a percentage of the parent's content box: `width="50%"`; a percentage
  height needs a parent of known height), `grow`, `aspectRatio` (width / height), `align`, `alignSelf`, `justify`,
  `wrap` (on a `Row`/`Column`: lines; on a `Text`: word wrapping), `rowGap`,
  `position: "absolute"` + `left`/`top`/`right`/`bottom`, `zIndex`, `clip`.
- Visual: `background`, `radius` (one number, or per corner `[topLeft, topRight, bottomRight,
  bottomLeft]`: `radius={[0, 12, 12, 0]}`; `clip` and `shadow` follow it), `borderWidth`, `borderColor`, `shadow={{ color, blur, y }}` (around the box, never under it, as in CSS),
  `opacity` (0 to 1, applies to children), `translateX`/`translateY` (shifts after
  layout, without pushing siblings; for animation).
- **Gradient background** (CSS `linear-gradient`): `background={{ linear: ["#1db954", "#121212"], angle: 180 }}`.
  `angle` in degrees (0 = to top, 90 = to right, default 180 = to bottom); stops are colors or
  `[color, offset]` (0..1, missing ones spread evenly). Works with `radius`, borders, `opacity`,
  `hoverStyle`, and reactively: `background={() => ({ linear: [theme.accent.base, "transparent"] })}`.
  Interpolated premultiplied (fading to `"transparent"` stays the same hue). Linear only (no
  radial/conic); `borderColor`, `color` and `shadow` take solid colors only.
- `clip` cuts the children to the inside of the border, **rounded** (radius `radius - borderWidth`):
  `<Card clip padding={0}>` + an `Image` or a colored header gets the card's rounded corners.
  Like CSS `overflow: hidden`, a clipping node may be **squeezed below its content** (it
  gives up its minimum size), and what it cuts off is neither seen nor clickable. In a column
  that is short of room, give it `minHeight` (or let it `grow`, or put the page in a
  `Scroll`); `run()` warns in development (`... overflows Card(login) by 36px`) and tests can
  assert `layoutWarnings()` is empty.
- Overlapping layouts (an avatar over a banner): a negative `margin` pulls the next sibling up
  without leaving a gap (`<Image ... margin={[-40, 0, 0, 16]} />` after the banner);
  `translateY` moves only the drawing and leaves the space behind.
- `shadow` is the node's rounded box, blurred `blur` px on each side of its edge and moved down
  by `y` (no x offset, no spread). It is drawn even without `background`: then the whole blurred
  shape shows (a soft glow), and a translucent background lets it show through.
- Text (inherited by children): `color`, `fontSize`, `bold`, `fontWeight` (1..1000 like CSS:
  300 light, 500 medium, 700 bold, 900 black; `bold` is 700 and `fontWeight` wins on the same
  widget), `italic`, `letterSpacing` (px after every character, may be negative: `letterSpacing={1.5}`
  on small uppercase labels), `underline` (a line under each line of text, in its color;
  `underline={false}` turns it off below; `TextField` ignores it). A family without the
  weight or slant asked for gets the closest one, emboldened or slanted.
  Symbols, CJK and emoji the UI font lacks come from the system's fallback fonts; emoji are in
  color (`color` does not tint them, `opacity` fades them). Cursor: `cursor="pointer"`. A link that underlines on hover:

  ```tsx
  import { Text, createSignal, theme } from "@nodebuilderjs/core";

  const [hovered, setHovered] = createSignal(false);
  <Text color={() => theme.accent.base} underline={hovered} cursor="pointer"
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onClick={() => console.log("open docs")}>Read the docs</Text>;
  ```
- Fonts (inherited): `fontFamily` is a CSS list (`"Inter, sans-serif"`) of fonts the app
  registered, installed families by name and generic ones (`sans-serif`, the default UI font;
  `serif`, `monospace`, `system-ui`, `emoji`...); each character uses the first family that has
  it. Ship font files with the app and `registerFont` them at startup, before `run()`, importing
  them `with { type: "file" }` so the package embeds them (TTF, OTF, TTC, WOFF, WOFF2, variable
  fonts; family, weight and slant come from the file). Register each weight and italic under
  the same family; the closest face is used, like CSS. `fontFeatures` turns OpenType features
  on/off (`"tnum"` tabular digits for numbers that update, `"smcp"`, `"-liga"`),
  `fontVariations` sets variable axes (`"wdth 75"`). `fontFamilies()` lists installed and
  registered families. Charts and `<Canvas>` text follow the `fontFamily` around them.

  ```tsx
  import { Column, Text, registerFont } from "@nodebuilderjs/core";
  import regular from "./fonts/Inter-Regular.woff2" with { type: "file" };
  import bold from "./fonts/Inter-Bold.woff2" with { type: "file" };

  registerFont(regular);
  registerFont(bold);

  <Column fontFamily="Inter, sans-serif">
    <Text bold>Inter Bold</Text>
    <Text fontFamily="monospace">code()</Text>
    <Text fontFeatures="tnum">1,234.50</Text>
  </Column>;
  ```
- Colors are CSS strings: hex (`"#3584e4"`, `"#00000010"` with alpha), `"transparent"`, or the
  wide-gamut `color(display-p3 1 0.3 0)`, `oklch(0.7 0.2 145)` (alpha: `oklch(0.7 0.2 145 / 50%)`),
  `oklab(...)`, `color(srgb ...)`. Hex is sRGB; on a Display P3 surface (Wayland with color
  management) P3/OKLCH colors show past sRGB, elsewhere they are clipped to sRGB.
  `outputColorSpace()` says which; `run(app, { colorSpace: "srgb" })` opts out. No `rgb()`/`hsl()`.
  Images keep their color profile (P3 photos stay P3; Adobe RGB and other ICC profiles are
  converted). `run(app, { deepColor: true })`: 16-bit window buffer, less banding, more GPU memory.
- Events on any container: `onClick`, `onPointerDown/Up/Enter/Leave`,
  `onPointerMove`, `onScroll`, `onKeyDown`, `onFocus`, `onBlur`. Pointer events carry
  `x`/`y` (window), `localX`/`localY` (relative to the node), `button` (0 left, 1 middle,
  2 right) and `clicks` (2 = double click); while the button is held,
  `onPointerMove` keeps reaching the node where the press started, even outside it (dragging,
  sliders). `onKeyDown` arrives along the path of the focused element, from it up to the
  `Window`; with nothing focused (a click on empty space blurs everything) keys go straight to
  the `Window`, so `<Window onKeyDown={(e) => e.key === "Escape" && close()}>` is a window-wide
  shortcut (Ctrl+K too: a text field lets keys with Ctrl through). A page or a menu that
  should hold the focus without being a control: `<Column focusable onKeyDown={...}>` (a click
  focuses it; no focus ring; `tabStop` adds it to the Tab order). A press focuses the nearest
  focusable ancestor of what was pressed (empty space: nothing). Key events (`onKeyDown`,
  `onKeyUp`) get `key` (xkb names, normalized: `"Return"`, `"Escape"`, `"Tab"` (Shift+Tab too,
  with `shift`), `"BackSpace"`, `"Delete"`, `"space"`, `"Up"`, `"Left"`, `"Home"`, `"End"`,
  `"Page_Up"`, `"Page_Down"`, `"F2"`, `"Menu"`, `"a"`; keypad keys have the plain names; with
  Ctrl or Alt a letter is always lowercase), `text` (what it types; `""` with Ctrl), `ctrl`,
  `shift`, `alt`, `meta`, `repeat`. Pointer and wheel events carry `ctrl`/`shift`/`alt`/`meta`
  too (Ctrl+click, Shift+click, Ctrl+wheel); `onScroll` gets `dx`/`dy`. `onClick` is the left
  button only and runs only on the innermost node that has one (a button inside a clickable
  card clicks only the button); `onContextMenu` (right press, Menu key, Shift+F10) also runs
  only on the innermost one; the other events go up through the parents until a handler
  calls `e.stop()`, also past nodes with `onClick` (on keys and the wheel, `stop()` also keeps
  the surrounding `Scroll` still). A context menu at the pointer: `onContextMenu={(e) =>
  setMenu({ x: e.x, y: e.y })}` and `<Overlay at={menu} onDismiss={...}>` (it flips to fit).
- Any prop accepts a fixed value or a function: `background={() => (sel() ? a : b)}`.
- `onResize={(s) => ...}`: the node's size (`s.width`, `s.height`) after layout, the first
  time and whenever it changes. Use it to adapt the screen to the available width; what it
  changes (children built from the width) is laid out in the same frame. (A grid of cards
  that reflows with the width is just `<Grid minColumnWidth={180}>`.)
- `ref={(el) => ...}` on any widget: `el.focus()`, `el.blur()`, `el.scrollIntoView()`,
  on a `Scroll` `el.scrollTo(y)` / `el.scrollTo({ x, y })` and `el.scrollX`/`el.scrollY`, and
  `el.x`/`y`/`width`/`height` from the last layout. It is called on creation, before layout:
  keep the `el` and read the box later (in a click, for example). `el.focus()` in the `ref`
  focuses the element as soon as it is in the tree.
- `onMount(() => ...)` in a component runs once its nodes are in the tree and its refs are
  set (an effect in the component body runs before the JSX below it exists, so its `ref` is
  still `undefined`). An effect created inside `onMount` sees the ref from its first run:

  ```tsx
  import { For, Scroll, Text, createEffect, createSignal, onMount, type ElementRef } from "@nodebuilderjs/core";

  function Messages() {
    const [messages] = createSignal(["hi", "hello"]);
    let list: ElementRef | undefined;
    onMount(() =>
      createEffect(() => {
        messages(); // runs again when a message arrives
        list!.scrollTo(1e9); // to the end
      }),
    );
    return (
      <Scroll grow={1} ref={(el) => (list = el)}>
        <For each={messages}>{(m) => <Text>{m}</Text>}</For>
      </Scroll>
    );
  }
  ```
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
- `focusStyle={{ borderColor: "#..." }}`: while the widget has the keyboard focus (a custom
  focus ring); hover and press win over it. A `Button` with its own `borderColor`/`borderWidth`
  keeps them when focused (its default ring is off), so restyle the ring with `focusStyle`.
- `createInteraction()` returns `hovered`, `pressed`, `focused` (accessors) and `props`.
  `{...card.props}` adds to the widget's handlers and to your own `onPointerEnter`... written
  before or after it (nothing is overwritten); the card stays hovered while the pointer is
  over its children. `focused` only changes on focusable widgets (`Button`, `TextField`).
- `hoverStyle` alone does not take the press; `pressStyle` and `card.props` do, so inside a
  window's drag region (title bar) such a widget no longer drags the window.
- Like CSS `:active`, a parent's `pressStyle` (and `pressed()`) also turns on while a child
  inside it (a button in the card) is pressed; `onPointerDown={(e) => e.stop()}` on the child
  (or on a `Box` around a `Button`) keeps the press to the child.

## Conditions, lists and errors

**Not like Solid: there is no compiler.** Children of `<Show>` and `<Match>` are ordinary JS
arguments, evaluated where the JSX is written, before `Show` decides anything. Only components
and functions wait until the branch is shown:

<!-- no-check -->
```tsx
<Show when={() => task.due}>
  <Text>{shortDate(task.due!)}</Text>            {/* WRONG: runs now, with due undefined */}
  <Text>{() => shortDate(task.due!)}</Text>      {/* ok: a function, read when shown */}
</Show>
<Show when={() => task.due}>{(due) => <Text>{shortDate(due())}</Text>}</Show> {/* ok: the value, narrowed */}
<Show when={() => task.due}><DueDate task={task} /></Show>                     {/* ok: a component body waits */}
```

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
  the mouse), unless an `onKeyDown` calls `e.stop()`. `TextField`/`TextArea` keep their caret keys;
  ↑/↓ scroll.
- Scrollbars sit **on top of** the content, in a 14 px strip along the right edge (and the
  bottom one), and only exist when there is something to scroll: leave `padding` on that edge if
  buttons touch it (like the `padding={[0, 0, 14, 0]}` above).
- `el.scrollIntoView()` (on any element, via `ref`) scrolls the surrounding `Scroll`s the minimum
  needed for it to show; it takes effect on the next frame, even for a just-created or off-screen
  element. `el.scrollIntoView({ x, y, width, height })` shows only that region of it, from its
  top-left corner (a caret in an editor drawn on a `Canvas`). `el.scrollTo({ x, y })` accepts just
  one of the axes.
- An open `<Overlay modal>` blocks the wheel, keys and scrollbars of what is behind it.

## Dialogs, menus and hints: `<Overlay>`

For the common cases use the ready-made widgets (`Dialog`, `Select`, `Tooltip`), which already handle
focus, keyboard and closing. `<Overlay>` is for what they do not cover (options menu, toast,
custom popover):

No `position: fixed`, and `zIndex` only orders siblings: whatever must stay on top of everything
(outside the clipping of a `Scroll` or `Card`) goes in an `<Overlay>`, almost always inside a `<Show>`.

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
- `at={{ x, y }}` (or an accessor) instead of `anchor`: opens at a point in window coordinates
  (context menu at `e.x`/`e.y` of `onContextMenu`), to its left or above when it does not fit.
- Without `anchor`: covers the window; position it with `align`/`justify`/`padding` or with
  `position="absolute"` + `left`/`top`. Empty space lets clicks through (toasts, hints).
- `modal`: blocks clicks and Tab on what is behind; `background` dims the backdrop. With
  nothing focused, keys start at the modal (then the `Window`).
- `inset` (like `padding`, from the window's edges) leaves a strip uncovered: a modal with
  `inset={[theme.window.titlebarHeight + 1, 0, 0, 0]}` keeps the title bar usable (move,
  minimize, close), and pressing there does not dismiss it. `Dialog` takes `inset` too.
- `onDismiss`: click outside (when modal, on the dimmed backdrop; never on the anchor) or Esc. Close the
  `<Show>` there.
- Declare the `<Overlay>` **outside** a `Button` (next to it, as above): events inside
  the overlay bubble up through the parents of the place where it was declared.
- Transition: animate `opacity` and `translateY` with a signal updated in
  `requestAnimationFrame` (see `examples/showcase/overlays.tsx` in the nodebuilder repository).

## Layout rules (simplified flexbox)

- Default `align` is **stretch**: children take the full width of a column. Use
  `align="start"`/`"center"` to shrink them to their content. `alignSelf` on one child
  overrides its parent's `align` (e.g. one centered button in a stretched form).
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
- **Something does not show up?** In development the app prints an overflow warning once per
  node when children need more room than they get and a `clip` ancestor or the window cuts
  them off: `layout: Row > Text("Artists") overflows Box(panel) by 42px (children need 342px,
  300px available)`; `debugTree(root)` marks the container `[overflow +42]` and tests read the
  list with `layoutWarnings()` (see the testing skill). Fix: a `Scroll horizontal`, wrapping
  text, `grow` with `width={0}`, `minWidth={0}` plus `clip` on what may be cut, or more room.
- Text wraps by itself at the width it gets (`\n` also breaks); a word longer than the line
  overflows. A single line: `wrap={false}` (overflows) or `maxLines={1}` (truncates with "…").
- Percentages (`width="50%"`, `maxWidth="30%"`, `height="100%"`) are of the parent's content
  box (inside its padding), like CSS; a percentage height needs a parent whose height is set
  (or stretched). Usually `grow`, proportional columns (below), `wrap` or a `Grid` say it
  better: percentages plus a `gap` add up to more than 100%.
- **`<Row wrap gap={6}>`** (CSS `flex-wrap: wrap`) for chips and tags: children that do not fit
  start a new line, `rowGap` (default `gap`) between lines. Each line is its own row (`grow`,
  `justify`, `alignSelf` apply inside it) and is as tall as its tallest child. The Row wraps at
  whatever width it gets (stretched in a column, `grow`, a fixed `width`) and its height follows;
  it can shrink down to its widest child. `<Column wrap height={...}>` breaks into columns at
  its height.
- **`margin`** is space outside the border that the parent keeps free: it counts in every size
  around the child (natural size, `grow`, `Grid` cells, `wrap` lines) and a stretched child
  gets the room minus its margins. Prefer `gap`/`padding` on the parent for regular spacing;
  use `margin` for one child (extra space above a section title) or negative values (a divider
  that cancels the card's padding: `margin={[8, -16]}`). Not painted, not clickable, never
  collapses, adds to `gap`. On an absolute child it adds to `left`/`top`/`right`/`bottom`.
- **`<Grid columns={3} gap={8}>`** (CSS `repeat(3, 1fr)`): children flow into rows of equal
  cells, whatever their content; the last row keeps its empty cells. A row is as tall as its
  tallest cell and cells stretch to it (`align`/`alignSelf` change that). `rowGap` sets the
  space between rows (default `gap`). Use it with `<For>` too: adding an item reflows.
- **`<Grid minColumnWidth={180} gap={12}>`** (CSS `repeat(auto-fill, minmax(180px, 1fr))`): as
  many columns as fit at least 180 px wide, sharing the leftover, so the grid reflows as the
  window resizes (no `onResize` needed). With `columns` too, that is the most per row.
- **`aspectRatio={16 / 9}`** (width / height), like CSS `aspect-ratio`: in a column or a `Grid`
  cell the height follows the width; with a fixed `height` (or stretched in a `Row` with a
  height) the width follows the height. `min/max` still clamp, and children taller than the
  ratio make the box taller. In a `Grid`, `aspectRatio={1}` gives square cells (covers,
  thumbnails) that do not stretch to a taller neighbor.
- **Equal (or proportional) columns in one row:** `width={0} grow={1}` on each child, like CSS
  `flex: 1 1 0`. The fixed width is the base `grow` adds to, so the widths follow only the
  `grow` values (1:1:2...), not the content; text inside wraps to the column. Plain `grow={1}`
  only shares the *leftover* space, so wider content makes a wider column. Rows of equal height
  in a `Column` with a height: `height={0} grow={1}`. Content wider than its column overflows
  into the next one (`clip` cuts it), and the row's own natural width is just its gaps: give it
  room (stretched in a column, or `grow`).
- **`position="absolute"`** takes the child out of the flow: `left`/`top`/`right`/`bottom`
  count from the parent's padding box, as in CSS: inside its border, **ignoring its `padding`**
  (`left={0}` is the parent's left edge; negative values work). Percentages too.
  It keeps its natural size, unless both `left` and `right` (or `top` and `bottom`) are set and
  no `width` (`height`): then it stretches between them, within `min`/`max`. `right` (or
  `bottom`) alone places it from that edge. It does not take space or change the parent's size.
  Siblings are drawn and hit in child order (a later one covers an earlier one) unless they
  have a **`zIndex`** (default 0; higher is above, ties keep child order). It only orders
  siblings: a raised node stays inside its parent's place in the order (no global stacking
  context; for that, an `<Overlay>`). What sticks out of the parent's box is drawn and clicked
  there too, unless the parent clips (`clip`, `Scroll`).
- Inside a `Scroll`, an absolute child **scrolls with the content** (like CSS). For something
  pinned to the visible area, put it next to the `Scroll` in a parent that does not scroll.

```tsx
import { Box, Column, For, Grid, Image, Row, Text, createSignal } from "@nodebuilderjs/core";

// Square album covers, four per row, following the window width.
const [albums] = createSignal([{ title: "Blue", cover: "blue.jpg" }]);
<Grid columns={4} gap={12} rowGap={16}>
  <For each={albums}>
    {(a) => (
      <Column gap={6}>
        <Image src={a.cover} aspectRatio={1} fit="cover" radius={8} />
        <Text maxLines={1}>{a.title}</Text>
      </Column>
    )}
  </For>
</Grid>;

// Three columns in one row: 1 : 1 : 2, whatever their content (the manual alternative).
<Row gap={12}>
  <Column width={0} grow={1}><Text>Now playing</Text></Column>
  <Column width={0} grow={1}><Text>Up next, a much longer title that wraps</Text></Column>
  <Column width={0} grow={2}><Text>Lyrics (twice as wide)</Text></Column>
</Row>;

// A layer over the whole cover and badges on its corners (declared last: on top).
<Box width={160} radius={12} clip background="#1f1f24">
  <Column padding={16} gap={4}><Text color="#ffffff">Album</Text></Column>
  <Box position="absolute" left={0} top={0} right={0} bottom={0} background="#00000066" />
  <Text position="absolute" left={8} top={8} padding={[2, 6]} radius={8} background="#e01b24" color="#ffffff">NEW</Text>
  <Text position="absolute" right={8} bottom={8} color="#ffffff">3:45</Text>
</Box>;

// A count badge sticking out of a card's corner (no `clip`, so it is drawn and clicked
// outside too); `zIndex` keeps it above the content even though it is declared first.
<Box width={160} padding={12} radius={10} background="#e8eaf2">
  <Text position="absolute" right={-10} top={-10} zIndex={1} padding={[2, 8]} radius={10} background="#e5484d" color="#ffffff">3</Text>
  <Box padding={8} radius={6} background="#3e63dd"><Text color="#ffffff">Inbox</Text></Box>
</Box>;
```

An absolute layer covers the parent's padding too (`left={0}` is the parent's edge): a colored
stripe at `left={0} top={0} bottom={0}` sits on the edge of a padded card.

## Theme and window

- Default colors and sizes in `theme` (`theme.text.secondary`, `theme.accent.base`,
  `theme.danger.base`, `theme.divider`...). Dark theme: `setTheme("dark")` (or `"light"`, or
  `{ ...darkTheme, accent: {...} }`), at any time; `colorScheme()` tells which one is active.
- **Theme colors by name** (preferred): `color="text.secondary"`, `background="accent.base"`,
  `borderColor="divider"`: any theme path, resolved when painting, so it follows `setTheme`
  with no accessor and no import. In code, read `theme` inside a function
  (`color={() => (on() ? theme.accent.base : theme.text.secondary)}`, or the names:
  `color={() => (on() ? "accent.base" : "text.secondary")}`); `color={theme.text.secondary}`
  keeps the color of that moment.
- `title` may be an accessor (`title={() => \`${note()} - Notes\`}`): the title bar and the
  window list follow it.
- Colors of the app's own (sidebar, links, code background) that follow `setTheme`: call
  `createThemeTokens({ light: { sidebar: "#f3f3f3" }, dark: { sidebar: "#202020" } })` once (e.g.
  in `theme.ts`, imported by `main.tsx`), then use them by name anywhere: `background="sidebar"`
  (nested: `"graph.node"`). The returned object reads them in code (`() => colors.sidebar`).
  An unknown name paints magenta and warns once.
- **Text variants** instead of repeating `fontSize` + `color`: `<Text variant="muted">`,
  `"caption"` (12 px, secondary), `"title"` (20 px, bold); the app's own with
  `defineTextVariants({ label: { fontSize: 12, bold: true, color: "accent.base" } })`. Props on
  the Text win. `color`/`fontSize` set on a container are inherited by the texts inside.
- `windowControls.close()`, `.minimize()`, `.toggleMaximize()`, `.setTitle(t)`, `.hide()`/`.show()`
  (off the screen and the taskbar, the app keeps running); `windowState.width()`, `.height()`,
  `.maximized()`, `.activated()`, `.visible()` are accessors.
- **System tray:** `createTray({ icon, tooltip, title, menu, onClick, onMiddleClick })`, every
  option may be an accessor; it lives while the calling scope does. Menu entries: `{ label,
  onClick, enabled, visible, checked, radio, children }` or `"separator"`. `tray.available()` is
  false without a tray host (GNOME without the AppIndicator extension), so closing to the tray
  must check it, and there must be another way to quit:

```tsx
import { Window, createTray, windowControls, windowState } from "@nodebuilderjs/core";

let quitting = false;
const tray = createTray({
  tooltip: "My app",
  onClick: () => (windowState.visible() ? windowControls.hide() : windowControls.show()),
  menu: [{ label: "Quit", onClick: () => ((quitting = true), windowControls.close()) }],
});
<Window title="My app" onClose={() => quitting || !tray.available() || (windowControls.hide(), false)} />;
```
- **Custom title bar** (navigation or search merged with the window buttons): `<Window
  decorations={false}>` drops the built-in bar (border, corners and edge resizing stay);
  `dragRegion` on any widget makes it move the window, and a double click maximizes. Plain
  text and empty space inside it drag; buttons, fields and anything clickable, focusable or
  with `onPointerDown` keep their press.

```tsx
import { Row, Spacer, Text, TextField, Window, WindowControls, createSignal, theme, windowState } from "@nodebuilderjs/core";

const [query, setQuery] = createSignal("");
<Window title="Player" decorations={false}>
  <Row dragRegion height={56} align="center" gap={12} padding={[0, 12]}>
    <Text bold color={() => (windowState.activated() ? theme.text.primary : theme.text.secondary)}>Player</Text>
    <TextField width={280} value={query} onInput={setQuery} placeholder="Search" />
    <Spacer />
    <WindowControls />
  </Row>
  {/* the rest of the screen */}
</Window>
```
- Animation: see the next section.
- Not available yet: theme following the system, `scale`/`rotate`, IME, multiple windows,
  selecting `RichText`.

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
- `mixColor(a, b, t)`: `a` blended toward `b` (t 0..1), as `"#rrggbbaa"` (`color(display-p3 ...)`
  past sRGB); any color form works.
  Premultiplied like CSS: `mixColor("#1db954", "transparent", 0.5)` is the same green at half alpha.
- Animate numbers only (`opacity`, `translateX/Y`, `width`, colors via `mixColor`). For a
  custom loop, `requestAnimationFrame((time) => ...)` runs right before the next frame.
- `Dialog`, `Select`, `Tooltip` and `Toggle` already animate on their own. Without a window
  (tests) every animation jumps to its end; `frames()` (skill `nodebuilder-testing`) moves time.

## Selecting and copying text

Plain text **does not select**, on purpose (labels, buttons, titles). Text the user
may want to copy (ids, links, paths, error messages, results) gets `selectable`:

```tsx
<Text selectable>{order.id}</Text>
<Text selectable color="danger.base">{error}</Text>
```

With `selectable`: dragging selects, double-click takes the word, triple-click the line,
Ctrl+A everything and Ctrl+C copies; the cursor becomes the text cursor. It is not in the Tab order, and inside
the title bar (or any `dragRegion`) it selects instead of dragging the window. Selection is one `Text` at a time
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
