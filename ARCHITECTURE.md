# Arquitetura

Como o nodebuilder funciona por dentro. Para usar o framework, o [README](README.md) basta;
para as regras e convenções de quem mexe no código, veja o [AGENTS.md](AGENTS.md).

## Visão geral

```
 seu app (.tsx)
     │  componentes, signals
┌────▼──────────────────────────────── TypeScript (src/) ──────────────────────┐
│ reactive/     signals, effects, memos, ownership; <For>, <Show>              │
│ jsx-runtime   JSX -> descrições preguiçosas                                  │
│ widgets/      Window, Column, Text, Image, Icon, Button... criam UINodes     │
│ image/        fontes de imagem; decodificadores PNG, JPEG, WebP              │
│ svg/          SVG para ícones, sobre geometry/ (caminhos, contornos, raster) │
│ render/       node: árvore retida · layout: flexbox · paint: command buffer  │
│ runtime/      loop de frames, eventos, foco, hover, NB_STATS; addon nativo   │
└────┬─────────────────────────────────────────────────────────────────────────┘
     │  N-API: render(commands, texts), measureText, createImage, decodeImage, eventos
┌────▼──────────────────────────── núcleo portável (native/core/) ─────────────┐
│ addon.c         superfície N-API, fila de eventos, threadsafe function       │
│ render_gles2.c  um shader, um formato de vértice, um batch por frame         │
│ text.c          HarfBuzz (shaping) + FreeType (glifos) + atlas de textura    │
└────┬─────────────────────────────────────────────────────────────────────────┘
     │  contrato nb_platform.h (janela, eventos, fontes)
┌────▼──────────────────────── backend do SO (native/platform/linux/) ─────────┐
│ linux.c      escolhe Wayland ou X11 em tempo de execução                     │
│ wayland.c    xdg-shell, EGL, ponteiro, teclado (xkb + compose), cursor       │
│ x11.c        Xlib + EWMH, EGL, XIM, Xcursor, XRandR                          │
│ pump.c       thread de poll() que avisa quando há eventos                    │
│ fonts.c      fontconfig                                                      │
│ codecs.c     AVIF/HEIC via libheif (dlopen, opcional)                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

A ideia é manter o máximo em TypeScript (fácil de ler, mudar e, de propósito, fácil para
LLMs escreverem) e deixar o C pequeno e estável: ele só sabe abrir uma janela, entregar
eventos, medir texto e desenhar uma lista de retângulos, textos, imagens e recortes.

## Reatividade

O modelo é o do SolidJS, implementado do zero em `src/reactive/signals.ts`:

- `createSignal` guarda um valor e sabe quem o leu. Ao mudar, reexecuta só esses leitores.
- `createEffect` e `createMemo` registram as leituras feitas durante a execução.
- **Ownership:** tudo que é criado dentro de um effect ou `createRoot` é descartado junto
  com ele (`onCleanup`). É assim que trocar de aba, por exemplo, libera tudo da aba antiga.
- **Contexto** (`reactive/context.ts`) também mora na árvore de donos: o `Provider` cria um
  escopo com o valor e resolve os filhos dentro dele (o `jsx()` é preguiçoso; resolvidos em
  outro lugar, os componentes rodariam fora do escopo). `useContext` sobe pelos donos. Um
  `createRoot` não é descartado pelo dono em volta, mas guarda a referência a ele só para essa
  busca: assim as linhas do `<For>`, que são raízes, enxergam o contexto de fora.

Não há compilador de JSX próprio: o TypeScript/Bun transforma o JSX em chamadas `jsx()`, que
só criam **descrições** (`ElementDesc`). O componente executa quando a descrição é inserida
na árvore. Isso permite que `<Show>` e `<For>` decidam quando (e se) instanciar os filhos.

Como não há compilador, a regra é explícita: **só funções são reativas**. Uma prop
`text={() => ...}` ou um filho `{count}` vira um effect que atualiza o nó diretamente; um
valor comum é lido uma vez. Componentes rodam uma única vez; não existe re-render.

Filhos ficam em **slots** (`UINode.addSlot/setSlot`). Cada filho-função é um slot com seu
próprio effect: quando reexecuta, substitui só os nós daquele trecho. `<For>` é keyed por
referência e cria um `createRoot` por item, descartado quando o item sai da lista.

## Um frame

```
signal muda
  -> effect atualiza UINode.set(...) / setSlot(...)
  -> invalidate() -> schedule()
       respeita o frame pendente do compositor e o teto de fps (120 por padrão)
  -> renderFrame()
       callbacks de requestAnimationFrame
       layout()        posições e tamanhos da parte visível da árvore
       refreshHover()  o nó sob o ponteiro pode ter mudado
       paintTree()     árvore -> command buffer
       native.render() C desenha e faz eglSwapBuffers
  -> o compositor avisa (frame callback) que pode mandar o próximo
