# AGENTS.md — nodebuilder

Guia para agentes (e humanos) trabalhando neste repositório. Leia antes de mudar código.

## O que é

Framework de UI **nativa para Linux** em TypeScript: componentes TSX com reatividade
estilo **SolidJS**, renderizados por um **núcleo nativo próprio** (Wayland/X11 + GLES2 +
FreeType/HarfBuzz, em C via N-API). Sem DOM, sem Electron, sem GTK/Qt.

Motivação: um "Flutter para o ecossistema JS". TypeScript porque LLMs escrevem TS/JSX
muito bem, então o máximo possível do framework fica em TS, e o C fica pequeno e estável.

| Documento | Para quem |
|---|---|
| `README.md` | quem usa o framework (também é o README do pacote no npm) e os benchmarks |
| `ARCHITECTURE.md` | como funciona por dentro e como medir desempenho |
| `ROADMAP.md` | prioridades e o que já foi feito |
| `packages/create-nodebuilderjs/template/` | `AGENTS.md` e skills (`.agents/skills/`) que vão para os apps criados |

## Regras inegociáveis

1. **Zero dependências de terceiros em runtime.** Só o próprio código + bibliotecas do
   sistema (libwayland, X11, EGL/GLES, xkbcommon, FreeType, HarfBuzz, fontconfig; a libheif
   é opcional, via `dlopen`). Dependências de desenvolvimento são aceitáveis (hoje:
   `typescript`, `@types/bun`, `node-api-headers`). React, Solid, Yoga, Skia etc. servem só
   de referência.
2. **Bun é o runtime e o gerenciador de pacotes.** Use `bun`, `bun add`, `bun test`; nunca
   npm/yarn/pnpm, `node:test` ou build com `tsc`. O código precisa **continuar rodando no
   Node** (o addon é agnóstico): a publicação gera `lib/` (JS via `Bun.Transpiler`, `.d.ts`
   via tsc) só para o Node; o Bun sempre lê `src/`.
3. **Nunca usar libuv (`uv_*`) no addon.** O Bun não implementa libuv e aborta com
   `unsupported_uv_function`. Trabalho assíncrono nativo (fds, timers) entra no `poll()` da
   thread de bombeamento (veja "Modelo de threads" em C).
4. **Linux primeiro, arquitetura pronta para outros SOs.** Núcleo portável
   (`native/core/`) e backend por SO (`native/platform/<os>/`), ligados só pelo contrato
   `native/include/nb_platform.h`. No Linux, **Wayland e X11**, escolhidos em runtime.
5. **TypeScript 7** (compilador nativo em Go) só para checagem: `bun run typecheck`.
6. **Teto de 120 fps** por padrão. Acima disso é desnecessário (decisão do projeto).
7. **TDD:** comportamento novo e correção de bug começam por um teste que falha (veja
   "Fluxo de trabalho").

## Comandos

```sh
bun install                 # deps de desenvolvimento
bun run build:native        # compila native/build/<platform>-<arch>/nodebuilder.node
bun run typecheck           # tsc 7 --noEmit (~0,1 s)
bun test                    # todos os testes, sem janela (~0,1 s)
bun test test/svg.test.tsx  # um arquivo; -t "padrão" filtra pelo nome do teste
bun run counter | todo | images | icons | drawing | charts   # exemplos (Bun executa .tsx direto)
bun run dev                 # todo com --watch
bun run bench               # stress test com NB_STATS=1 (env: N=1000 MODE=one|all|static)
bun run bench:dashboard     # app realista (env: TAB=overview|table|logs|settings ROWS=500
                            #   LIVE=0 CYCLE=<frames por troca de aba>)
bun run package <app.tsx> --name x --title X [--targets appimage,deb,rpm,tar]
bun run npm:build           # pacotes npm em dist/npm/ (não publica)
scripts/compare.sh <rótulo> <aquecimento-s> <amostra-s> -- <comando...>  # CPU/RAM da árvore
```

## Fluxo de trabalho (TDD)

Todo comportamento novo e toda correção de bug seguem o ciclo:

1. **Vermelho:** escreva o teste que descreve o comportamento esperado e rode-o
   (`bun test <arquivo> -t <nome>`). Ele precisa **falhar, e pelo motivo certo** (a
   asserção, não um import quebrado ou um erro de digitação). Bug: primeiro um teste que
   reproduz o bug.
2. **Verde:** escreva o mínimo de código para o teste passar.
3. **Refatore** com a suíte verde: nomes, duplicação, o lugar certo no módulo.
4. **Feche:** `bun run typecheck && bun test` (e `bun run build:native` se mexeu em C).

