# Arquitetura

Como o nodebuilder funciona por dentro. Para usar o framework, o [README](README.md) basta;
para as regras e convenções de quem mexe no código, veja o [AGENTS.md](AGENTS.md).

## Visão geral

```
 seu app (.tsx)
     │  componentes, signals
┌────▼──────────────────────────────── TypeScript (src/) ──────────────────────┐
│ reactive.ts   signals, effects, memos, ownership                             │
│ jsx-runtime   JSX -> descrições preguiçosas; control.ts: <For>, <Show>       │
│ widgets.ts    Window, Column, Text, Button... criam UINodes                  │
│ node.ts       árvore retida (UINode) + estilo; mudanças chamam invalidate()  │
│ layout.ts     flexbox simplificado                                           │
│ paint.ts      árvore -> command buffer (Float32Array + textos)               │
│ app.ts        loop de frames, eventos, foco, hover, NB_STATS                 │
└────┬─────────────────────────────────────────────────────────────────────────┘
     │  N-API: render(commands, texts), measureText, eventos
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
└──────────────────────────────────────────────────────────────────────────────┘
```

A ideia é manter o máximo em TypeScript (fácil de ler, mudar e, de propósito, fácil para
LLMs escreverem) e deixar o C pequeno e estável: ele só sabe abrir uma janela, entregar
eventos, medir texto e desenhar uma lista de retângulos, textos e recortes.

## Reatividade

O modelo é o do SolidJS, implementado do zero em `src/reactive.ts`:

- `createSignal` guarda um valor e sabe quem o leu. Ao mudar, reexecuta só esses leitores.
- `createEffect` e `createMemo` registram as leituras feitas durante a execução.
- **Ownership:** tudo que é criado dentro de um effect ou `createRoot` é descartado junto
  com ele (`onCleanup`). É assim que trocar de aba, por exemplo, libera tudo da aba antiga.

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
       layout()        posições e tamanhos de toda a árvore
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

`src/layout.ts` é um flexbox simplificado: `direction`, `gap`, `padding`, `grow`, `align`
(padrão `stretch`), `justify`, `min/max`, e `position: "absolute"` com `left/top`.

O encolhimento segue o `min-size: auto` do CSS: um filho não fica menor que o próprio
conteúdo, a menos que seja rolável, recorte o conteúdo (`clip`) ou tenha `minWidth`/
`minHeight` explícito. `Scroll` é uma coluna rolável com `minHeight: 0`.

Hoje o layout é recalculado inteiro a cada frame (ver [roadmap](ROADMAP.md)).

## Command buffer

A pintura não chama o C nó a nó: `paint.ts` escreve tudo num único `Float32Array`, que
cruza a fronteira N-API uma vez por frame, junto com um array de textos.

| Op | Código | Floats seguintes |
|---|---|---|
| RECT | 1 | x y w h · r g b a · radius borderWidth · br bg bb ba |
| TEXT | 2 | x y(topo da linha) size font(0/1 bold) · r g b a · índice em `texts[]` |
| CLIP | 3 | x y w h radius (scissor + máscara arredondada mais interna) |
| UNCLIP | 4 | (nenhum) |
| SHADOW | 5 | x y w h · r g b a · radius blur |

O formato existe em três lugares que precisam ficar em sincronia: `native/include/nb.h`,
`src/paint.ts` e `native/core/render_gles2.c`.

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

Coordenadas: o TypeScript trabalha em pixels lógicos; o C multiplica pela escala inteira da
tela (Wayland: `preferred_buffer_scale`; X11: `Xft.dpi / 96`).

## Eventos e threads

O Bun não implementa a libuv, então o addon não pode usá-la. Em vez disso:

1. Uma thread do backend só espera: no Linux, um `poll()` no socket do display, no timer de
   repetição de teclas e num eventfd de saída.
2. Quando há algo, ela chama `wake()`, e o núcleo acorda o JS por uma
   `napi_threadsafe_function`.
3. Já na thread do JS, `nb_platform_pump_process()` lê e despacha tudo (no Wayland,
   sem bloquear), e os eventos chegam ao `app.ts` em lote.

Toda leitura, todo dispatch e toda chamada GL acontecem na thread do JS. A thread extra
nunca toca em estado compartilhado além de acordar o JS.

## Wayland e X11

O backend é escolhido em tempo de execução: Wayland se houver `WAYLAND_DISPLAY`, senão X11
se houver `DISPLAY` (`NB_BACKEND=wayland|x11` força). Os dois implementam o mesmo vtable
(`native/platform/linux/linux.h`), então qualquer recurso novo de janela entra nos dois.

A janela sempre desenha a própria decoração (barra de título, botões, bordas de
redimensionar). No X11, a decoração do gerenciador de janelas é desligada e mover/maximizar
usam as mensagens EWMH; sem compositor, a janela perde a transparência e os cantos
arredondados.

## Portabilidade para outros sistemas

Tudo que é específico do SO fica atrás de `native/include/nb_platform.h`: abrir janela,
bombear eventos, cursor, descoberta de fontes. O núcleo (`native/core/`) só inclui Node-API,
GLES2, FreeType, HarfBuzz e a libc. Um novo SO é uma pasta `native/platform/<os>/` com a
implementação desse contrato e um `build.sh`. No Windows e no macOS o caminho previsto é o
ANGLE (GLES sobre Direct3D/Metal) ou um novo `render_<api>.c` com a mesma interface.

## Carregando o núcleo nativo

`src/native.ts` procura o addon nesta ordem:

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

`NB_STATS=1` imprime por segundo: fps, tempo por frame (estado + layout, pintura, nativo),
número de nós, tamanho do command buffer, heap e RSS.

A comparação com o Electron usa a mesma cena em DOM puro (`compare/electron/`) e mede a
árvore de processos inteira:

```sh
scripts/compare.sh "nodebuilder" 3 5 -- bun examples/dashboard.tsx
SCENE=dashboard scripts/compare.sh "electron" 3 5 -- \
  compare/electron/node_modules/.bin/electron --ozone-platform=wayland compare/electron
```

Quebra da memória do nodebuilder: Bun vazio ~15 MB, texto (FreeType/HarfBuzz) ~26 MB, janela
GL ~108 MB (quase tudo é driver de vídeo), framework ~15 MB.
