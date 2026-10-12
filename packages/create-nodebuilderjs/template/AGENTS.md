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
- Listas: `<For each={lista}>{(item) => ...}</For>` (chave por referência) ou
  `<Index each={lista}>{(item) => ...}</Index>` (por posição; `item` é accessor).
  Condicional: `<Show when={() => ...} fallback={...}>`; vários casos: `<Switch>` com
  `<Match when={...}>`. Erros: `<ErrorBoundary fallback={(erro, reset) => ...}>`.
- Estilo são props planas (`padding`, `gap`, `grow`, `background`...), não CSS. Não existem
  `className`, `style={{}}`, `div`, `useState` nem bibliotecas de React (ex.: `lucide-react`).

## Skills (detalhes por assunto)
Em `.agents/skills/<nome>/SKILL.md` (com links em `.claude/skills/` para o Claude Code). Agentes
que suportam skills as carregam sozinhos; os outros devem ler a skill do assunto antes de começar:

| Skill | Quando |
|---|---|
| `nodebuilder-ui` | telas, widgets (incl. `Toggle`, `RadioGroup`, `Slider`, `Select`, `Tabs`, `Tooltip`, `Dialog`, `ProgressBar`, `disabled`), props de estilo, layout, `For`/`Index`/`Show`/`Switch`, `ErrorBoundary`, rolagem (horizontal, barras, teclado, `scrollIntoView`), contexto, `ref` (focar, rolar), `onResize`, `Overlay` (diálogo, menu, dica), `opacity`/`translate`, tema (claro/escuro, `setTheme`), animações, texto selecionável, copiar/colar |
| `nodebuilder-sem-react` | antes de instalar bibliotecas ou portar código React/web |
| `nodebuilder-imagens` | imagens (PNG, JPEG, WebP, AVIF), arquivos no app |
| `nodebuilder-icones` | ícones (Lucide, Phosphor) e SVG com `Icon` |
| `nodebuilder-graficos` | gráficos prontos (`@nodebuilderjs/core/charts`, API do Recharts) |
| `nodebuilder-desenho` | desenho livre com `Canvas` |
| `nodebuilder-testes` | testes sem janela (`mount`, `findByText`, `click`, `interact`, área de transferência) |
| `nodebuilder-empacotar` | AppImage/.deb/.rpm, arquivos embutidos, ícone e app id |
| `nodebuilder-desempenho` | lentidão, listas grandes, dados ao vivo, animação |
