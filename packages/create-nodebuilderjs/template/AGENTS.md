# AGENTS.md

App nodebuilder: UI nativa para Linux em TSX, **sem DOM e sem React**. Leia antes de mudar código.

## Comandos
- `bun run dev` abre o app; `bun test` roda os testes sem janela; `bun run typecheck` checa tipos.
- Antes de concluir: `bun run typecheck && bun test`.

## Modelo (igual ao SolidJS, não ao React)
- **Componentes rodam uma vez.** Não há re-render nem hooks. Estado é `createSignal`;
  derivados são `createMemo`; efeitos são `createEffect` (+ `onCleanup`).
- **Só funções são reativas.** `<Text>{count}</Text>` ou `text={() => ...}` atualizam;
  `<Text>{count()}</Text>` é lido uma vez e nunca muda. O mesmo vale para estilo:
  `background={() => (ativo() ? "#3584e4" : "#0000")}`.
- Listas: `<For each={lista}>{(item) => ...}</For>` (chave por referência). Condicional:
  `<Show when={() => ...} fallback={...}>`.

## Widgets e estilo
- `Window` (raiz, uma por app), `Column`/`Row`/`Box`, `Scroll`, `Text`, `Button`, `TextField`,
  `Checkbox`, `Card`, `Divider`, `Spacer`. Tudo vem de `@nodebuilderjs/core`.
- Estilo são props planas, não CSS: `padding`, `gap`, `grow`, `align`, `justify`, `width`,
  `height`, `background`, `radius`, `borderWidth`, `borderColor`, `color`, `fontSize`, `bold`.
  Layout é flexbox; `align` padrão é `stretch`. `color`, `fontSize` e `bold` são herdados.
- Cores padrão em `theme` (`theme.text.secondary`, `theme.accent.base`...).
- Não existem `className`, `style={{}}`, `div`, `span`, `onChange` de DOM nem `useState`.

## Testes
- `@nodebuilderjs/core/testing`: `mount(() => <App />)`, `findByText(root, "texto")`,
  `click(node)` (sobe até o pai clicável). Métricas de texto falsas: 8 px por caractere.