Escreva os testes a partir do comportamento visível (API pública, árvore, layout, comandos
de desenho, pixels), não dos detalhes internos, para que refatorar não quebre testes à toa.

### Onde e como testar cada camada

| Camada | Como testar sem janela |
|---|---|
| Reatividade, `For`/`Show` | signals e effects direto; conte execuções e descartes |
| Widgets e layout | monte com `mount` (`@nodebuilderjs/core/testing`) ou `insert` num `UINode` raiz, rode `layout()` e confira `x`/`y`/`width`/`height` ou `debugTree()`. Métricas falsas: 8 px por caractere, linha de 20 px |
| Pintura e command buffer | `drawCommands(node)` / `decode(buffer)` de `test/helpers.ts` devolvem os comandos com nome (`{ op: "line", x0, ... }`). Primitiva de desenho nova começa aqui |
| Imagens e texturas | `setImageBackend({ create, destroy })` registra criação e liberação de texturas |
| Decodificadores e rasterizadores | testes "golden": a saída da referência (libjpeg-turbo, libwebp, librsvg, ImageMagick) fica em `test/fixtures/`, gerada uma vez; compare byte a byte ou com tolerância explícita. Depois, fuzzing com bytes trocados e arquivos truncados: todo erro é uma mensagem do formato (nunca um TypeError), e dimensões absurdas são recusadas antes de alocar (limite de 2^28 pixels) |
| Addon (o que roda sem janela) | chame a função nativa pelo `loadNative()` num teste; use `test.skipIf` quando depender de algo opcional do sistema (ex.: libheif) |

O que não dá para testar automaticamente fica documentado no fechamento da tarefa:

- **Visual** (o C de desenho, shaders, cantos, AA): abra o exemplo em background e capture
  a janela ativa com `spectacle -b -n -a -o <scratch>/x.png`; inspecione pixels com
  `magick` (crop + `-filter point -resize 800%`). O teste automático cobre o lado TS
  (os comandos emitidos); a captura cobre o C.
- **Teclado** (acentos, teclas mortas): a automação não digita; peça ao usuário.
- **Desempenho:** o "teste" é a medição. Meça antes de mudar (`NB_STATS=1` e
  `scripts/compare.sh` na mesma cena), mude, meça de novo na mesma sessão e registre os dois
  números. Otimização sem número de antes e depois não entra.

### Organização dos testes

- Um arquivo por assunto: `core` (reatividade, árvore, layout, culling), `image`, `jpeg`,
  `webp`, `svg` (+ `<Icon>`), `geometry` (triangulação), `draw` (primitivas e `shapes.ts`) e
  `canvas`. Assunto novo ganha arquivo novo; quando o `core` crescer, divida-o.
- Testes rápidos e determinísticos: sem rede, sem relógio, sem janela. A suíte toda roda em
  ~0,1 s; um teste que precise de mais que isso deve ter um motivo.
- Fixtures pequenas (poucos KB). Registre de onde vieram (ferramenta e versão, como em
  `svg-LICENSES.md`) e a licença de arquivos de terceiros.
- Trecho de código em skill ou README também é testado: precisa passar no typecheck.

### Antes de concluir uma tarefa

- `bun run typecheck && bun test` verdes; `bun run build:native` se mexeu em C.
- Mudança visual: um exemplo aberto e capturado. Mudança de desempenho: números de antes e
  depois.
- Documentação junto: README (API pública, limitações), ARCHITECTURE (funcionamento),
  ROADMAP (item feito), este arquivo (estrutura, convenções) e as skills do template
  (API pública, widget novo, limitação resolvida, mais a tabela no `template/AGENTS.md`).

## Estrutura