```

No Wayland o ritmo vem do frame callback do compositor (alinhado ao vsync). Para respeitar
o teto de fps em monitores rápidos, frames são pulados com `native.requestFrame()`, que faz
commit sem desenhar. No X11 não existe frame callback: o ritmo vem de um timer na taxa do
monitor (XRandR).

## Layout

`src/render/layout.ts` é um flexbox simplificado: `direction`, `gap`, `padding`, `grow`, `align`
(padrão `stretch`), `justify`, `min/max`, e `position: "absolute"` com `left/top`.

O encolhimento segue o `min-size: auto` do CSS: um filho não fica menor que o próprio
conteúdo, a menos que seja rolável, recorte o conteúdo (`clip`) ou tenha `minWidth`/
`minHeight` explícito. Para texto que quebra, "o próprio conteúdo" na largura é a palavra
mais longa (com `maxLines`, o "…"). Numa linha sem espaço, os filhos com `grow` encolhem
primeiro e só depois os outros, proporcionalmente; é diferente do CSS, que encolhe todos
juntos e faz um rótulo curto ao lado de um texto longo quebrar. `Scroll` é uma coluna rolável
com `minHeight: 0`.

**Altura que depende da largura.** Texto que quebra muda de altura conforme a largura, então
o tamanho vem em dois passos. `intrinsic(node)` dá o tamanho natural (texto no menor número de
linhas) e marca `wraps` quando há texto que quebra na subárvore. `heightAt(node, width)` dá
a altura com aquela largura: numa coluna, a largura de cada filho é conhecida antes (`align`)
e a altura vem dela; numa linha, as larguras vêm do flex (`mainSizes`) e as alturas delas.
Para não pagar isso em toda a árvore, `heightAt` devolve a altura natural quando não há nada
que quebre ou quando a largura dada cobre a natural (com mais espaço, nada quebra). Um
`Text` só se declara "quebrável" (`minContentWidth`) se tiver espaço ou `maxLines`. A largura
mínima (`minWidth`) é calculada só quando uma linha precisa encolher. Medido em 2026-10-12
na mesma sessão: layout do `bench` (1000 textos mudando) 2,5 → 2,7 ms e da tabela de 500
linhas 2,5 → 2,7 ms por frame; a primeira versão, sem esses atalhos, custava 7,9 e 4,4 ms.

A quebra em si fica em `render/text-wrap.ts`: gulosa, nos espaços, como o `overflow-wrap:
normal` do CSS (palavra maior que a linha transborda). As larguras das palavras são somadas
em vez de medir a linha inteira de novo; a linha que cabe inteira é medida uma vez só.

**Culling:** cada nó que recorta (`Scroll`, `clip`, a `Window`) estreita a região visível
passada aos filhos. Um filho totalmente fora dela (contando a sombra) recebe a própria caixa,
para a altura do conteúdo e as barras de rolagem continuarem certas, mas é marcado `culled`:
seus descendentes não são posicionados, pintados nem testados no clique. Numa tabela de 500
linhas, só as ~15 visíveis chegam à pintura e ao HarfBuzz. Limitação: um descendente que
transborda a caixa de um nó descartado (ex.: um popup absoluto) some junto com ele.

O tamanho natural de todos os filhos ainda é calculado a cada frame, porque a altura do
conteúdo depende deles; cada `Text` guarda a última medida (texto, tamanho, negrito) para
isso não custar uma ida ao cache global. O layout incremental está no
[roadmap](ROADMAP.md).

### Overlays

`<Overlay>` deixa um marcador de tamanho zero (`position: "absolute"`) onde foi declarado e
cria a camada à parte: `layer.parent` é o marcador, mas a camada não é filha dele. Assim ela
herda contexto, ownership e estilo de texto daquele ponto, e os eventos sobem pelos
ancestrais do marcador (como o portal do React). As camadas vivas ficam num conjunto global
(`overlayLayers`, em ordem de criação); a cada `layout()`, a raiz pega as suas
(`root.layers`) e as posiciona depois da árvore, quando as âncoras já têm caixa. Uma camada
ancorada some se a âncora saiu da árvore ou está numa subárvore `culled` (a caixa estaria
velha). A pintura desenha as camadas depois da árvore, recortadas pelo primeiro filho da
raiz se ele recorta (os cantos da `Window`). O hit test começa pelas camadas, de cima para
baixo; uma camada que cobre a janela só é alvo se for `modal`. O registro acontece antes de
os filhos rodarem, então um overlay aberto de dentro de outro fica por cima dele.

`translateX`/`translateY` são somados à posição do nó em `place()`, depois do flex: os filhos
são posicionados a partir dela, e hit test, culling e `ref` enxergam a posição deslocada sem
nada especial. `opacity` é um multiplicador no `CommandBuffer` (`opacity`), acumulado por
`paintTree` na descida e aplicado ao alfa de toda cor emitida. É barato e não precisa do C,
mas não é opacidade de grupo: isso exigiria desenhar a subárvore numa textura à parte.

## Command buffer

A pintura não chama o C nó a nó: `render/paint.ts` escreve tudo num único `Float32Array`, que
cruza a fronteira N-API uma vez por frame, junto com um array de textos.

| Op | Código | Floats seguintes |
|---|---|---|
| RECT | 1 | x y w h · r g b a · radius borderWidth · br bg bb ba |
| TEXT | 2 | x y(topo da linha) size font(0/1 bold) · r g b a · índice em `texts[]` |
| CLIP | 3 | x y w h radius (scissor + máscara arredondada mais interna) |
| UNCLIP | 4 | (nenhum) |
| SHADOW | 5 | x y w h · r g b a · radius blur |
| IMAGE | 6 | x y w h · u0 v0 u1 v1 · r g b a (tinta; a = opacidade) · radius · id da imagem |
| LINE | 7 | x0 y0 x1 y1 · largura · r g b a · ponta inicial, ponta final (0 reta, 1 redonda) |
| TRIANGLES | 8 | n · r g b a · n × (x y cobertura) |
| ARC | 9 | cx cy · raio externo, raio interno · início, varredura (radianos; 0 = cima, horário) · r g b a |

O formato existe em três lugares que precisam ficar em sincronia: `native/include/nb.h`,
`src/render/paint.ts` e `native/core/render_gles2.c`.

## Renderização

`render_gles2.c` usa um único shader e um único formato de vértice. Retângulos com borda e
cantos arredondados, sombras e glifos viram triângulos de um batch só. Cantos e sombras são
calculados no fragment shader com funções de distância.

As cores são compostas em **alpha pré-multiplicado** (`GL_ONE, GL_ONE_MINUS_SRC_ALPHA`), e a
borda é desenhada sobre o fundo, como no CSS. Misturar em alpha "reto" gera artefatos escuros
nos cantos.

Texto: o HarfBuzz faz o shaping (acentos, ligaduras, kerning), o FreeType rasteriza cada
glifo uma vez e o guarda num atlas de textura. As medidas que o layout pede ao C ficam em
cache no lado TypeScript.

Imagens: PNG, JPEG e WebP são decodificados em TypeScript para RGBA (`src/image/png.ts`
com o zlib do runtime, `jpeg.ts`, `webp.ts`). Os três reproduzem exatamente a saída das
bibliotecas de referência: o JPEG usa a IDCT inteira, o upsampling "fancy" e as tabelas de
cor do libjpeg-turbo; o WebP, o upsampling e as fórmulas de ponto fixo do libwebp. AVIF e
HEIC precisariam de um decodificador de AV1/HEVC, então vão para o SO:
`nb_platform_decode_image` (contrato da plataforma) usa, no Linux, a `libheif` carregada
com `dlopen`. A API dela só tem handles e funções, então as poucas declarações em
`codecs.c` valem para qualquer versão com o soname `libheif.so.1`, e não é preciso o header
para compilar. `createImage` copia os pixels para o C, que os pré-multiplica e cria a textura no
primeiro frame que a desenha (pode não haver contexto GL antes disso). Cada troca de imagem
dentro de um frame fecha o batch, então muitas imagens diferentes custam uma chamada de
desenho cada. `src/image/source.ts` divide uma decodificação entre todos os `<Image>` do mesmo
arquivo (por caminho) e libera a textura quando o último sai da árvore. Uma imagem que não
carrega mostra um aviso no console e não desenha nada.

Ícones (`src/svg/`, sobre `src/geometry/`): o SVG vira polígonos no espaço do usuário. Curvas e arcos são
achatados com erro de 0,1 pixel da tela, e cada contorno vira um polígono por segmento,
junção e ponta, todos no mesmo sentido, para que um preenchimento "nonzero" faça a união
sem desenhar duas vezes onde se sobrepõem. Um rasterizador de linhas de varredura calcula a
cobertura exata na horizontal, com 16 amostras por pixel na vertical. O `<Icon>` rasteriza
no tamanho físico (tamanho lógico × escala), alinhado aos pixels. Se todas as cores do SVG
são `currentColor`, ele rasteriza em branco uma vez, e a cor entra como tinta no comando
IMAGE: o shader multiplica os texels por ela, e trocar a cor não refaz o ícone.

Primitivas de desenho (`<Canvas>`): cada segmento de linha é um retângulo orientado ao
longo do segmento; o shader recebe a posição nesse referencial e calcula a distância ao
segmento (pontas redondas ou retas), de onde sai o antialiasing. Arcos fazem o mesmo com a
distância a um setor de anel. Polígonos são triangulados em TypeScript
(`src/geometry/triangulate.ts`, ear clipping) e ganham uma franja de 1 pixel da tela cuja
cobertura vai de 1 a 0 (técnica do NanoVG); o GPU interpola a cobertura e o resultado é uma
borda suave. Tudo isso entra no mesmo lote dos retângulos e textos. O `<Canvas>` grava as
chamadas de `draw` quando um signal lido muda (ou o tamanho e a escala mudam), já
convertidas em segmentos e triângulos; pintar só desloca essa gravação.

Gráficos (`src/charts`, importados de `@nodebuilderjs/core/charts`): `<LineChart>` e os
outros são um `<Canvas>`. Os filhos (`<Line>`, `<XAxis>`...) não renderizam nada: como o
`jsx()` só cria descrições (`ElementDesc`), o gráfico lê o tipo e as props de cada filho
para saber o que desenhar, sem instanciá-los. Os passos dos eixos seguem o algoritmo do d3
(1, 2 ou 5 vezes uma potência de 10). Ficam num subcaminho para que nomes como `Tooltip` e
`Line` não colidam com widgets de interface; quem não importa não leva nada no bundle, e
quem usa paga ~15 KB.

Coordenadas: o TypeScript trabalha em pixels lógicos; o C multiplica pela escala inteira da
tela (Wayland: `preferred_buffer_scale`; X11: `Xft.dpi / 96`).

## Eventos e threads

O Bun não implementa a libuv, então o addon não pode usá-la. Em vez disso:

1. Uma thread do backend só espera: no Linux, um `poll()` no socket do display, no timer de
   repetição de teclas, nos pipes da área de transferência e num eventfd de controle. A
   lista de fds é entregue pela thread do JS a cada volta (`backend->fds()`); quando muda
   fora dela (uma colagem começou), `nb_linux_pump_refresh()` acorda o `poll()` pelo
   eventfd para pegar a lista nova.
2. Quando há algo, ela chama `wake()`, e o núcleo acorda o JS por uma
   `napi_threadsafe_function`.
3. Já na thread do JS, `nb_platform_pump_process()` lê e despacha tudo (no Wayland,
   sem bloquear), e os eventos chegam ao `runtime/app.ts` em lote.

Toda leitura, todo dispatch e toda chamada GL acontecem na thread do JS. A thread extra
nunca toca em estado compartilhado além de acordar o JS.

No TypeScript, `runtime/input.ts` transforma os eventos crus em eventos de interface: hit
test (ignorando nós `culled`), hover com entrada e saída, cursor, bordas de
redimensionar, foco, clique e duplo clique, captura do ponteiro enquanto um botão está
pressionado, rolagem e teclado com Tab. O que é janela (mover, redimensionar, cursor,
relógio) passa por uma interface `InputHost`; o `run()` liga isso ao addon, e os testes (e o
`interact()` de `@nodebuilderjs/core/testing`) usam um host sem janela.

O `createInput` registra o foco na raiz (`root.focusHost`); é por ali que o `focus()` e o
`blur()` de um `ref` chegam ao input. Um `focus()` feito enquanto o widget é criado (ainda
fora da árvore) é repetido num microtask, quando a árvore já está montada. O `onResize` é
coletado durante o `layout()` e entregue em lote depois que a árvore inteira foi posicionada,
para que o handler possa mudar estado (e a árvore) sem atrapalhar o layout em andamento; a
mudança entra no frame seguinte.

## Wayland e X11

O backend é escolhido em tempo de execução: Wayland se houver `WAYLAND_DISPLAY`, senão X11
se houver `DISPLAY` (`NB_BACKEND=wayland|x11` força). Os dois implementam o mesmo vtable
(`native/platform/linux/linux.h`), então qualquer recurso novo de janela entra nos dois.

A janela sempre desenha a própria decoração (barra de título, botões, bordas de
redimensionar). No X11, a decoração do gerenciador de janelas é desligada e mover/maximizar
usam as mensagens EWMH; sem compositor, a janela perde a transparência e os cantos
arredondados.

### Área de transferência

Só texto, pelo contrato `nb_platform_clipboard_write/read`. Ler é assíncrono em todo SO (quem
tem o conteúdo é outro programa): `readClipboard()` pede, e a resposta chega como um evento
`clipboard`, que `runtime/clipboard.ts` entrega a todas as leituras pendentes. Quando o
conteúdo é nosso, a resposta sai na hora, sem passar pelo servidor.

- **Wayland:** copiar cria um `wl_data_source` (`text/plain;charset=utf-8`, `UTF8_STRING`...)
  e chama `set_selection` com o serial da última tecla ou clique; cada colagem em outro app
  manda um pipe, que escrevemos sem bloquear (POLLOUT na thread de bombeamento). Colar pede
  ao dono da seleção que escreva num pipe nosso, lido aos pedaços até o EOF (até 64 MB). O
  compositor só informa a seleção enquanto temos o foco do teclado. Escrever num pipe
  fechado gera SIGPIPE: se ninguém o trata, o backend passa a ignorá-lo (o Node já faz isso).
- **X11:** seleção `CLIPBOARD`. Copiar é virar dono e responder `SelectionRequest` (`TARGETS`,
  `UTF8_STRING`, `TEXT`, `STRING`), com um handler de erro temporário porque o outro programa
  pode sumir no meio (o handler padrão do Xlib encerra o processo). Colar é
  `XConvertSelection` + `SelectionNotify`, com o protocolo INCR para textos grandes (pedaços
  via `PropertyNotify`). Enviar com INCR não existe: textos acima do tamanho máximo de
  requisição (~16 MB com BIG-REQUESTS) são recusados.

## Portabilidade para outros sistemas

Tudo que é específico do SO fica atrás de `native/include/nb_platform.h`: abrir janela,
bombear eventos, cursor, descoberta de fontes. O núcleo (`native/core/`) só inclui Node-API,
GLES2, FreeType, HarfBuzz e a libc. Um novo SO é uma pasta `native/platform/<os>/` com a
implementação desse contrato e um `build.sh`. No Windows e no macOS o caminho previsto é o
ANGLE (GLES sobre Direct3D/Metal) ou um novo `render_<api>.c` com a mesma interface.

## Carregando o núcleo nativo

`src/runtime/native.ts` procura o addon nesta ordem:

1. `native/build/<plataforma>-<arch>/nodebuilder.node`, que só existe num checkout do
   framework depois de `bun run build:native`;
2. o pacote npm `@nodebuilderjs/<plataforma>-<arch>`, instalado como dependência opcional
   de `@nodebuilderjs/core` (só o da sua plataforma é baixado).

"Não encontrado" passa para o próximo; um addon encontrado que falha ao carregar (biblioteca
do sistema faltando, glibc antiga) é o erro mostrado. Cada caminho é um `require("...")`
literal, porque é isso que o `bun build --compile` reconhece e embute no executável.

## Distribuição

### Pacotes npm

| Pacote | Conteúdo |
|---|---|
| `@nodebuilderjs/core` | `src/` (o Bun lê TypeScript direto), `lib/` (JS e tipos para o Node), `cli/` (comando `nodebuilder`) |
| `@nodebuilderjs/linux-x64` | só o `nodebuilder.node`, compilado contra glibc 2.34 |
| `create-nodebuilderjs` | o `bun create nodebuilderjs` e o template de projeto |

Os binários seguem o padrão do esbuild (um pacote por plataforma, com `os`/`cpu`), sem
script de instalação, que o Bun bloqueia por padrão. `bun run npm:build` gera tudo em
`dist/npm/`.

### Apps empacotados

`nodebuilder package` (em `cli/`):

1. pega o addon pré-compilado (ou, no repositório, compila um portável num container
   Ubuntu 22.04, para rodar em glibc 2.34+);
2. gera um **executável único** com `bun build --compile`: runtime do Bun, código do app e
   addon embutidos (~91 MB, ~31 MB compactado);
3. monta a árvore de instalação (`/usr/bin`, `.desktop`, ícone);
4. escreve o `.deb` e o `.rpm` diretamente em TypeScript (sem `dpkg` nem `rpmbuild`), e o
   AppImage com o `appimagetool`.

As bibliotecas do sistema (Wayland, X11, EGL, FreeType...) são declaradas como dependências
dos pacotes e nunca embutidas: todo desktop Linux já as tem.

## Medindo desempenho

```sh
NB_STATS=1 bun examples/bench.tsx        # N=1000 MODE=one|all|static
NB_STATS=1 bun examples/dashboard.tsx    # TAB=overview|table|logs|settings ROWS=500 CYCLE=30
```

`NB_STATS=1` imprime por segundo: fps, tempo por frame (estado, layout, pintura, nativo),
número de nós, tamanho do command buffer, heap e RSS.

As comparações usam a mesma cena feita em HTML e JavaScript puros, rodando no Electron
(`compare/electron/`) e numa casca Tauri 2 (`compare/tauri/`, que carrega os mesmos
arquivos). `scripts/compare.sh` mede a árvore de processos inteira (o Electron abre 8
processos e o Tauri 3):

```sh
scripts/compare.sh "nodebuilder" 3 5 -- bun examples/dashboard.tsx
SCENE=dashboard scripts/compare.sh "electron" 3 5 -- \
  compare/electron/node_modules/.bin/electron --ozone-platform=wayland compare/electron
