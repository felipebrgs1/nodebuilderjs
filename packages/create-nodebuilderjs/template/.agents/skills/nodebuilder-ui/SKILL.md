---
name: nodebuilder-ui
description: Widgets, props de estilo e layout do nodebuilder (Window, Column, Row, Scroll, Text, Button, TextField, Checkbox, Toggle, RadioGroup, Slider, Select, Tabs, Tooltip, Dialog, ProgressBar, Spinner, Card, For, Index, Show, Switch/Match, ErrorBoundary, theme), rolagem (vertical, horizontal, barras, teclado, scrollIntoView), contexto (createContext), ref (focar, rolar, medir), onResize, overlays (diálogo modal, menu suspenso, dica/tooltip), opacity e translate, texto selecionável e área de transferência (copiar/colar). Use ao criar ou mudar qualquer tela, formulário, lista, barra lateral ou layout de um app nodebuilder, quando o usuário precisa copiar um texto da tela, ou quando um elemento não aparece, não cresce ou não rola como esperado.
---

# Interface com nodebuilder

Tudo vem de `@nodebuilderjs/core`. Não há DOM nem CSS: widgets são funções e o estilo são
props planas. Reatividade estilo SolidJS: **só funções são reativas** (veja o AGENTS.md).

## Widgets

| Widget | Para quê | Props principais |
|---|---|---|
| `Window` | raiz, uma por app, com barra de título própria | `title`, `width`, `height` (tamanho inicial), `appId`, `onClose` (retorne `false` para não fechar) |
| `Column` / `Row` / `Box` | contêiner flex (coluna, linha; `Box` é coluna) | estilo + eventos |
| `Scroll` | rolagem: vertical (padrão), `horizontal` ou `horizontal vertical` (os dois) | precisa de `grow={1}` ou um tamanho; veja "Rolagem" abaixo |
| `Text` | texto; quebra linha nos espaços para caber na largura | filhos (`{count}`, `"a"`) ou `text={() => ...}`, `wrap` (padrão `true`), `maxLines` (corta com "…"), `textAlign`, `lineHeight`, `selectable` |
| `Image` | PNG, JPEG, WebP, AVIF | veja a skill `nodebuilder-imagens` |
| `Icon` | ícone SVG (Lucide, Phosphor), cor herdada como texto | `svg`, `size` (20), `color`, `strokeWidth`; skill `nodebuilder-icones` |
| `Canvas` | desenho livre: linhas, polígonos, arcos, texto | `draw={(g) => ...}` + tamanho; skill `nodebuilder-desenho` |
| `Button` | botão com foco e teclado | `label` ou filhos, `variant` (`default`, `primary`, `danger`, `flat`), `disabled`, `onClick` |
| `TextField` | campo de texto controlado | `value` (accessor), `onInput(valor)`, `onSubmit`, `placeholder`, `disabled` |
| `Checkbox` | caixa de seleção | `checked` (accessor), `onChange(marcado)`, `label`, `disabled` |
| `Toggle` | interruptor liga/desliga (`Switch` é o controle de fluxo) | `checked` (accessor), `onChange(ligado)`, `label`, `disabled` |
| `RadioGroup` | uma opção entre várias; uma parada do Tab, setas trocam | `value` (accessor), `onChange(v)`, `options=[{ value, label, disabled? }]`, `disabled` |
| `Slider` | número arrastando ou com setas/PageUp/Home/End | `value` (accessor), `onChange(n)`, `min` (0), `max` (100), `step` (1), `width` (200), `disabled` |
| `Select` | lista suspensa ancorada no campo; teclado completo | `value` (accessor, pode ser `undefined`), `onChange(v)`, `options=[{ value, label, disabled? }]`, `placeholder`, `width`, `disabled` |
| `Tabs` | barra de abas (o conteúdo é seu, com `<Switch>`) | `value` (accessor), `onChange(v)`, `tabs=[{ value, label, disabled? }]` |
| `Tooltip` | dica ao parar o ponteiro sobre o filho | `text`, `placement` (`"top"`), `delay` (500 ms), filho |
| `Dialog` | diálogo modal pronto: título, corpo, ações | `open` (accessor), `onClose`, `title`, `actions`, `width` (420), `dismissible` (true) |
| `ProgressBar` | barra de progresso, 6 px | `value` de 0 a 1 (sem ele: indeterminada) |
| `Spinner` | ocupado, sem medida | `size` (20), `color` |
| `Card` | coluna com fundo, borda, raio 12, padding 16, gap 8 | estilo |
| `Divider` / `Spacer` | linha de 1 px / espaço flexível (`size` fixo opcional) | |
| `<For each={lista}>{(item, i) => ...}</For>` | lista keyed por referência; `i` é um accessor | `fallback` |
| `<Index each={lista}>{(item, i) => ...}</Index>` | lista por posição (primitivos); `item` é um accessor, `i` um número | `fallback` |
| `<Show when={() => ...} fallback={...}>` | condicional; filho `{(v) => ...}` recebe o valor como accessor | |
| `<Switch fallback={...}><Match when={...}>...</Match></Switch>` | vários casos: o primeiro `Match` verdadeiro | `Match` aceita `{(v) => ...}` |
| `<ErrorBoundary fallback={(erro, reset) => ...}>` | troca filhos que lançaram erro pelo `fallback` | `reset()` tenta de novo |