```
src/                   um módulo por pasta; imports relativos com `.js`
  index.ts             API pública (reexporta os módulos)
  jsx-runtime.ts       runtime JSX próprio; jsx() só cria descrições (ElementDesc)
  testing.ts           @nodebuilderjs/core/testing: mount, findByText, click
  theme.ts             cores/tamanhos padrão (tema claro)
  assets.d.ts          `declare module "*.png" | "*.svg"...` (index.ts referencia com preserve="true")
  reactive/
    signals.ts         createSignal/Effect/Memo/Root, onCleanup, batch, untrack, read
    control.ts         <Show>, <For> (keyed por referência)
  render/              árvore -> layout -> command buffer
    node.ts            UINode (árvore retida), Style, handlers, invalidate(), measureText(), displayScale()
    layout.ts          flexbox simplificado + culling
    paint.ts           árvore -> CommandBuffer (Float32Array) + parseColor
    shapes.ts          polyline (segmentos LINE) e fillPolygon (triangulação + franja de AA)
  runtime/
    app.ts             run(), eventos, foco, hover, agendamento de frames, NB_STATS
    native.ts          carrega native/build/<plataforma>-<arch>/nodebuilder.node (require literais)
  widgets/             um arquivo por widget; index.ts reexporta
    props.ts           StyleProps, STYLE_KEYS, HANDLER_KEYS, applyProps, inherited, interaction
    containers.ts      Box, Column, Row, Scroll, Spacer, Divider, Card
    text.ts image.ts icon.ts canvas.ts button.ts checkbox.ts text-field.ts window.ts
  image/
    source.ts          fontes de imagem: cache por caminho, contagem de uso, handle na GPU
    decode.ts          decodeImage: escolhe o decodificador pela assinatura do arquivo
    png.ts             PNG (todos os tipos de cor, tRNS, Adam7) via node:zlib
    jpeg.ts            JPEG baseline/progressivo, CMYK/YCCK, EXIF; idêntico ao libjpeg-turbo
    webp.ts            WebP VP8 (com perdas), VP8L, alfa, 1º quadro de animação; idêntico ao libwebp
  svg/                 SVG para ícones (<Icon>)
    parse.ts           XML, atributos de apresentação, style="", transform
    render.ts          formas -> geometria -> bitmap
  geometry/            sem dependências de SVG; base para as primitivas de desenho
    path.ts            path data, curvas e arcos achatados em polilinhas
    stroke.ts          contorno -> polígonos (pontas, junções, miter)
    raster.ts          rasterização por linhas de varredura com AA (nonzero/evenodd)
    triangulate.ts     ear clipping de polígonos simples (null se cruzar a si mesmo)
native/
  include/nb.h          API portável: eventos, texto, renderer, imagens, opcodes
  include/nb_platform.h CONTRATO que cada SO implementa (janela, event pump, fontes, codecs)
  core/                 portável, sem nada de SO
    addon.c             superfície N-API, fila de eventos, threadsafe function
    text.c              HarfBuzz + FreeType + atlas de glifos
    render_gles2.c      renderer GLES2: um shader, um formato de vértice, batch único; texturas
  platform/linux/       backend Linux
    linux.h             vtable nb_linux_backend (interno ao Linux)
    linux.c             implementa nb_platform_* escolhendo Wayland ou X11 em runtime
    wayland.c           Wayland (xdg-shell), EGL, ponteiro, teclado (xkb + compose), cursor
    x11.c               X11 (Xlib + EWMH), EGL, XIM (teclas mortas), Xcursor, XRandR
    pump.c              thread de poll() sobre os fds do backend ativo + eventfd de saída
    fonts.c             descoberta de fontes via fontconfig
    codecs.c            AVIF/HEIC via libheif (dlopen; declarações próprias, sem header)
    build.sh            compilação do backend (chamado por scripts/build-native.sh)
    protocols/          xdg-shell.xml (vendorizado; wayland-protocols não está instalado)
  build/<platform>-<arch>/  saída (nomes de process.platform/arch: linux-x64, ...)
test/            um arquivo por módulo (bun:test; bunfig.toml limita o bun test a test/)
  helpers.ts     decode()/drawCommands()/commandsOf(): command buffer -> comandos com nome
  charts/        testes do @nodebuilderjs/charts (escalas e cada tipo de gráfico)
  fixtures/      entradas e saídas de referência (.raw, .pnm do djpeg, PNG do librsvg...)
examples/        counter, todo, images, icons, drawing, charts, bench, dashboard (.tsx) + assets/
cli/             comando `nodebuilder` (bin do pacote): nodebuilder.ts, package.ts
  package/       common.ts, deb.ts, rpm.ts, appimage.ts, native.ts, Dockerfile, icon.svg
packages/        workspaces publicados junto com o core (veja "Publicação no npm")
  linux-x64/     @nodebuilderjs/linux-x64: só o addon pré-compilado (gerado, fora do git)
  charts/        @nodebuilderjs/charts: gráficos com API no formato do Recharts, sobre o <Canvas>
    src/         scale.ts (passos do d3), components.ts (filhos de configuração), cartesian.ts,
                 pie.ts, shared.ts; só importa a API pública do core
  create-nodebuilderjs/  `bun create nodebuilderjs`: index.js + template/ (AGENTS.md e
                         .agents/skills/; index.js cria os links em .claude/skills/)
lib/             JS + .d.ts para o Node (gerado por scripts/npm.ts, fora do git)
compare/         as mesmas cenas em Electron, Tauri, Flutter e egui (benchmarks)
scripts/         build-native.sh, measure.sh, compare.sh, npm.ts
```

