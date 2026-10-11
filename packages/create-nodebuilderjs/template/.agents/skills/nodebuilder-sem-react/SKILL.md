---
name: nodebuilder-sem-react
description: Tradução de hábitos de React, DOM, CSS e bibliotecas web para o nodebuilder, e quais pacotes npm funcionam. Use antes de instalar qualquer biblioteca de UI, ícones, componentes, estado ou estilo (lucide-react, MUI, Tailwind, styled-components, react-*, solid-js...), ao escrever useState/useEffect/className/div/onChange, ou ao portar código React/Solid/HTML para este app.
---

# Vindo do React (ou da web)

O nodebuilder desenha a interface com a GPU, sem navegador: **não existe DOM, CSS, React
nem Solid**. O JSX parece o de sempre, mas os elementos são os widgets do
`@nodebuilderjs/core`.

## Tradução direta

| Na web / React | No nodebuilder |
|---|---|
| `useState(0)` | `const [n, setN] = createSignal(0)`; leia com `n()` |
| `useMemo` | `createMemo(() => ...)` |
| `useEffect(() => ..., [deps])` | `createEffect(() => ...)` (deps automáticas) + `onCleanup` |
| re-render do componente | não existe: o componente roda **uma vez** |
| `{count}` em JSX | `{count}` (a função, não `count()`), senão fica fixo |
| `style={{ padding: 8 }}`, `className` | props: `padding={8}`, `background="#fff"` |
| `div`, `span`, `p`, `h1` | `Column`, `Row`, `Box`, `Text fontSize={24} bold` |
| `onChange` de input | `TextField value={v} onInput={setV}` |
| `list.map(...)` em JSX | `<For each={list}>{(item) => ...}</For>` |
| `cond && <X/>` | `<Show when={() => cond()}><X/></Show>` |
| `useContext` | módulos com signals exportados (estado global simples) |
| CSS `:hover` | `onPointerEnter`/`onPointerLeave` + signal |
| `fetch`, `fs`, timers | funcionam (APIs do Bun/Node); atualize signals com o resultado |

## Bibliotecas npm

- **Funcionam:** lógica pura sem DOM (date-fns, zod, lodash, clientes HTTP, SQLite do Bun,
  parsers). Ícones em SVG puro com o widget `Icon`: `lucide-static`, `lucide` (os dados,
  não o `createIcons()`) e `@phosphor-icons/core` (skill `nodebuilder-icones`).
- **Não funcionam:** tudo que renderiza React/Solid/Vue ou mexe no DOM: `lucide-react`,
  `lucide-solid`, `@phosphor-icons/react`, MUI, Chakra, shadcn/ui, Radix, Tailwind,
  styled-components, react-router, bibliotecas de gráficos em canvas/SVG do navegador.
- Gráficos: use `@nodebuilderjs/core/charts` (mesma API do Recharts; skill
  `nodebuilder-graficos`) ou desenhe com `<Canvas>` (skill `nodebuilder-desenho`). Recharts,
  Chart.js e D3 precisam do DOM e não funcionam.
- Na dúvida: se o pacote importa `react`, `react-dom`, `solid-js/web` ou usa `document`,
  ele não serve aqui.

## Erros comuns

- Ler o signal no corpo do componente (`const x = count();`) e esperar que atualize.
- Desestruturar props reativas (`const { value } = props`) e perder a função.
- Colocar `createSignal` dentro de um effect para "resetar" estado: crie fora e use `set`.