```tsx
const [nome, setNome] = createSignal("");
<TextField value={nome} onInput={setNome} onSubmit={salvar} placeholder="Nome" />
<Checkbox checked={ativo} onChange={setAtivo} label="Ativo" />
<Button label="Salvar" variant="primary" disabled={() => !nome()} onClick={salvar} />
<Toggle checked={wifi} onChange={setWifi} label="Wi-Fi" />
<Slider value={volume} onChange={setVolume} max={100} step={5} />
```

`disabled` (valor ou função) em qualquer controle: esmaece, tira do Tab e do foco e ignora
cliques e teclas. Não simule com `opacity` + `onClick` vazio.

## Props de estilo (qualquer widget)

- Layout: `direction` (`"row"`/`"column"`), `gap`, `padding` (`8`, `[v, h]` ou
  `[top, right, bottom, left]`), `width`, `height`, `minWidth`, `minHeight`, `maxWidth`,
  `maxHeight`, `grow`, `align`, `justify`, `position: "absolute"` + `left`/`top`, `clip`.
- Visual: `background`, `radius`, `borderWidth`, `borderColor`, `shadow={{ color, blur, y }}`,
  `opacity` (0 a 1, vale para os filhos), `translateX`/`translateY` (desloca depois do
  layout, sem empurrar os irmãos; para animar).
- Texto (herdados pelos filhos): `color`, `fontSize`, `bold`. Cursor: `cursor="pointer"`.
- Cores são strings hex (`"#3584e4"`, `"#00000010"` com alfa) ou `"transparent"`.
- Eventos em qualquer contêiner: `onClick`, `onPointerDown/Up/Enter/Leave`,
  `onPointerMove`, `onScroll`, `onKeyDown`, `onFocus`, `onBlur`. Eventos de ponteiro trazem
  `x`/`y` (janela) e `localX`/`localY` (relativos ao nó); enquanto o botão está pressionado,
  `onPointerMove` continua chegando ao nó onde o clique começou, mesmo fora dele (arrastar,
  sliders). `onKeyDown` só chega pelo caminho do elemento focado.
- Qualquer prop aceita valor fixo ou função: `background={() => (sel() ? a : b)}`.
- `onResize={(s) => ...}`: tamanho do nó (`s.width`, `s.height`) depois do layout, na primeira
  vez e quando muda. Use para adaptar a tela à largura disponível.