## Modelo mental (fluxo de um frame)

```
signal muda -> effect atualiza UINode.set(...) / setSlot(...) -> invalidate()
  -> schedule(): respeita frame pendente e teto de fps
  -> renderFrame(): callbacks de requestAnimationFrame -> layout() -> refreshHover()
     -> paintTree() -> native.render(commands, texts) -> frame callback do compositor
```

- **Componentes rodam uma vez.** Não há virtual DOM nem re-render. O corpo do componente
  é `untrack`ed; só **funções** são reativas.
- **Props reativas são funções:** `text={() => ...}`, `{count}` (accessor como filho),
  `background={() => hovered() ? a : b}`. Valor estático = não reativo. Não existe
  compilador estilo Solid; isso é intencional (só `tsc`/Bun transformam o JSX).
- **`jsx()` é preguiçoso:** retorna `ElementDesc`; o componente executa quando inserido
  (`insert`/`resolve`). Isso permite `<Show>`/`<For>` decidirem quando instanciar.
- **Filhos ficam em slots** (`UINode.addSlot/setSlot`). Cada filho-função vira um slot
  reativo com seu próprio effect; ao reexecutar, o dono descarta os filhos antigos.
- **Ownership:** tudo criado dentro de um effect/root é descartado com ele (`onCleanup`).
  `<For>` cria um `createRoot` por item e o descarta quando o item sai da lista.

## Convenções de código

### TypeScript
- ESM, `strict`, imports relativos com sufixo `.js` (`./node.js`); Bun resolve para `.ts`.
- `package.json#exports`: condição `bun` aponta para `src/*.ts`, `default` para `lib/*.js`
  (gerado para o Node). As entradas públicas são `.`, `./jsx-runtime` e `./testing`.
- Widgets são **funções** que criam `UINode`s; não há classe base de widget.
- **Widget novo:** arquivo próprio em `src/widgets/`, exportado em `widgets/index.ts`.
  Código reaproveitável por outros módulos (geometria, decodificação) fica no módulo do
  assunto, fora de `widgets/`.
- Props de estilo são planas (`padding`, `gap`, `background`...), tipadas como
  `StyleProps` (`MaybeAccessor` de cada campo de `Style`).
- **Ao adicionar um campo em `Style`**, inclua-o também em `STYLE_KEYS` (`widgets/props.ts`);
  handlers novos vão em `Handlers` (`render/node.ts`) e `HANDLER_KEYS`.
- Herdáveis via árvore: `color`, `fontSize`, `bold` (função `inherited`).
- Defaults de cor/tamanho vêm de `theme.ts`, não hard-coded nos widgets.
- Comentários e identificadores em **inglês**; textos de UI, README e este arquivo em
  **português**. Comentários são curtos e explicam o porquê, não o quê.
- Use `ReturnType<typeof setInterval>`, não `NodeJS.Timeout`.

### C (native/)
- `gnu11`, sem dependências além das libs do sistema.
- **Fronteira núcleo/plataforma:** `core/` só pode incluir `nb.h` (que inclui
  `nb_platform.h`), Node-API, GLES2, FreeType, HarfBuzz e a libc. Qualquer coisa de SO
  (Wayland, poll/eventfd/pthread, fontconfig, dlopen...) vai em `platform/<os>/` e chega ao
  núcleo só por funções `nb_platform_*`. Precisa de algo novo do SO? Adicione ao contrato
  em `nb_platform.h`, documente a thread em que roda e implemente em cada backend.
- **Linux tem dois backends de janela** atrás do vtable `nb_linux_backend` (`linux.h`):
  `nb_wayland_backend` (wayland.c) e `nb_x11_backend` (x11.c). Funções dos backends são
  `static`; só o vtable é exportado. `linux.c` escolhe: `NB_BACKEND=wayland|x11` força;
  senão Wayland se `WAYLAND_DISPLAY`, depois X11 se `DISPLAY`. `open()` que falha não
  pode deixar nada aberto (o seletor chama `close()` e tenta o próximo).
