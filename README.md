# nodebuilder

Apps desktop **nativos para Linux** escritos em TypeScript e TSX.

Sem DOM, sem Electron, sem GTK/Qt: seus componentes são desenhados por um núcleo nativo
pequeno (Wayland/X11 + OpenGL ES), com reatividade no estilo SolidJS. O resultado abre
rápido, usa **entre um quarto e metade da memória** de um app Electron equivalente e vira um
AppImage, `.deb` ou `.rpm` com um comando.

```tsx
import { Button, Column, Text, Window, createSignal, run } from "@nodebuilderjs/core";

function App() {
  const [count, setCount] = createSignal(0);
  return (
    <Window title="Contador" width={400} height={300}>
      <Column grow={1} align="center" justify="center" gap={16}>
        <Text fontSize={40} bold>{count}</Text>
        <Button label="+1" variant="primary" onClick={() => setCount((c) => c + 1)} />
      </Column>
    </Window>
  );
}

run(() => <App />);
```

> **Estado:** versão 0.1, experimental. A API ainda pode mudar. Veja o [roadmap](ROADMAP.md).

## Começar

Requisitos: Linux com Wayland ou X11 e [Bun](https://bun.sh) 1.4+.

```sh
bun create nodebuilderjs meu-app
cd meu-app
bun run dev        # abre a janela e reinicia ao salvar
```

O projeto já vem com um teste de exemplo (`bun test`, sem abrir janela), TypeScript
configurado (`bun run typecheck`) e um `AGENTS.md` que explica o framework para agentes de
código como o Claude Code.

## Como funciona, em 30 segundos

- **Componentes rodam uma vez.** Não há re-render nem virtual DOM. Estado é `createSignal`,
  valores derivados são `createMemo`.
- **Só funções são reativas.** `<Text>{count}</Text>` atualiza sozinho;
  `<Text>{count()}</Text>` lê o valor uma vez. Vale para estilo também:
  `background={() => (ativo() ? "#3584e4" : "#ffffff")}`.
- **Estilo são props, não CSS:** `padding`, `gap`, `grow`, `align`, `justify`, `background`,
  `radius`, `color`, `fontSize`... O layout é flexbox.
- **Widgets prontos:** `Window`, `Column`, `Row`, `Scroll`, `Text`, `Image`, `Icon`, `Canvas`,
  `Button`, `TextField`, `Checkbox`, `Toggle`, `RadioGroup`, `Slider`, `ProgressBar`, `Spinner`,
  `Card`, `Divider`, `Spacer`, além de `<For>`/`<Index>`,
  `<Show>`/`<Switch>` e `<ErrorBoundary>` para listas, condições e erros, e de
  `createContext` para valores compartilhados pela árvore.

Exemplos completos em [`examples/`](examples): contador, lista de tarefas, imagens, ícones,
desenho livre, gráficos, overlays (menu, diálogo e dica), texto (parágrafos, alinhamento,
reticências), rolagem (horizontal, nos dois eixos, `scrollIntoView`) e um painel
com abas, tabela e gráfico.

### Imagens

```tsx
import logo from "./logo.png" with { type: "file" };

<Image src={logo} width={64} />                                   // altura segue a proporção
<Image src={foto} width={200} height={120} fit="cover" radius={12} opacity={0.8} />
```

`fit` pode ser `contain` (padrão: a imagem inteira, centralizada), `cover` (preenche e corta)
ou `fill` (estica). Sem `width`/`height`, a imagem usa o próprio tamanho em pixels. O
`with { type: "file" }` faz o `nodebuilder package` embutir o arquivo no executável; `src`
também aceita um caminho, uma `URL` `file:`, os bytes do arquivo (`Uint8Array`) ou pixels
já decodificados (`{ width, height, data }` em RGBA).

Formatos: **PNG, JPEG e WebP** são decodificados em TypeScript (o JPEG respeita a orientação
do EXIF, e todos dão o mesmo resultado, byte a byte, que libpng, libjpeg-turbo e libwebp).
**AVIF e HEIC** usam a `libheif` do sistema, carregada só quando necessário: sem ela, apenas
esses formatos dão erro, e os pacotes gerados a sugerem sem obrigar. SVG é desenhado pelo
`<Icon>` (abaixo).

### Ícones

```tsx
import camera from "lucide-static/icons/camera.svg" with { type: "text" };  // bun add lucide-static
import heart from "@phosphor-icons/core/assets/duotone/heart-duotone.svg" with { type: "text" };
import { Star } from "lucide";                                              // ou os dados do lucide

<Icon svg={camera} />                          // 20 px, cor herdada como a do texto
<Icon svg={heart} size={32} color="#e01b24" />
<Button variant="primary"><Icon svg={Star} size={16} /><Text>Favoritar</Text></Button>
```

`<Icon>` desenha SVG com um renderizador próprio, em TypeScript, feito para ícones: caminhos
(com arcos e curvas), formas, contorno com pontas e junções, `transform`, opacidade e
`currentColor`. Lucide e Phosphor saem praticamente iguais ao librsvg (diferença média de 0,8
em 255 na borda dos traços). Um ícone de uma cor só é rasterizado uma vez, no tamanho exato
da tela (nítido também em HiDPI), e a cor é aplicada na GPU: trocar a cor, num hover por
exemplo, não custa nada. `strokeWidth` muda a espessura dos ícones de contorno, como no
Lucide. Gradientes, texto, filtros, máscaras e `<use>` ainda não são suportados, então
ilustrações complexas devem virar PNG. Pacotes para React (`lucide-react`,
`@phosphor-icons/react`) não funcionam: use `lucide-static`, `lucide` ou `@phosphor-icons/core`.

### Desenho livre

```tsx
<Canvas height={160} draw={(g) => {
  const pts = dados().flatMap((v, i) => [i * 10, g.height - v]);   // signals lidos aqui redesenham
  g.polygon([0, g.height, ...pts, g.width, g.height], "#3584e433"); // área
  g.polyline(pts, theme.accent.base, 2);                            // linha
  g.arc(80, 80, 60, 40, 0, Math.PI, "#26a269");                     // rosca: raios, início, varredura
}} />
```

`<Canvas>` desenha com primitivas da GPU com antialiasing: linhas grossas com pontas
redondas, retas ou quadradas, polígonos preenchidos (côncavos inclusive), círculos e arcos
(pizza, rosca, medidores) e texto. As coordenadas são locais ao canvas; `g.width` e `g.height`
dão o tamanho. Os signals lidos em `draw` são rastreados: mudar um deles redesenha. A
geometria é calculada quando os dados mudam, não a cada frame. Limites: polígono que cruza a
si mesmo não é desenhado, e em linhas com cor translúcida as junções ficam mais escuras.

### Gráficos

```tsx
import { LineChart, Line, Area, AreaChart, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Legend } from "@nodebuilderjs/core/charts";

<LineChart data={vendas} height={240}>        {/* data pode ser um signal: o gráfico acompanha */}
  <CartesianGrid vertical={false} />
  <XAxis dataKey="mes" />
  <YAxis tickFormatter={(v) => `R$ ${v}`} />
  <Line dataKey="receita" name="Receita" />
  <Line dataKey="meta" stroke="#e5a50a" type="monotone" dot={false} />
  <Legend />
</LineChart>
```

A API segue o formato do Recharts: `LineChart`, `AreaChart`, `BarChart`, `ComposedChart` e
`PieChart`, com `Line`, `Area`, `Bar`, `Pie`/`Cell`, `XAxis`, `YAxis`, `CartesianGrid` e
`Legend` como filhos. Os eixos têm passos redondos (como o d3), o eixo y inclui o zero, e
`type="monotone"` suaviza a curva. Também há `<Tooltip>` (linha-guia e valores da categoria
sob o mouse; na pizza, a fatia), empilhamento com `stackId`, `strokeDasharray` em linhas e
grade, `label` em fatias e barras, e o eixo x omite rótulos que se sobrepõem. Tudo é
desenhado com o `<Canvas>`, pela GPU, e vem no próprio core: quem não importa
`@nodebuilderjs/core/charts` não leva nada no executável (quem usa, ~15 KB). Ainda não
existem gráficos de dispersão e radar, `ReferenceLine`, `Brush` nem eixos secundários.

### Condições, listas e erros

Como no SolidJS: componentes que decidem quando criar (e descartar) os filhos.

```tsx
import { Button, Column, ErrorBoundary, For, Index, Match, Show, Switch, Text, createSignal } from "@nodebuilderjs/core";

const [usuario, setUsuario] = createSignal<{ nome: string } | null>(null);
const [status, setStatus] = createSignal<"carregando" | "erro" | "ok">("carregando");
const [tarefas] = createSignal([{ titulo: "Comprar pão" }]);
const [notas] = createSignal([7, 9, 10]);

// Show: com filho-função, recebe o valor (verdadeiro) como accessor.
<Show when={usuario} fallback={<Text>Entre na sua conta</Text>}>
  {(u) => <Text>{() => `Olá, ${u().nome}`}</Text>}
</Show>;

// Switch: o primeiro Match verdadeiro; o conteúdo só é recriado quando muda o Match escolhido.
<Switch fallback={<Text>Tudo certo</Text>}>
  <Match when={() => status() === "carregando"}><Text>Carregando...</Text></Match>
  <Match when={() => status() === "erro"}><Text color="#c01c28">Falhou</Text></Match>
</Switch>;

// For: keyed por referência (a linha acompanha o objeto); i é um accessor.
<For each={tarefas} fallback={<Text>Nada a fazer</Text>}>
  {(t, i) => <Text>{() => `${i() + 1}. ${t.titulo}`}</Text>}
</For>;

// Index: por posição (bom para primitivos); item é um accessor, i é um número fixo.
<Index each={notas}>{(nota, i) => <Text>{() => `Prova ${i + 1}: ${nota()}`}</Text>}</Index>;

// ErrorBoundary: um erro ao criar os filhos ou num effect deles mostra o fallback.
<ErrorBoundary
  fallback={(erro, tentarDeNovo) => (
    <Column gap={8}>
      <Text>{`Algo deu errado: ${erro instanceof Error ? erro.message : String(erro)}`}</Text>
      <Button label="Tentar de novo" onClick={tentarDeNovo} />
    </Column>
  )}
>
  <Text>{() => usuario()!.nome}</Text>
</ErrorBoundary>;
```

- `when` aceita valor ou accessor. O filho-função precisa declarar o parâmetro
  (`{(u) => ...}`); uma função sem parâmetros (`{() => ...}`) continua sendo um filho
  reativo comum. O accessor guarda o último valor verdadeiro, então um effect da linha que
  rode antes de ela ser descartada não vê `null`.
- `<Switch>` só aceita `<Match>` como filho (ou `false`/`null`, para `{cond && <Match>}`);
  `<Match>` fora de um `<Switch>` é erro.
- `<ErrorBoundary>` captura o que é lançado ao criar os componentes filhos e, depois, pelos
  effects e memos deles (inclusive quando um clique muda um signal e um effect falha). O que
  os filhos criaram é descartado (effects, `onCleanup`, overlays). O `fallback` pode ser
  conteúdo ou uma função `(erro, reset)`; `reset()` cria os filhos de novo. Não captura o
  que o próprio handler (`onClick`...) lança: esse erro chega a quem chamou o handler, como
  no React e no Solid. Erros sem boundary continuam aparecendo como antes.

### Contexto, `ref` e tamanho

```tsx
import { Box, Column, TextField, Text, createContext, createSignal, useContext } from "@nodebuilderjs/core";

// Contexto: um valor que qualquer descendente lê, sem passar por props em cada nível.
const Idioma = createContext("pt");
function Saudacao() {
  return <Text>{useContext(Idioma) === "pt" ? "Olá" : "Hello"}</Text>;
}
<Idioma.Provider value="en"><Saudacao /></Idioma.Provider>;

// ref: o elemento do widget, para focar, rolar e ler a caixa do último layout.
const [nome, setNome] = createSignal("");
<TextField ref={(el) => el.focus()} value={nome} onInput={setNome} />;

// onResize: o tamanho do nó depois do layout (na primeira vez e quando muda).
const [largura, setLargura] = createSignal(0);
<Box grow={1} onResize={(s) => setLargura(s.width)}>
  <Column>{() => (largura() > 600 ? "largo" : "estreito")}</Column>
</Box>;
```

- Para um valor que muda, passe um accessor no contexto (`value={tema}`, com `tema` um
  signal) e chame-o onde usa (`useContext(Tema)()`).
- O `ref` recebe um `ElementRef`: `x`, `y`, `width` e `height` do último layout (coordenadas
  da janela), `focus()`, `blur()`, `scrollIntoView()` e, num `Scroll`, `scrollTo(y)` ou
  `scrollTo({ x, y })`, `scrollX` e `scrollY`. O `ref` é chamado quando o widget é criado,
  antes do layout; um `focus()` ou `scrollIntoView()` nessa hora vale assim que o widget
  entra na árvore.

### Rolagem

```tsx
import { Button, Card, For, Row, Scroll, Text } from "@nodebuilderjs/core";
import type { ElementRef } from "@nodebuilderjs/core";

const itens = Array.from({ length: 200 }, (_, i) => `Item ${i}`);
const linhas: ElementRef[] = [];
<>
  <Scroll horizontal gap={12}>                    {/* faixa que rola para o lado */}
    <For each={itens}>{(t) => <Card width={160}><Text>{t}</Text></Card>}</For>
  </Scroll>
  <Button label="Ir para o 150" onClick={() => linhas[150]?.scrollIntoView()} />
  <Scroll grow={1}>
    <For each={itens}>{(t, i) => <Row ref={(el) => (linhas[i()] = el)} padding={8}><Text>{t}</Text></Row>}</For>
  </Scroll>
  <Scroll horizontal vertical height={300}>{/* tabela larga e longa */}</Scroll>
</>;
```

- `<Scroll>` rola na vertical; `horizontal` faz uma linha cujos filhos mantêm a largura
  (texto dentro não quebra, a não ser com `width`/`maxWidth`); `horizontal vertical` rola
  nos dois eixos, numa coluna em que cada filho tem pelo menos a largura visível.
- Roda do mouse e touchpad nos dois eixos; Shift+roda rola para o lado. As barras são finas,
  por cima do conteúdo (como no GTK e no macOS), e engrossam sob o mouse: arrastar o polegar
  rola junto, clicar na trilha avança uma página. Elas só pegam o clique (numa faixa de 14 px
  na borda) quando há o que rolar.
- Teclado: PageUp/PageDown, Home/End e as setas rolam o `Scroll` em volta do elemento
  focado (sem foco, o que está sob o mouse), se nenhum `onKeyDown` chamar `e.stop()`. O
  `TextField` continua com Home/End e ←/→ para o cursor.
- `scrollIntoView()` rola cada `Scroll` em volta do elemento o mínimo necessário, no próximo
  frame (também para um elemento que acabou de ser criado ou que está longe, fora da tela).
- O conteúdo de um `Scroll` não segura o tamanho de quem o contém: uma coluna com um
  `Scroll grow={1}` dentro encolhe sem `minHeight={0}`.
- Um `<Overlay modal>` aberto bloqueia roda, teclas e barras do que está atrás.

### Controles

```tsx
import { ProgressBar, RadioGroup, Slider, Toggle, createSignal } from "@nodebuilderjs/core";

const [wifi, setWifi] = createSignal(true);
const [tamanho, setTamanho] = createSignal("m");
const [volume, setVolume] = createSignal(40);
<Toggle checked={wifi} onChange={setWifi} label="Wi-Fi" />;
<RadioGroup value={tamanho} onChange={setTamanho} options={[
  { value: "p", label: "Pequeno" },
  { value: "m", label: "Médio" },
  { value: "g", label: "Grande", disabled: true },
]} />;
<Slider value={volume} onChange={setVolume} min={0} max={100} step={5} />;
<ProgressBar value={() => volume() / 100} />; // sem value: indeterminada
```

- Todo controle aceita `disabled` (valor ou função): fica esmaecido
  (`theme.disabledOpacity`), sai da ordem do Tab, perde o foco e não responde.
- Teclado: `Toggle`/`Checkbox`/`Button` com Espaço ou Enter; `RadioGroup` é uma parada só do
  Tab e as setas trocam a opção (pulando as desabilitadas); `Slider` com setas (um `step`),
  PageUp/PageDown (um décimo), Home/End.
- `Toggle` é o interruptor liga/desliga: o nome `Switch` já é do controle de fluxo.
- `Spinner` gira enquanto está na tela (`size`, `color`).

### Texto

`<Text>` quebra linha nos espaços para caber na largura que recebe, como na web; `\n` sempre
quebra. Palavra maior que a linha transborda (não é cortada no meio).

```tsx
import { Row, Text, theme } from "@nodebuilderjs/core";

<Text textAlign="center" lineHeight={1.4}>Um parágrafo longo que quebra em várias linhas.</Text>;
<Row gap={8}>
  <Text grow={1} maxLines={1}>nome-de-arquivo-muito-comprido.pdf</Text>
  <Text color={theme.text.secondary}>12 MB</Text>
</Row>;
```

- `wrap={false}`: uma linha só (fora as quebras com `\n`), mesmo que transborde.
- `maxLines`: corta e termina a última linha em "…"; `maxLines={1}` encurta uma linha só.
- `textAlign` (`"start"`, `"center"`, `"end"`) e `lineHeight` (múltiplo do espaçamento da
  fonte, padrão 1).
- Numa `Row` sem espaço, quem tem `grow` encolhe primeiro (como o `Expanded` do Flutter); um
  texto que quebra pode encolher até a palavra mais longa, e com `maxLines` até o "…".

### Overlays: diálogos, menus e dicas

`<Overlay>` desenha o conteúdo numa camada acima da janela inteira, fora do recorte de quem
o contém, e continua enxergando o contexto e a cor de texto do lugar onde foi declarado.

```tsx
import { Button, Card, Overlay, Show, Text, createSignal } from "@nodebuilderjs/core";
import type { ElementRef } from "@nodebuilderjs/core";

// Menu ancorado num botão: abaixo dele (acima, se não couber), da mesma largura.
const [aberto, setAberto] = createSignal(false);
let botao: ElementRef | undefined;
<>
  <Button ref={(el) => (botao = el)} label="Opções" onClick={() => setAberto((a) => !a)} />
  <Show when={aberto}>
    <Overlay anchor={() => botao} matchWidth onDismiss={() => setAberto(false)}>
      <Card padding={4}><Text>Renomear</Text></Card>
    </Overlay>
  </Show>
</>;

// Diálogo modal: cobre a janela, escurece o fundo e bloqueia o clique e o Tab de trás.
<Overlay modal background="#00000059" align="center" justify="center" onDismiss={() => setAberto(false)}>
  <Card width={320}><Text>Excluir arquivo?</Text></Card>
</Overlay>;
```

- Sem `anchor`, a camada cobre a janela e posiciona os filhos com as props de flex
  (`align`, `justify`, `padding`) ou com `position="absolute"`. O espaço vazio deixa o clique
  passar, a não ser com `modal`.
- Com `anchor`: `placement` (`"bottom"`, `"top"`, `"right"`, `"left"`), `offset` (4) e
  `matchWidth`. Passe a âncora como função (`() => botao`), porque o `ref` só é preenchido
  quando o botão é criado.
- `onDismiss` é chamado num clique fora (no modal, no fundo; nunca na âncora) e no Esc.
- Um overlay aberto depois fica por cima dos anteriores.

`opacity` (0 a 1) e `translateX`/`translateY` valem em qualquer widget e servem para
transições, como no exemplo `bun run overlays`. Eles atualizam com um signal e
`requestAnimationFrame`. `translate` desloca o nó e os filhos depois do layout, sem
empurrar os irmãos, como o `transform` do CSS.

### Área de transferência

```tsx
import { Button, clipboard, createSignal } from "@nodebuilderjs/core";

const [texto, setTexto] = createSignal("");
<Button label="Copiar" onClick={() => clipboard.writeText(texto())} />
<Button label="Colar" onClick={async () => setTexto(await clipboard.readText())} /> // "" se não houver texto
```

Texto fixo pode ser selecionado e copiado com `<Text selectable>`: arrastar seleciona,
clique duplo pega a palavra, clique triplo a linha, Ctrl+A tudo e Ctrl+C copia. Fica
desligado por padrão, para rótulos e botões não selecionarem sem querer.

É a área de transferência do sistema (Wayland e X11), só texto. O `TextField` cola com
Ctrl+V ou Shift+Insert (quebras de linha viram espaços). Sem janela, como nos testes, é uma
área de transferência em memória. No Wayland, o compositor só aceita a cópia logo depois de
uma tecla ou clique (o normal: Ctrl+C, botão "Copiar").

## Distribuir

```sh
bun run package
```

Gera em `dist/` um **AppImage**, um **`.deb`**, um **`.rpm`** e um **`.tar.gz`**, cada um com
um executável único (Bun + seu app + núcleo nativo), atalho no menu e ícone. Funciona em
Ubuntu 22.04+, Debian 12+, Fedora, RHEL 9+ e derivados.

## Benchmarks

As mesmas duas cenas feitas em cinco tecnologias, medidas na mesma sessão:

| | Linguagem | Como desenha |
|---|---|---|
| **Electron 44** | JS + HTML/CSS | Chromium embutido |
| **Tauri 2** | JS + HTML/CSS (Rust só na casca) | WebKitGTK do sistema |
| **Flutter 3.47** | Dart | motor próprio (OpenGL ES) |
| **egui 0.36** | Rust | immediate mode, wgpu (Vulkan) |
| **nodebuilder** | TypeScript | núcleo próprio (OpenGL ES) |

Electron e Tauri rodam exatamente o mesmo HTML/JS, sem framework. Máquina: i7-12700H,
Intel Iris Xe, KDE Plasma (Wayland), monitor de 240 Hz.

**Tauri e Flutter não passam de 60 fps no Linux**, mesmo em monitor de 240 Hz. Para
comparar o mesmo trabalho, a tabela limita todos a 60 fps. Cada célula: **fps · CPU ·
memória**; CPU de 100% é um núcleo inteiro, memória é a PSS somada de todos os processos.

| Cena | Electron | Tauri | Flutter | egui | nodebuilder |
|---|---|---|---|---|---|
| **Painel** ([dashboard.tsx](examples/dashboard.tsx)): visão geral | 59 · 58% · 337 MB | 60 · 66% · 267 MB | 59 · 45% · 126 MB | 59 · 27% · 105 MB | 59 · 33% · 91 MB |
| Painel: tabela com 500 linhas | 59 · 64% · 383 MB | 59 · 62% · 292 MB | 59 · 41% · 133 MB¹ | 54 · 72% · 112 MB | 49 · 54% · 161 MB |
| Painel: logs ao vivo | 59 · 94% · 408 MB | 59 · 142% · 298 MB | 59 · 47% · 135 MB¹ | 59 · 42% · 108 MB | 56 · 45% · 157 MB |
| Painel: configurações | 59 · 44% · 308 MB | 60 · 51% · 267 MB | 60 · 38% · 123 MB | 60 · 23% · 105 MB | 59 · 24% · 83 MB |
| Painel: troca de aba a cada 30 frames | 58 · 70% · 384 MB | 59 · 85% · 321 MB | 59 · 45% · 141 MB | 58 · 45% · 114 MB | 55 · 43% · 166 MB |
| **Grade** ([bench.tsx](examples/bench.tsx)): 1000 células paradas | 0% · 310 MB | 0% · 216 MB | 0% · 147 MB | 0% · 106 MB | 1% · 81 MB |
| Grade: 1000 células, um texto muda | 58 · 58% · 321 MB | 60 · 37% · 228 MB | 59 · 51% · 155 MB | 59 · 49% · 108 MB | 57 · 39% · 110 MB |
| Grade: 1000 células, todas mudam | 59 · 128% · 413 MB | 29 · 147% · 277 MB | 21 · 96% · 173 MB | 59 · 68% · 113 MB | 58 · 44% · 139 MB |
| Grade: 3000 células, todas mudam | 49 · 172% · 447 MB | 20 · 123% · 351 MB | 7 · 140% · 243 MB | 46 · 84% · 128 MB | 50 · 94% · 194 MB |

¹ O Flutter usa listas virtualizadas (`ListView.builder`), o padrão dele: só constrói as
linhas visíveis. Nas outras quatro, todas as linhas existem.

**Em resumo:**
- **Os dois runtimes web são os mais pesados:** 216 a 447 MB, e muito mais CPU quando muito
  texto muda. O Tauri usa de 13% a 33% menos memória que o Electron, mas não sustenta 60 fps
  nas cenas mais pesadas (29 e 20 fps).
- **O egui é o rival mais próximo** do nodebuilder: memória quase constante (105 a 128 MB,
  sem coletor de lixo) e a menor CPU nas abas leves do painel. Por ser immediate mode, ele
  refaz a interface inteira a cada frame, e isso pesa quando há muitos elementos: perde na
  tabela (72% contra 54%) e quando 1000 textos mudam (68% contra 44%).
- **O Flutter** gasta pouca memória e pouca CPU no painel, mas trava em 60 fps e cai para
  21 e 7 fps quando milhares de textos mudam a cada frame.
- **O nodebuilder** tem a menor memória parado (81 MB) e nas abas leves do painel, e a
  menor CPU quando 1000 textos mudam a cada frame (44%; com 3000, o egui gasta menos, mas a
  46 fps contra 50). Nesta rodada perdia fps na tabela de 500 linhas (49 contra 54 a 59)
  porque media e desenhava o que estava fora da tela; isso já foi resolvido (veja abaixo).
  Na tabela, nos logs e na troca de abas usa mais memória que egui e Flutter (157 a
  166 MB): é o heap do JavaScript.
- **Com teto de 120 fps**, só Electron, egui e nodebuilder passam de 60: o Electron fica
  entre 107 e 117 fps, o egui entre 102 e 119 e o nodebuilder entre 80 e 118 (com 3000
  células, todos em 45–51 fps).
- **Depois desta rodada**, o nodebuilder passou a ignorar o que está fora da área visível
  (culling). Medido antes e depois na mesma sessão: a tabela de 500 linhas foi de 78 para
  104 fps com teto de 120 (CPU de 82% para 51%) e, com teto de 60, de 55% para 40% de CPU;
  "um texto muda entre 1000" caiu de 39% para 23% de CPU. Com teto de 60 o fps ainda fica
  abaixo de 59 em todas as cenas, por causa do agendamento de frames ([roadmap](ROADMAP.md)).
- **Tamanho:** o Tauri tem 5,7 MB (usa o WebKit do sistema), o egui 15 MB, o Flutter 23 MB,
  o nodebuilder ~91 MB (~31 MB compactado, quase tudo é o runtime do Bun) e o Electron
  ~280 MB.

E a ergonomia conta: no egui você escreve Rust; no Flutter, Dart; no Electron e no Tauri,
HTML/CSS/JS (com Rust para a parte nativa do Tauri); no nodebuilder, TypeScript com JSX, que
é o que a maioria dos devs web (e dos LLMs) já escreve.

### Por que o Tauri fica tão perto do Electron?

O Tauri troca o navegador do Electron (Chromium) pelo do sistema (no Linux, o WebKitGTK),
mas continua sendo um navegador. O trabalho caro, que é rodar o JS, aplicar o CSS, fazer o
layout do DOM e desenhar, acontece num motor completo nos dois casos; o Rust do Tauri só abre
a janela. Medindo processo por processo na cena de logs:

| Processo | Tauri | Electron |
|---|---|---|
| Página (JS, DOM, CSS, layout, pintura) | 172 MB · 131% CPU | 163 MB · 82% CPU |
| Janela / processo principal | 87 MB | 86 MB |
| GPU, rede e utilitários | 33 MB (1 processo) | 115 MB (5 processos) |

- **Memória:** o processo da página custa quase o mesmo nos dois. O Tauri economiza só nos
  processos auxiliares, o que dá de 13% a 33% menos memória que o Electron nas cenas medidas.
- **CPU:** o WebKitGTK desenha a página na CPU (threads `SkiaCPUWorker`, ~45% de um núcleo),
  enquanto o Chromium desenha na GPU. Por isso o Tauri gasta mais justamente quando muito
  texto muda a cada frame.
- **O "Tauri é leve"** se refere principalmente ao tamanho do download: ele não leva um
  navegador junto.

O nodebuilder não tem motor de navegador: não há cascata de CSS nem DOM para recalcular, um
signal atualiza direto o nó que mudou, tudo é desenhado na GPU com um draw call por frame, e
é um processo só. Em troca, oferece menos recursos que a web (ver limitações abaixo).

Estes números valem para o Linux. No Windows o Tauri usa o WebView2 (Chromium) e no macOS o
WebKit do sistema; lá o resultado pode ser diferente.

Medido em 2026-10-11. Para reproduzir, veja [ARCHITECTURE.md](ARCHITECTURE.md#medindo-desempenho).

## Limitações atuais

- Só Linux x64 (arm64, Windows e macOS estão no roadmap).
- Texto com uma fonte só (emojis não aparecem); palavra maior que a linha transborda.
- Campo de texto sem seleção, cópia e desfazer (colar funciona).
- SVG só no subconjunto para ícones (sem gradientes, texto, filtros); AVIF/HEIC dependem da
  `libheif` do sistema.
- `ProgressBar` indeterminada e `Spinner` pedem um frame atrás do outro enquanto aparecem
  (CPU baixa, mas não zero); esconda-os quando a espera acabar.
- Sem API de animações (dá para animar `opacity`/`translate` com `requestAnimationFrame`),
  sem `scale`/`rotate`, tema escuro, acessibilidade e IME (teclados de idiomas asiáticos).
- `opacity` é aplicada a cada coisa desenhada, não ao grupo: filhos que se sobrepõem
  aparecem um através do outro.
- Rolagem sem inércia nem animação (a roda e as teclas pulam direto), sem rolagem
  automática ao arrastar uma seleção até a borda e sem repetição ao segurar o clique na
  trilha da barra.

## Contribuir

```sh
git clone https://github.com/felipebrgs1/nodebuilderjs && cd nodebuilderjs
bun install
bun run build:native     # compila o núcleo em C (precisa dos headers de Wayland, X11, EGL...)
bun run counter          # roda um exemplo
bun test && bun run typecheck
```

O desenvolvimento segue TDD: comportamento novo ou bug começa por um teste que falha
(`bun test` roda sem janela, em ~0,1 s). [ARCHITECTURE.md](ARCHITECTURE.md) explica como o
framework é organizado por dentro, e o [AGENTS.md](AGENTS.md) traz as regras, as convenções
e como testar cada camada.

## Licença

[MIT](LICENSE)