- `ref={(el) => ...}` em qualquer widget: `el.focus()`, `el.blur()`, `el.scrollIntoView()`,
  num `Scroll` `el.scrollTo(y)` / `el.scrollTo({ x, y })` e `el.scrollX`/`el.scrollY`, e
  `el.x`/`y`/`width`/`height` do último layout. É chamado na criação, antes do layout:
  guarde o `el` e leia a caixa depois (num clique, por exemplo).

## Condições, listas e erros

```tsx
import { Button, ErrorBoundary, Index, Match, Show, Switch, Text, createSignal } from "@nodebuilderjs/core";

const [pedido, setPedido] = createSignal<{ id: number } | null>(null);
const [etapa, setEtapa] = createSignal<"carrinho" | "pagamento" | "fim">("carrinho");
const [notas] = createSignal([7, 9, 10]);

<Show when={pedido} fallback={<Text>Nenhum pedido</Text>}>
  {(p) => <Text>{() => `Pedido ${p().id}`}</Text>}
</Show>;

<Switch fallback={<Text>Obrigado!</Text>}>
  <Match when={() => etapa() === "carrinho"}><Text>Seu carrinho</Text></Match>
  <Match when={() => etapa() === "pagamento"}><Text>Pagamento</Text></Match>
</Switch>;

<Index each={notas}>{(nota, i) => <Text>{() => `Prova ${i + 1}: ${nota()}`}</Text>}</Index>;

<ErrorBoundary fallback={(erro, reset) => <Button label="Tentar de novo" onClick={reset} />}>
  <Text>{() => `Pedido ${pedido()!.id}`}</Text>
</ErrorBoundary>;
```

- `<For>` x `<Index>`: `For` acompanha cada **objeto** (a linha sobrevive a reordenar; recriar
  os objetos recria as linhas). `Index` acompanha cada **posição**: a linha fica e o accessor
  `item()` muda; bom para listas de números/strings ou dados que chegam sempre como objetos
  novos.
- Filho-função de `Show`/`Match` só com parâmetro: `{(p) => ...}` recebe o valor como
  accessor; `{() => ...}` (sem parâmetro) é um filho reativo comum.
- `Switch` só aceita `Match` como filhos, escritos no JSX (não gerados por função).
- `ErrorBoundary` pega erros ao criar os filhos e nos effects deles depois (ex.: um clique
  muda um signal e um texto lança). Descarta tudo que os filhos criaram e mostra o
  `fallback`; `reset()` recria os filhos. O que o próprio `onClick` lança não é capturado:
  trate com `try/catch` no handler.

## Contexto, ref e tamanho

```tsx
import { Column, Scroll, TextField, Text, createContext, createSignal, useContext } from "@nodebuilderjs/core";
import type { Accessor, ElementRef } from "@nodebuilderjs/core";

// Valor compartilhado pela árvore (tema, idioma, usuário logado), sem passar por props.
const Usuario = createContext<Accessor<string>>(() => "anônimo");
function Saudacao() {
  const usuario = useContext(Usuario);
  return <Text>{() => `Olá, ${usuario()}`}</Text>;
}
const [usuario, setUsuario] = createSignal("Ana");
<Usuario.Provider value={usuario}><Saudacao /></Usuario.Provider>;

// Focar um campo ao abrir e rolar uma lista até o fim.
const [busca, setBusca] = createSignal("");
let lista: ElementRef | undefined;
<Column grow={1}>
  <TextField ref={(el) => el.focus()} value={busca} onInput={setBusca} />
  <Scroll ref={(el) => (lista = el)} grow={1}>{/* ... */}</Scroll>
</Column>;
const irParaOFim = () => lista?.scrollTo(Infinity);
```

- O valor do contexto é lido uma vez, quando o componente roda. Para um valor que muda, passe
  um accessor (signal) e chame-o dentro de uma função reativa, como acima.