- Funcionalidade nova de janela no Linux = implementar nos **dois** backends.
- Cada backend usa `eglGetPlatformDisplay` com a plataforma explícita
  (`EGL_PLATFORM_WAYLAND_KHR` / `EGL_PLATFORM_X11_KHR`); nunca `eglGetDisplay`, que
  obriga o Mesa a adivinhar o tipo do ponteiro.
- **Modelo de threads:** o backend pode ter uma thread que só espera (no Linux, `poll()` no
  fd do display, no timerfd de repetição e num eventfd de saída) e chama `wake()`; o núcleo
  acorda o JS via `napi_threadsafe_function` e chama `nb_platform_pump_process()`, onde
  acontece toda a leitura/dispatch. O pump do Linux faz `poll()` nos fds que
  `backend->fds()` devolve (fd *i* = bit *i* de `ready`) e chama `backend->process(ready)`
  na thread do JS. `nb_wl_dispatch()` nunca bloqueia (prepare_read/read_events/cancel_read).
- Eventos para o JS: preencher `nb_event` e chamar `nb_push_event()` **na thread do JS**.
- Depois de chamadas que possam receber eventos (ex.: `eglSwapBuffers`), o núcleo chama
  `nb_platform_flush()` e pede uma entrega (`request_delivery()`).
- Coordenadas: o JS trabalha em **px lógicos**; o C multiplica pelo `scale` inteiro
  (Wayland: `wl_surface.preferred_buffer_scale`; X11: `Xft.dpi / 96`, ou `NB_SCALE`).
- X11 específicos: sem decoração do WM (`_MOTIF_WM_HINTS`), mover/redimensionar via
  `_NET_WM_MOVERESIZE`, maximizar via `_NET_WM_STATE`, visual ARGB de 32 bits só quando
  há compositor (`_NET_WM_CM_Sn`); sem compositor, `transparent=false` e a `Window` usa
  raio 0. X11 não tem frame callback: o ritmo vem de um timerfd na taxa do XRandR.
- Renderer em **alpha pré-multiplicado** (`GL_ONE, GL_ONE_MINUS_SRC_ALPHA`). A borda é
  composta *sobre* o fundo (semântica CSS). Misturar em alpha "reto" gera artefatos
  escuros nos cantos (bug já corrigido; não regredir). Texturas de imagem são
  pré-multiplicadas no upload.
- **Novo SO:** criar `native/platform/<os>/` com a implementação completa de
  `nb_platform.h` + `build.sh`, e adicionar o `case` em `scripts/build-native.sh`.
  O renderer é GLES2 (no Windows/macOS: ANGLE, ou um novo `core/render_<api>.c` com a
  mesma interface `nb_render_*`).
- Mudou a API nativa? Atualize `core/addon.c` (export), `src/runtime/native.ts` (tipo) e, se
  precisar de algo do SO, `nb_platform.h` + backends. Se for opcode, os três lugares
  do formato abaixo.

### Formato do command buffer (render/paint.ts -> render_gles2.c)
Mantenha **`native/include/nb.h`, `src/render/paint.ts` e `native/core/render_gles2.c` em sincronia**.

| Op | Código | Floats seguintes |
|---|---|---|
| RECT | 1 | x y w h · r g b a · radius borderWidth · br bg bb ba |
| TEXT | 2 | x y(topo da linha) size font(0/1 bold) · r g b a · índice em `texts[]` |
| CLIP | 3 | x y w h radius (scissor + máscara arredondada mais interna) |
| UNCLIP | 4 | (nenhum) |
| SHADOW | 5 | x y w h · r g b a · radius blur |
| IMAGE | 6 | x y w h · u0 v0 u1 v1 · r g b a (tinta; a = opacidade) · radius · id (de `createImage`) |
| LINE | 7 | x0 y0 x1 y1 · width · r g b a · capStart capEnd (0 butt, 1 round) |
| TRIANGLES | 8 | n · r g b a · n × (x y cobertura) |
| ARC | 9 | cx cy · outer inner · start sweep (radianos; 0 = cima, horário) · r g b a |

Cores em 0..1, não pré-multiplicadas (o shader pré-multiplica). Op novo também entra no
`decode()` de `test/helpers.ts`, que os testes usam para ler o buffer.

### Layout (render/layout.ts)
- Flex: `direction` (padrão column em `Column`/`Box`), `gap`, `padding`, `grow`,
  `align` (padrão **stretch**), `justify`, `min/max`, `position: "absolute"` (`left/top`).
- **Encolhimento segue o CSS `min-size: auto`:** um filho não encolhe abaixo do próprio
  conteúdo, exceto se for `scrollable`/`clip` ou tiver `minWidth/minHeight` explícito.