(cd compare/tauri && cargo build --release)
SCENE=dashboard scripts/compare.sh "tauri" 3 5 -- compare/tauri/target/release/nodebuilder-tauri-baseline
```

Flutter (`compare/flutter/`) e egui (`compare/egui/`) têm ports das duas cenas, com os
mesmos dados e as mesmas atualizações por frame:

```sh
(cd compare/flutter && /opt/flutter/bin/flutter build linux --release)
scripts/compare.sh "flutter" 3 5 -- compare/flutter/build/linux/x64/release/bundle/nodebuilder_flutter_baseline
(cd compare/egui && cargo build --release)
scripts/compare.sh "egui" 3 5 -- compare/egui/target/release/nodebuilder-egui-baseline
```

No Linux, Tauri e Flutter não passam de 60 fps; para comparar o mesmo trabalho, rode os
outros com `NB_MAX_FPS=60`. A tabela com teto 60 está no [README](README.md#benchmarks).
Com teto 120, só Electron, egui e nodebuilder passam de 60 (2026-10-11, mesma sessão do
README, antes do culling; fps · CPU · PSS em MB):

| Cena (teto 120) | Electron | egui | nodebuilder |
|---|---|---|---|
| Painel: visão geral | 117 · 84% · 365 | 119 · 21% · 105 | 111 · 39% · 90 |
| Painel: tabela | 116 · 80% · 382 | 102 · 71% · 113 | 80 · 83% · 152 |
| Painel: logs | 107 · 155% · 446 | 117 · 42% · 108 | 118 · 71% · 172 |
| Painel: configurações | 116 · 67% · 311 | 118 · 23% · 105 | 104 · 22% · 89 |
| Painel: `CYCLE=30` | 111 · 99% · 413 | 112 · 38% · 114 | 100 · 62% · 152 |
| 1000 células, 1 texto muda | 117 · 71% · 312 | 117 · 47% · 107 | 103 · 44% · 109 |
| 1000 células, todas mudam | 112 · 237% · 414 | 116 · 72% · 113 | 117 · 69% · 147 |
| 3000 células, todas mudam | 50 · 173% · 427 | 45 · 81% · 128 | 51 · 96% · 190 |

Depois do culling, na mesma sessão: tabela de 78 para 104 fps (CPU 82% → 51%).

Cuidados ao medir:
- O Tauri levou mais de 3 s para ficar ocioso depois de abrir: use aquecimento ≥ 8 s em
  cenas estáticas.
- Por que o Tauri fica perto do Electron: o processo da página (WebKitWebProcess) custa quase
  o mesmo que o renderer do Chromium, e o WebKitGTK rasteriza na CPU (threads
  `SkiaCPUWorker`). `WEBKIT_SKIA_ENABLE_CPU_RENDERING=0` e `WEBKIT_SKIA_CPU_PAINTING_THREADS=0`
  não mudaram isso no WebKitGTK 2.54.1.
- Ainda sem explicação: com teto 60, o nodebuilder fica em 51–58 fps até em cenas leves (o
  agendamento perde vblanks; item 4 do roadmap), e com teto 120 o fps oscila entre rodadas.

Quebra da memória do nodebuilder: Bun vazio ~15 MB, texto (FreeType/HarfBuzz) ~26 MB, janela
GL ~108 MB (quase tudo é driver de vídeo), framework ~15 MB.
