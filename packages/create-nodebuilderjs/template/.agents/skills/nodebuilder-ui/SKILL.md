---
name: nodebuilder-ui
description: Widgets, props de estilo e layout do nodebuilder (Window, Column, Row, Scroll, Text, Button, TextField, Checkbox, Card, For, Show, theme), texto selecionável e área de transferência (copiar/colar). Use ao criar ou mudar qualquer tela, formulário, lista, barra lateral ou layout de um app nodebuilder, quando o usuário precisa copiar um texto da tela, ou quando um elemento não aparece, não cresce ou não rola como esperado.
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
| `Text` | texto de uma linha (sem quebra automática) | filhos (`{count}`, `"a"`) ou `text={() => ...}`, `selectable` (o usuário seleciona e copia) |
| `Image` | PNG, JPEG, WebP, AVIF | veja a skill `nodebuilder-imagens` |
| `Icon` | ícone SVG (Lucide, Phosphor), cor herdada como texto | `svg`, `size` (20), `color`, `strokeWidth`; skill `nodebuilder-icones` |
| `Canvas` | desenho livre: linhas, polígonos, arcos, texto | `draw={(g) => ...}` + tamanho; skill `nodebuilder-desenho` |
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
- Eventos em qualquer contêiner: `onClick`, `onPointerDown/Up/Enter/Leave`,
  `onPointerMove`, `onScroll`, `onKeyDown`, `onFocus`, `onBlur`. Eventos de ponteiro trazem
  `x`/`y` (janela) e `localX`/`localY` (relativos ao nó); enquanto o botão está pressionado,
  `onPointerMove` continua chegando ao nó onde o clique começou, mesmo fora dele (arrastar,
  sliders). `onKeyDown` só chega pelo caminho do elemento focado.
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
- Ainda não existem: tema escuro, animações, quebra de linha, seleção no `TextField`
  (e Ctrl+C nele), IME, várias janelas.

## Selecionar e copiar texto

Texto comum **não seleciona**, de propósito (rótulos, botões, títulos). Texto que o usuário
pode querer copiar (ids, links, caminhos, mensagens de erro, resultados) leva `selectable`:

```tsx
<Text selectable>{pedido.id}</Text>
<Text selectable color={theme.danger.base}>{erro}</Text>
```

Com `selectable`: arrastar seleciona, clique duplo pega a palavra, clique triplo a linha,
Ctrl+A tudo e Ctrl+C copia; o cursor vira o de texto. Não entra na ordem do Tab, e dentro
da barra de título seleciona em vez de arrastar a janela. A seleção é de um `Text` por vez
(não atravessa vários) e ainda não tem Shift+clique nem Shift+setas.

A área de transferência do sistema (só texto) fica em `clipboard`:

```tsx
import { Button, clipboard, createSignal } from "@nodebuilderjs/core";

const [link, setLink] = createSignal("https://exemplo.com");
<Button label="Copiar link" onClick={() => clipboard.writeText(link())} />
<Button label="Colar" onClick={async () => setLink(await clipboard.readText())} />
```

- `readText()` é assíncrono (quem tem o conteúdo é outro programa) e devolve `""` se não
  houver texto.
- Copie a partir de um clique ou tecla (como acima): no Wayland o sistema ignora cópias que
  não vêm logo depois de uma interação do usuário (um `setTimeout` não serve).
- O `TextField` já cola com Ctrl+V / Shift+Insert (quebras de linha viram espaços), mas
  ainda não seleciona nem copia.