- `Scroll` = coluna com `scrollable = true` e `minHeight: 0`.
- **Culling:** `place()` recebe a região visível (estreitada por cada nó com clip/scroll). Filho
  fora dela ganha a caixa mas fica `culled`: subárvore não é posicionada, pintada (`paintTree`)
  nem testada no clique (`hitTest`). Coordenadas de descendentes de um nó `culled` são velhas;
  nunca as use sem checar a marca.
- Clip (`clip`/scroll) recorta por dentro da borda, com raio `radius - borderWidth`.

## Desempenho

- `NB_STATS=1` imprime por segundo: fps, ms/frame (state, layout, paint, native), nós,
  tamanho do command buffer, heap e RSS.
- Teto de fps: `run(app, { maxFps })` ou `NB_MAX_FPS`; padrão 120. No Wayland o frame
  continua alinhado ao vsync: pulamos vblanks com `native.requestFrame()` (commit sem
  desenho). No X11 o ritmo é por timer (não alinhado ao vsync). Tolerância de 1,5 ms para
  144 Hz não cair para 72.
- `requestAnimationFrame(cb)` existe (`runtime/app.ts`) e é ritmado pelo compositor.
- Números e método: tabelas no README, teto 120 e cuidados de medição no ARCHITECTURE
  ("Medindo desempenho"). Use `scripts/compare.sh` com aquecimento e amostra iguais nos
  dois lados da comparação.
- Quebra da RAM: Bun vazio 15 MB, + texto 26 MB, + janela GL 108 MB (quase tudo driver);
  o framework em si ~15 MB.
- **Gargalos conhecidos (ordem de prioridade):**
  1. layout completo a cada frame: o tamanho natural de todos os filhos de um `Scroll` é
     calculado todo frame (~2,5 ms na tabela de 500 linhas), sem dirty flags;
  2. HarfBuzz refaz o shaping de todo texto *visível* a cada frame (sem cache no C);
  3. agendamento: com teto 60 o fps fica em 51–58 até em cenas leves (perde vblanks);
     latência frame callback -> thread -> `setImmediate` antes de renderizar;
  4. GPU híbrida: o glvnd carrega libs da NVIDIA sem usá-las (+38 MB). Forçar só Mesa
     precisa detectar a GPU do compositor, senão quebra máquinas só-NVIDIA;
  5. redesenho da janela inteira (sem `EGL_KHR_partial_update`/dano);
  6. `CommandBuffer.push(...values)` aloca por chamada.

## Empacotamento

`nodebuilder package <app.tsx>` (no repo: `bun run package`) gera em `dist/` um AppImage,
`.deb`, `.rpm` e `.tar.gz` (`--targets` escolhe; `--help` lista as opções). Etapas:

1. **Addon** (`--native`): num app, `prebuilt` embute o binário de `@nodebuilderjs/<plataforma>`
   (já portável, nada a compilar). No repositório do framework, `docker` compila num
   Ubuntu 22.04 (`cli/package/Dockerfile`), exigindo só glibc ≥ 2.34 e libwayland ≥ 1.20, e
   substitui o build local em `native/build/` (funciona igual para desenvolvimento);
   `local` compila aqui e só roda com a glibc desta máquina ou mais nova. Um plugin do
   `Bun.build` embute só o addon escolhido e deixa os outros candidatos como externos.
2. **Executável único:** `Bun.build({ compile })` embute runtime, código, arquivos
   importados com `with { type: "file" | "text" }` e o addon (~91 MB, ~31 MB compactado).
   `process.env.NB_APP_ID` é definido em tempo de build e vira o app id Wayland /
   WM_CLASS, que casa com o `.desktop` (`StartupWMClass`).
3. **Árvore de instalação:** `/usr/bin/<nome>`, `.desktop` e ícone (hicolor) em
   `/usr/share`. As bibliotecas do sistema são **dependências declaradas, nunca embutidas**
   (`DEB_DEPENDS`/`RPM_SONAMES` em `cli/package/common.ts`; mantenha em sincronia com `PKGS`
   do `native/platform/linux/build.sh`). A libheif é só sugerida (`DEB_SUGGESTS`/`RPM_SUGGESTS`).
4. **Formatos**, todos sem ferramentas da distro (só `tar`/`xz`):
   - `.deb`: `ar` escrito à mão (control.tar.xz + data.tar.xz);
   - `.rpm`: RPM v4 escrito à mão (`cli/package/rpm.ts`), com região imutável e digests SHA-256;
     requires por soname, então serve Fedora, RHEL e openSUSE;
   - AppImage: `appimagetool` baixado em `~/.cache/nodebuilder` (só no build).

