---
name: nodebuilder-ui
description: Widgets, props de estilo e layout do nodebuilder (Window, Column, Row, Scroll, Text, Button, TextField, Checkbox, Card, For, Show, theme). Use ao criar ou mudar qualquer tela, formulário, lista, barra lateral ou layout de um app nodebuilder, ou quando um elemento não aparece, não cresce ou não rola como esperado.
---

# Interface com nodebuilder

Tudo vem de `@nodebuilderjs/core`. Não há DOM nem CSS: widgets são funções e o estilo são
props planas. Reatividade estilo SolidJS: **só funções são reativas** (veja o AGENTS.md).

## Widgets

| Widget | Para quê | Props principais |
|---|---|---|
| `Window` | raiz, uma por app, com barra de título própria | `title`, `width`, `height` (tamanho inicial), `appId`, `onClose` (retorne `false` para não fechar) |
| `Column` / `Row` / `Box` | contêiner flex (coluna, linha; `Box` é coluna) | estilo + eventos |
| `Scroll` | coluna com rolagem vertical | precisa de `grow={1}` ou `height`; filhos podem ser maiores |
| `Text` | texto de uma linha (sem quebra automática) | filhos (`{count}`, `"a"`) ou `text={() => ...}` |
| `Image` | PNG, JPEG, WebP, AVIF | veja a skill `nodebuilder-imagens` |
| `Icon` | ícone SVG (Lucide, Phosphor), cor herdada como texto | `svg`, `size` (20), `color`, `strokeWidth`; skill `nodebuilder-icones` |
| `Button` | botão com foco e teclado | `label` ou filhos, `variant` (`default`, `primary`, `danger`, `flat`), `disabled`, `onClick` |
| `TextField` | campo de texto controlado | `value` (accessor), `onInput(valor)`, `onSubmit`, `placeholder` |
| `Checkbox` | caixa de seleção | `checked` (accessor), `onChange(marcado)`, `label` |
| `Card` | coluna com fundo, borda, raio 12, padding 16, gap 8 | estilo |
| `Divider` / `Spacer` | linha de 1 px / espaço flexível (`size` fixo opcional) | |
| `<For each={lista}>{(item, i) => ...}</For>` | lista keyed por referência; `i` é um accessor | `fallback` |
| `<Show when={() => ...} fallback={...}>` | condicional | |

```tsx
const [nome, setNome] = createSignal("");
<TextField value={nome} onInput={setNome} onSubmit={salvar} placeholder="Nome" />
<Checkbox checked={ativo} onChange={setAtivo} label="Ativo" />
<Button label="Salvar" variant="primary" disabled={() => !nome()} onClick={salvar} />
```

## Props de estilo (qualquer widget)

- Layout: `direction` (`"row"`/`"column"`), `gap`, `padding` (`8`, `[v, h]` ou
  `[top, right, bottom, left]`), `width`, `height`, `minWidth`, `minHeight`, `maxWidth`,
  `maxHeight`, `grow`, `align`, `justify`, `position: "absolute"` + `left`/`top`, `clip`.
- Visual: `background`, `radius`, `borderWidth`, `borderColor`, `shadow={{ color, blur, y }}`.
- Texto (herdados pelos filhos): `color`, `fontSize`, `bold`. Cursor: `cursor="pointer"`.
- Cores são strings hex (`"#3584e4"`, `"#00000010"` com alfa) ou `"transparent"`.
- Eventos em qualquer contêiner: `onClick`, `onPointerDown/Up/Enter/Leave`, `onScroll`,
  `onKeyDown`, `onFocus`, `onBlur`. `onKeyDown` só chega pelo caminho do elemento focado.
- Qualquer prop aceita valor fixo ou função: `background={() => (sel() ? a : b)}`.

## Regras do layout (flexbox simplificado)

- `align` padrão é **stretch**: filhos ocupam toda a largura de uma coluna. Use
  `align="start"`/`"center"` para encolher ao conteúdo.
- `justify`: `start`, `center`, `end`, `space-between`. Não existe `space-around`/`evenly`.
- `grow={1}` divide o espaço que sobra. Sem `grow`, o tamanho é o do conteúdo.
- Um filho **não encolhe abaixo do próprio conteúdo** (como `min-size: auto` do CSS), exceto
  `Scroll`, `clip` ou `minWidth/minHeight` explícito. Lista longa dentro de uma coluna
  que cresce sem parar? Envolva em `<Scroll grow={1}>`.
- Para um `Scroll` dentro de uma coluna com `grow`, a coluna também precisa de `minHeight={0}`.
- Não há porcentagens, `flex-wrap`, grid nem quebra de linha de texto: monte linhas com `Row`
  e larguras fixas (veja tabelas: `Text width={110}`) ou `grow`.

## Tema e janela

- Cores e tamanhos padrão em `theme` (`theme.text.secondary`, `theme.accent.base`,
  `theme.danger.base`, `theme.divider`...). Mude `theme` antes de `run()` para personalizar.
- `windowControls.close()`, `.minimize()`, `.toggleMaximize()`, `.setTitle(t)`;
  `windowState.width()`, `.height()`, `.maximized()`, `.activated()` são accessors.
- Ainda não existem: tema escuro, animações, quebra de linha, seleção de texto, IME,
  várias janelas.
