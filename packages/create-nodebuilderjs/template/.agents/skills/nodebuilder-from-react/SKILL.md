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
| component re-render | does not exist: the component runs **once** |
| `{count}` in JSX | `{count}` (the function, not `count()`), otherwise it stays fixed |
| `style={{ padding: 8 }}`, `className` | props: `padding={8}`, `background="#fff"` |
| `div`, `span`, `p`, `h1` | `Column`, `Row`, `Box`, `Text fontSize={24} bold` |
| input `onChange` | `TextField value={v} onInput={setV}` |
| `<input type="range">`, `type="radio"`, MUI switch, `<progress>` | `Slider`, `RadioGroup`, `Toggle`, `ProgressBar`/`Spinner` |
| `<select>`, Dialog/Modal, Tabs, Tooltip (MUI, Radix, shadcn) | `Select`, `Dialog`, `Tabs` (+ `<Switch>` for the content), `Tooltip` |
| `disabled` on input/button | `disabled` on any control (value or function) |
| `list.map(...)` in JSX | `<For each={list}>{(item) => ...}</For>` |
| `list.map((x, i) => ...)` with `key={i}` (list of primitives) | `<Index each={list}>{(item, i) => ...}</Index>`; `item` is an accessor (`item()`), `i` is a number |
| `cond && <X/>` | `<Show when={() => cond()}><X/></Show>` |
| `cond ? <A/> : <B/>`, `switch` that returns JSX | `<Show when={...} fallback={<B/>}><A/></Show>`; several cases: `<Switch fallback={...}><Match when={() => s() === "a"}>...</Match></Switch>` |
| `user && <X name={user.name}/>` | `<Show when={user}>{(u) => <X name={u().name} />}</Show>` (same as in Solid) |
| error boundary (`componentDidCatch`, `react-error-boundary`) | `<ErrorBoundary fallback={(error, reset) => ...}>` (as in Solid); catches errors on creation and in effects, not in `onClick` code |
| `createContext` / `useContext` | the same: `createContext(default)`, `<Ctx.Provider value={...}>`, `useContext(Ctx)`; a value that changes goes as an accessor |
| `useRef` + `ref={r}` / `el.focus()` | `ref={(el) => ...}` on any widget: `el.focus()`, `el.blur()`, `el.scrollTo(y)`, `el.width` |
| `overflow-y: auto` / `overflow-x: auto` / `overflow: auto` | `<Scroll>` / `<Scroll horizontal>` / `<Scroll horizontal vertical>` (with `grow={1}` or a size) |
| `el.scrollIntoView()`, `el.scrollTo({ left, top })`, `scrollLeft`/`scrollTop` | `el.scrollIntoView()` (scrolls the minimum, on the next frame), `el.scrollTo({ x, y })`, `el.scrollX`/`el.scrollY` |
| `min-height: 0` / `min-width: 0` around what scrolls | unnecessary: the content of a `Scroll` does not hold up the size of its container |
| `ResizeObserver`, media queries | `onResize={(s) => setWidth(s.width)}` + signal |
| `createPortal`, `position: fixed`, `z-index`, library modal/dropdown/tooltip | `<Overlay>` (`modal`, `anchor={() => el}`, `onDismiss`); skill `nodebuilder-ui` |
| CSS `align-self`, `position: absolute; inset: 0` / `right: 8px` | `alignSelf`, `position="absolute" left={0} top={0} right={0} bottom={0}` / `right={8}` (inside a `Scroll` it scrolls with the content) |
| CSS `opacity`, `transform: translate(...)` | props `opacity`, `translateX`, `translateY` (no `scale`/`rotate`) |
| `transition`, framer-motion, react-spring, `AnimatePresence` | `createTween`, `createPresence` (+ `<Show when={p.mounted}>`), `animate` |
| `prefers-color-scheme`, `ThemeProvider` with a dark theme | `setTheme("dark")`, `colorScheme()`, colors in functions: `() => theme.text.primary` |
| `white-space: nowrap` / `text-overflow: ellipsis` / `-webkit-line-clamp` | `wrap={false}` / `maxLines={1}` / `maxLines={n}` |
| CSS `text-align`, `line-height`, `text-decoration: underline` | `textAlign` (`start`/`center`/`end`), `lineHeight` (multiplier), `underline` (inherited) |
| CSS `:hover` | `onPointerEnter`/`onPointerLeave` + signal |
| selectable text (the default on the web) | only with `<Text selectable>`; without the prop it does not select (like `user-select: none`) |
| `navigator.clipboard.writeText/readText` | `clipboard.writeText(t)` / `await clipboard.readText()` |
| `fetch`, `fs`, timers | they work (Bun/Node APIs); update signals with the result |

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