Verificado (2026-10-11) com instalação real em container e janela no Wayland do host
(`--device /dev/dri`, socket em `XDG_RUNTIME_DIR`): `.deb` em Ubuntu 22.04/24.04 e
Debian 12; `.rpm` em Fedora 43 (rpm 6.0, `rpm -K` OK) e AlmaLinux 9; AppImage no host e
em Ubuntu 22.04 sem FUSE. Containers mínimos precisam de `libgl1-mesa-dri` /
`mesa-dri-drivers` e de alguma fonte; desktops já têm. Para testar um executável,
rode-o fora do repositório (`cd /`): assim aparece o que só existia no disco.

## Publicação no npm

Escopo `@nodebuilderjs` (o nome `nodebuilder` no npm é de outro projeto). Três pacotes,
todos com a versão do `package.json` da raiz:

| Pacote | Conteúdo |
|---|---|
| `@nodebuilderjs/core` | este repo: `src/` (Bun, condição `bun`), `lib/` (Node + tipos), `cli/` (bin `nodebuilder`) |
| `@nodebuilderjs/linux-x64` | só `nodebuilder.node` portável, com `os`/`cpu`/`libc` |
| `@nodebuilderjs/charts` | `packages/charts`: `src/` (Bun) e `lib/` (Node); core como peer dependency opcional |
| `create-nodebuilderjs` | `bun create nodebuilderjs meu-app` (`npm create` também funciona) |

- O binário vai como `optionalDependencies` do core (`workspace:*` no repo; o pack troca
  pela versão), padrão esbuild: **sem script de instalação**, que o Bun bloqueia.
- `src/runtime/native.ts` tenta, nesta ordem: build local (`../../native/build/...`, só
  existe no repo) e o pacote `@nodebuilderjs/<plataforma>`. "Não encontrado" passa para o
  próximo; um addon encontrado que falha ao carregar (lib do sistema, glibc) é o erro.
- `bun run npm:build`: sincroniza versões, gera `lib/` do core e do charts (espelhando as
  pastas de `src/`; os `.d.ts` do charts apontam para os do core),
  compila o addon portável (Docker) em `packages/linux-x64/` e empacota em `dist/npm/`.
  `bun run npm:publish` faz o mesmo e roda `bun publish` em cada tarball (binário antes do
  core). Precisa de login no npm e da org `@nodebuilderjs` criada.
- Antes de publicar, teste ponta a ponta sem registro: crie um app com
  `node dist/npm/…create…/index.js` (extraído do tarball), aponte `@nodebuilderjs/core` para
  `file:<tarball>` e use `overrides` para `@nodebuilderjs/linux-x64`; rode `bun test`,
  `bun start`, `nodebuilder package` e instale o `.deb` num container (sem `node_modules`).
- arm64: o loader e o empacotador já conhecem `linux-arm64`, mas ainda não há pacote
  (precisa de build em máquina/CI arm64).

## Limitações atuais

- TextField: sem seleção, clipboard, undo; Text: sem quebra de linha; uma fonte só
  (sem fallback: emojis não aparecem).
- `<Canvas>`: polígono que cruza a si mesmo não é desenhado; linhas translúcidas escurecem
  nas junções (cada segmento é desenhado à parte); fatias vizinhas de pizza mostram uma
  emenda clara fina (as duas bordas antialiasadas, como em navegadores); triangular formas
  radiais com milhares de pontos é lento (~80 ms para 2000 pontos).
- SVG só para ícones: sem gradientes, padrões, texto, filtros, máscaras, `<use>`, tracejado
  e CSS em `<style>`; opacidade de grupo aplicada por forma.
- Imagens: AVIF/HEIC só com a `libheif` do sistema; decodificação síncrona na thread do JS
  (4 megapixels: PNG 80–130 ms, JPEG 140–170 ms, WebP 105–180 ms); sem mipmaps (reduzir
  muito uma imagem serrilha) e sem versão @2x.
- Sem acessibilidade (AT-SPI), animações/transições, tema escuro, multi-janela, IME
  (text-input-v3), DnD, escala fracionária real (KDE 125% renderiza em 2x e reduz).
- Janela sempre com decoração própria (CSD): barra de título, mover, maximizar,
  redimensionar pelas bordas (6 px). `xdg-decoration` (SSD no KDE) ainda não.
