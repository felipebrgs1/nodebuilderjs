---
name: nodebuilder-from-react
description: Translation of React, DOM, CSS and web library habits to nodebuilder, and which npm packages work. Use before installing any UI, icon, component, state or styling library (lucide-react, MUI, Tailwind, styled-components, react-*, solid-js...), when writing useState/useEffect/className/div/onChange, or when porting React/Solid/HTML code to this app.
---

# Coming from React (or the web)

nodebuilder draws the interface with the GPU, without a browser: **there is no DOM, CSS, React
or Solid**. The JSX looks the same as always, but the elements are the widgets from
`@nodebuilderjs/core`.

## Direct translation

| On the web / React | In nodebuilder |
|---|---|
| `useState(0)` | `const [n, setN] = createSignal(0)`; read with `n()` |
| `useMemo` | `createMemo(() => ...)` |
| `useEffect(() => ..., [deps])` | `createEffect(() => ...)` (automatic deps) + `onCleanup` |
| `useEffect(() => ..., [])` / `useLayoutEffect` that uses a `ref` | `onMount(() => ...)`: runs once the component's nodes are in the tree and its refs are set (an effect in the body runs before the JSX below it exists) |
| component re-render | does not exist: the component runs **once** |
| `{count}` in JSX | `{count}` (the function, not `count()`), otherwise it stays fixed |
| `style={{ padding: 8 }}`, `className` | props: `padding={8}`, `background="#fff"` |
| `div`, `span`, `p`, `h1` | `Column`, `Row`, `Box`, `Text fontSize={24} bold` |
| input `onChange` | `TextField value={v} onInput={setV}` |
| `<input type="password">` (+ "show password") | `<TextField password value={v} onInput={setV} />`; `password={hidden}` (an accessor) toggles it |
| `:focus` / `:focus-visible` ring, `outline` | `focusStyle={{ borderColor: "#..." }}` on any widget; `TextField` also takes `focusBorderColor`/`focusBorderWidth` |
| `<input type="range">`, `type="radio"`, MUI switch, `<progress>` | `Slider`, `RadioGroup`, `Toggle`, `ProgressBar`/`Spinner` |
| `<select>`, Dialog/Modal, Tabs, Tooltip (MUI, Radix, shadcn) | `Select`, `Dialog`, `Tabs` (+ `<Switch>` for the content), `Tooltip` |
| `disabled` on input/button | `disabled` on any control (value or function) |
| `list.map(...)` in JSX | `<For each={list}>{(item) => ...}</For>` |
| `list.map((x, i) => ...)` with `key={i}` (list of primitives) | `<Index each={list}>{(item, i) => ...}</Index>`; `item` is an accessor (`item()`), `i` is a number |
| `cond && <X/>` | `<Show when={() => cond()}><X/></Show>` |
| `cond ? <A/> : <B/>`, `switch` that returns JSX | `<Show when={...} fallback={<B/>}><A/></Show>`; several cases: `<Switch fallback={...}><Match when={() => s() === "a"}>...</Match></Switch>` |
| `user && <X name={user.name}/>` | `<Show when={user}>{(u) => <X name={u().name} />}</Show>` (same as in Solid). Not like Solid: there is no compiler, so `<Show when={user}><Text>{user()!.name}</Text></Show>` evaluates `user()!.name` right away, even when `user()` is null; use the `{(u) => ...}` child or `{() => user()!.name}` |
| error boundary (`componentDidCatch`, `react-error-boundary`) | `<ErrorBoundary fallback={(error, reset) => ...}>` (as in Solid); catches errors on creation and in effects, not in `onClick` code |
| `createContext` / `useContext` | the same: `createContext(default)`, `<Ctx.Provider value={...}>`, `useContext(Ctx)`; a value that changes goes as an accessor |
| `useRef` + `ref={r}` / `el.focus()` | `ref={(el) => ...}` on any widget: `el.focus()`, `el.blur()`, `el.scrollTo(y)`, `el.width` |
| `overflow-y: auto` / `overflow-x: auto` / `overflow: auto` | `<Scroll>` / `<Scroll horizontal>` / `<Scroll horizontal vertical>` (with `grow={1}` or a size) |
| `el.scrollIntoView()`, `el.scrollTo({ left, top })`, `scrollLeft`/`scrollTop` | `el.scrollIntoView()` (scrolls the minimum, on the next frame), `el.scrollTo({ x, y })`, `el.scrollX`/`el.scrollY` |
| `min-height: 0` / `min-width: 0` around what scrolls | unnecessary: the content of a `Scroll` does not hold up the size of its container |
| `ResizeObserver`, media queries | `onResize={(s) => setWidth(s.width)}` + signal (what it changes is laid out in the same frame) |
| `document.addEventListener("keydown", ...)` (Escape, Ctrl+K anywhere) | `<Window onKeyDown={(e) => ...}>`: gets every key nothing below took (`e.stop()`), also with nothing focused |
| `tabIndex={-1}` on a div that handles keys | `<Column focusable onKeyDown={...}>`: a click focuses it, no focus ring; `tabStop` puts it in the Tab order |
| CSS `width: 50%`, `max-width: 30%` | `width="50%"`, `maxWidth="30%"` (of the parent's content box; also `height`, `min*`) |
| CSS `border-radius: 0 12px 12px 0` | `radius={[0, 12, 12, 0]}` (top left, top right, bottom right, bottom left); `clip` and `shadow` follow it |
| `z-index` among siblings (badge over a card's content) | `zIndex={1}` (siblings only: no global stacking context; ties keep child order) |
| `createPortal`, `position: fixed`, `z-index` above everything, library modal/dropdown/tooltip | `<Overlay>` (`modal`, `anchor={() => el}`, `onDismiss`); skill `nodebuilder-ui` |
| CSS `display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; row-gap: 12px` | `<Grid columns={4} gap={8} rowGap={12}>` (equal columns only; no spans or named areas) |
| CSS `grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))` | `<Grid minColumnWidth={160} gap={8}>` (as many columns as fit; `columns` caps them) |
| CSS `margin: 8px 16px`, `margin-top`, negative margins | `margin={[8, 16]}`, `margin={[12, 0, 0, 0]}`, `margin={[0, -16]}` (no collapsing, no `auto`; adds to `gap`) |
| CSS `flex-wrap: wrap` (chips, tags), `row-gap` | `<Row wrap gap={6} rowGap={8}>` (lines start at the top: no `align-content`) |
| CSS `flex: 1 1 0` (equal or 1:1:2 columns in one row) | `width={0} grow={1}` (`grow={2}`...) on each child |
| CSS `aspect-ratio: 16 / 9`, square thumbnails | `aspectRatio={16 / 9}`; `aspectRatio={1}` in `Grid` cells gives square cells |
| CSS `align-self`, `position: absolute; inset: 0` / `right: 8px` | `alignSelf`, `position="absolute" left={0} top={0} right={0} bottom={0}` / `right={8}`: from the parent's padding box, as in CSS (the parent is always the containing block; no `position: relative` needed); inside a `Scroll` it scrolls with the content |
| CSS `background: linear-gradient(180deg, #1db954, #121212 60%)` | `background={{ linear: ["#1db954", ["#121212", 0.6]], angle: 180 }}` (linear only; on `<canvas>`: `g.linearGradient(x0, y0, x1, y1, stops)`) |
| CSS `opacity`, `transform: translate(...)` | props `opacity`, `translateX`, `translateY` (no `scale`/`rotate`) |
| `transition`, framer-motion, react-spring, `AnimatePresence` | `createTween`, `createPresence` (+ `<Show when={p.mounted}>`), `animate` |
| `prefers-color-scheme`, `ThemeProvider` with a dark theme | `setTheme("dark")`, `colorScheme()`, colors in functions: `() => theme.text.primary` |
| `white-space: nowrap` / `text-overflow: ellipsis` / `-webkit-line-clamp` | `wrap={false}` / `maxLines={1}` / `maxLines={n}` |
| CSS `text-align`, `line-height`, `text-decoration: underline` | `textAlign` (`start`/`center`/`end`), `lineHeight` (multiplier), `underline` (inherited) |
| CSS `font-weight: 600`, `font-weight: bold` | `fontWeight={600}`, `bold` (= 700); inherited |
| CSS `font-style: italic` | `italic` (inherited) |
| CSS `font-family: Inter, sans-serif` | `fontFamily="Inter, sans-serif"` (inherited; installed, registered or generic families) |
| CSS `@font-face`, `next/font`, `@fontsource/*` | `registerFont(path)` with the file imported `with { type: "file" }` (a `@fontsource` package's `.woff2` files work) |
| CSS `font-feature-settings: "tnum"`, `font-variant-numeric: tabular-nums` | `fontFeatures="tnum"` (inherited) |
| CSS `font-variation-settings: "wdth" 75` | `fontVariations="wdth 75"` (inherited) |
| CSS `letter-spacing: 0.08em` / `2px` | `letterSpacing={2}` (px only: multiply `em` by the `fontSize`); inherited |
| CSS `:hover` / `:active`, `.card:hover .play` | `hoverStyle={{ background: "#..." }}` / `pressStyle={{...}}` on any widget; state read elsewhere: `const card = createInteraction()`, `<Box {...card.props}>`, `<Show when={card.hovered}>` |
| selectable text (the default on the web) | only with `<Text selectable>`; without the prop it does not select (like `user-select: none`) |
| `navigator.clipboard.writeText/readText` | `clipboard.writeText(t)` / `await clipboard.readText()` |
| `fetch`, `fs`, timers | they work (Bun/Node APIs); update signals with the result |
| `window.requestAnimationFrame` | `import { requestAnimationFrame } from "@nodebuilderjs/core"`: there is no global of that name (this is not a browser); the import works in tests too (`frames()`) |

## npm libraries

- **Work:** pure logic without the DOM (date-fns, zod, lodash, HTTP clients, Bun's SQLite,
  parsers). Plain SVG icons with the `Icon` widget: `lucide-static`, `lucide` (the data,
  not `createIcons()`) and `@phosphor-icons/core` (skill `nodebuilder-icons`).
- **Do not work:** anything that renders React/Solid/Vue or touches the DOM: `lucide-react`,
  `lucide-solid`, `@phosphor-icons/react`, MUI, Chakra, shadcn/ui, Radix, Tailwind,
  styled-components, react-router, browser canvas/SVG charting libraries.
- Charts: use `@nodebuilderjs/core/charts` (same API as Recharts; skill
  `nodebuilder-charts`) or draw with `<Canvas>` (skill `nodebuilder-drawing`). Recharts,
  Chart.js and D3 need the DOM and do not work.
- When in doubt: if the package imports `react`, `react-dom`, `solid-js/web` or uses `document`,
  it will not work here.

## Common mistakes

- Calling `useContext` inside a handler or `setTimeout`: it only works in the component body.
- Reading the signal in the component body (`const x = count();`) and expecting it to update.
- Destructuring reactive props (`const { value } = props`) and losing the function.
- Putting `createSignal` inside an effect to "reset" state: create it outside and use `set`.
- Using a `ref` in the component body or in its first effect run: the JSX below has not run
  yet. Do it in `onMount`, or create the effect there.
- Calling the global `requestAnimationFrame`: it does not exist; import it from core.