- `useContext` só funciona no corpo do componente (não dentro de um `onClick` ou `setTimeout`):
  leia lá e guarde numa variável.

## Rolagem

```tsx
import { Button, Card, For, Row, Scroll, Text } from "@nodebuilderjs/core";
import type { ElementRef } from "@nodebuilderjs/core";

const itens = Array.from({ length: 200 }, (_, i) => `Item ${i}`);
const linhas: ElementRef[] = [];
<>
  {/* Faixa que rola para o lado: os filhos mantêm a largura. */}
  <Scroll horizontal gap={12} padding={[0, 0, 14, 0]}>
    <For each={itens}>{(t) => <Card width={160}><Text>{t}</Text></Card>}</For>
  </Scroll>
  <Button label="Ir para o 150" onClick={() => linhas[150]?.scrollIntoView()} />
  <Scroll grow={1}>
    <For each={itens}>{(t, i) => <Row ref={(el) => (linhas[i()] = el)} padding={8}><Text>{t}</Text></Row>}</For>
  </Scroll>
  {/* Tabela larga e longa: rola nos dois eixos. */}
  <Scroll horizontal vertical height={300}>{/* linhas com larguras fixas */}</Scroll>
</>;
```

- `<Scroll>` rola na vertical. `horizontal`: uma linha cujos filhos mantêm a largura (texto
  dentro não quebra, a não ser com `width`/`maxWidth`). `horizontal vertical`: uma coluna
  que rola nos dois eixos; cada filho tem pelo menos a largura visível e cresce se o
  conteúdo pedir.
- O usuário rola com a roda (Shift+roda vai para o lado; touchpad nos dois eixos), arrastando
  o polegar da barra, clicando na trilha (uma página) e pelo teclado: PageUp/PageDown,
  Home/End e as setas rolam o `Scroll` em volta do elemento focado (sem foco, o que está sob
  o mouse), se nenhum `onKeyDown` chamar `e.stop()`. O `TextField` fica com Home/End e ←/→;
  ↑/↓ rolam.
- As barras ficam **por cima** do conteúdo, numa faixa de 14 px na borda direita (e na de
  baixo), e só existem quando há o que rolar: deixe `padding` nessa borda se houver botões
  encostados nela (como o `padding={[0, 0, 14, 0]}` acima).
- `el.scrollIntoView()` (em qualquer elemento, pelo `ref`) rola os `Scroll` em volta o mínimo
  para ele aparecer; vale no próximo frame, mesmo para um elemento recém-criado ou fora da
  tela. `el.scrollTo({ x, y })` aceita só um dos eixos.
- Um `<Overlay modal>` aberto bloqueia a roda, as teclas e as barras do que está atrás.

## Diálogos, menus e dicas: `<Overlay>`

Para os casos comuns use os widgets prontos (`Dialog`, `Select`, `Tooltip`), que já tratam
foco, teclado e fechar. O `<Overlay>` é para o que eles não cobrem (menu de opções, toast,
popover próprio):

Nada de `zIndex` nem `position: fixed`: o que precisa ficar por cima de tudo (fora do
recorte de um `Scroll` ou `Card`) vai num `<Overlay>`, quase sempre dentro de um `<Show>`.

```tsx
import { Button, Card, Overlay, Row, Show, Text, createSignal, theme } from "@nodebuilderjs/core";
import type { ElementRef } from "@nodebuilderjs/core";

const [menu, setMenu] = createSignal(false);
const [confirmar, setConfirmar] = createSignal(false);
let botao: ElementRef | undefined;
<>
  <Button ref={(el) => (botao = el)} label="Opções" onClick={() => setMenu((m) => !m)} />
  <Show when={menu}>
    <Overlay anchor={() => botao} matchWidth onDismiss={() => setMenu(false)}>
      <Card padding={4} shadow={{ color: "#00000030", blur: 16, y: 4 }}>
        <Button label="Excluir" variant="flat" onClick={() => (setMenu(false), setConfirmar(true))} />
      </Card>
    </Overlay>
  </Show>
  <Show when={confirmar}>
    <Overlay modal background="#00000059" align="center" justify="center" onDismiss={() => setConfirmar(false)}>
      <Card width={320} gap={12}>
        <Text bold>Excluir arquivo?</Text>
        <Row gap={8} justify="end">
          <Button label="Cancelar" variant="flat" onClick={() => setConfirmar(false)} />
          <Button label="Excluir" variant="danger" onClick={() => setConfirmar(false)} />
        </Row>
      </Card>
    </Overlay>
  </Show>
</>;
```