- X11: frames por timer (sem extensão Present, então pode haver tearing sem compositor
  e ~5–10% menos fps que no Wayland); escala só inteira; testado apenas via XWayland
  (KDE). Sessão X11 pura e o caminho sem compositor ainda não foram testados.

## Armadilhas já encontradas

### Ambiente
- O shell do usuário é **zsh**: `set -- $var` não divide palavras, e globs sem
  correspondência (`--include=*.md`) viram erro; em scripts use `#!/usr/bin/env sh|bash`
  ou aspas. `ls` tem alias com cores: em scripts use `command ls`.
- Com `set -o pipefail`, `grep` sem resultado derruba o script (use `|| true`).
- O `bun` do PATH é um shim (vite-plus); para medir o processo real use
  `bun -e 'console.log(process.execPath)'`.
- Bun bloqueia scripts de instalação: o binário do Electron em `compare/electron` foi
  baixado com `node node_modules/electron/install.js`.
- O KWin às vezes perde vblanks mesmo em cenas triviais (p90 ~7,6 ms a 240 Hz); fps um
  pouco abaixo do teto não é necessariamente bug nosso.
- Para testar o X11 numa sessão Wayland: `NB_BACKEND=x11` (usa o XWayland, `DISPLAY=:0`);
  `NB_SCALE=2` simula HiDPI. `NB_DEBUG=1` mostra o backend, escala, Hz, visual e o
  `GL_RENDERER`.
- Captura de tela com o mouse sobre a janela pode pegar uma rolagem perdida: se o
  resultado parecer estranho, capture de novo antes de investigar.

### Bun, empacotamento e publicação
- `bun build --compile` só embute `.node` carregado por `require("literal")`. Com
  `createRequire(...)(path)` o binário procura o arquivo em disco (e parece funcionar na
  máquina de build). Por isso `src/runtime/native.ts` tem um `require` literal por
  plataforma, relativo à pasta dele: mover o arquivo exige ajustar os `../`.
- Arquivos de um app só entram no executável se forem importados com
  `with { type: "file" }` (o import vira o caminho, `/$bunfs/...` no executável) ou
  `with { type: "text" }`. `new URL("./x.png", import.meta.url)` funciona no
  desenvolvimento e quebra no pacote.
- O `Bun.Transpiler` (e o bundler) troca `typeof require === "function"` por `true`. Para
  saber se está no Bun use `process.versions.bun`, que não é avaliado em tempo de build.
- O tsc 5.5+ descarta `/// <reference path>` dos `.d.ts` gerados; sem `preserve="true"`, o
  `declare module "*.png"` não chegaria a quem usa o pacote pelo `lib/`.
- O npm remove `.gitignore` de pacotes publicados: o template guarda `_gitignore` e o
  `create-nodebuilderjs` renomeia ao copiar. Links simbólicos relativos também não
  sobrevivem ao pack/`cpSync`: por isso os links de `.claude/skills/` são criados pelo
  `index.js`.
- `Object.keys(native)` retorna `[]` (propriedades não enumeráveis); não é erro.

### Nativo
- Headers da libwayland < 1.22 não têm os campos v6 do `wl_surface_listener`, e uma
  libwayland antiga em runtime aborta se o compositor mandar eventos v6. O bind do
  `wl_compositor` é limitado por `wl_surface_interface.version` (da lib carregada) e o
  listener é uma tabela.
- Bibliotecas opcionais (libheif) são carregadas com `dlopen` e declarações próprias das
  poucas funções usadas: assim não viram dependência de build nem de instalação. Só vale
  para APIs de handles e funções; se a API expõe structs que mudam entre versões, o layout
  quebra entre distros.

- Uma peer dependency obrigatória faz o `bun install` baixar o pacote publicado do npm
  (o charts pedia o core 0.1.1), criando uma segunda cópia do core no repositório. Por
  isso a peer do charts é opcional (`peerDependenciesMeta`): no repositório, o core vem
  dos `paths` do tsconfig; num app, já está instalado.
- No teste ponta a ponta com o Node, instale cópias dos pacotes em `node_modules`, não
  links simbólicos: o Node segue o link até o caminho real e não acha as dependências.

### Fixtures
- O `PNG8:` do ImageMagick reduz o alfa da paleta a 0/255; por isso as fixtures de paleta
  com alfa parcial são escritas à mão (e conferidas com o próprio `magick`).
- Quando a ferramenta de referência não gera um caso (partições do VP8, transformações do
  VP8L), escreva o arquivo à mão ou com um programa pequeno no scratch, e confira que a
  biblioteca de referência o lê igual.