- `anchor={() => el}` (sempre como função): fica ao lado do elemento, `placement`
  `"bottom"` (padrão), `"top"`, `"right"` ou `"left"`, troca de lado se não couber, não sai da
  janela; `offset` (4) e `matchWidth` (mesma largura, para menus).
- Sem `anchor`: cobre a janela; posicione com `align`/`justify`/`padding` ou com
  `position="absolute"` + `left`/`top`. O espaço vazio deixa o clique passar (toasts, dicas).
- `modal`: bloqueia clique e Tab no que está atrás; `background` escurece o fundo.
- `onDismiss`: clique fora (no modal, no fundo escuro; nunca na âncora) ou Esc. Feche o
  `<Show>` ali.
- Declare o `<Overlay>` **fora** de um `Button` (ao lado dele, como acima): eventos dentro
  do overlay sobem pelos pais do lugar onde ele foi declarado.
- Transição: anime `opacity` e `translateY` com um signal atualizado em
  `requestAnimationFrame` (veja `examples/overlays.tsx` no repositório do nodebuilder).

## Regras do layout (flexbox simplificado)

- `align` padrão é **stretch**: filhos ocupam toda a largura de uma coluna. Use
  `align="start"`/`"center"` para encolher ao conteúdo.
- `justify`: `start`, `center`, `end`, `space-between`. Não existe `space-around`/`evenly`.
- `grow={1}` divide o espaço que sobra. Sem `grow`, o tamanho é o do conteúdo.
- Um filho **não encolhe abaixo do próprio conteúdo** (como `min-size: auto` do CSS), exceto
  `Scroll`, `clip` ou `minWidth/minHeight` explícito. Lista longa dentro de uma coluna
  que cresce sem parar? Envolva em `<Scroll grow={1}>`.
- O conteúdo de um `Scroll` não conta nesse mínimo: a coluna (ou linha) em volta dele
  encolhe sem precisar de `minHeight={0}`/`minWidth={0}`. Um `Scroll horizontal` não
  perde altura (só o que rola na vertical cede altura).
- Numa `Row` sem espaço, quem tem `grow` encolhe primeiro: o texto longo vai com
  `grow={1}` (e `maxLines={1}` para virar "…"), os rótulos curtos ao lado ficam inteiros.
- Texto quebra sozinho na largura que recebe (`\n` também quebra); palavra maior que a linha
  transborda. Uma linha só: `wrap={false}` (transborda) ou `maxLines={1}` (corta com "…").
- Não há porcentagens, `flex-wrap` nem grid: monte linhas com `Row` e larguras fixas (veja
  tabelas: `Text width={110}`) ou `grow`.

## Tema e janela

- Cores e tamanhos padrão em `theme` (`theme.text.secondary`, `theme.accent.base`,
  `theme.danger.base`, `theme.divider`...). Mude `theme` antes de `run()` para personalizar.
- `windowControls.close()`, `.minimize()`, `.toggleMaximize()`, `.setTitle(t)`;
  `windowState.width()`, `.height()`, `.maximized()`, `.activated()` são accessors.
- Ainda não existem: tema escuro reativo, API de animações (anime `opacity`/`translate` à
  mão), `scale`/`rotate`, seleção no `TextField`
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
