# AGENTS.md — nodebuilder

Guia para agentes (e humanos) trabalhando neste repositório. Leia antes de mudar código.

## O que é

Framework de UI **nativa para Linux** em TypeScript: componentes TSX com reatividade
estilo **SolidJS**, renderizados por um **núcleo nativo próprio** (Wayland + GLES2 +
FreeType/HarfBuzz, em C via N-API). Sem DOM, sem Electron, sem GTK/Qt.

Motivação: um "Flutter para o ecossistema JS". TypeScript porque LLMs escrevem TS/JSX
muito bem, então o máximo possível do framework fica em TS, e o C fica pequeno e estável.

## Regras inegociáveis

1. **Zero dependências de terceiros em runtime.** Só o próprio código + bibliotecas do
   sistema (libwayland, EGL/GLES, xkbcommon, FreeType, HarfBuzz, fontconfig). Dependências
   de desenvolvimento são aceitáveis (hoje: `typescript`, `@types/bun`, `node-api-headers`).
   Nada de React, Solid, Yoga, Skia etc. como dependência; servem só de referência.
2. **Bun é o runtime e o gerenciador de pacotes principal.** Use `bun`, `bun add`,
   `bun test`. Nunca npm/yarn/pnpm, `node:test` ou etapa de build com `tsc`.
   O código deve **continuar funcionando no Node** também (o addon é agnóstico).
3. **Nunca usar libuv (`uv_*`) no addon.** O Bun não implementa libuv e aborta com
   `unsupported_uv_function`. Trabalho assíncrono nativo (fds, timers) entra no conjunto
   de `poll()` da thread de bombeamento (ver "Núcleo nativo").
4. **Linux/Wayland primeiro, arquitetura pronta para outros SOs.** Código nativo é dividido
   em núcleo portável (`native/core/`) e backend por SO (`native/platform/<os>/`), ligados
   só pelo contrato `native/include/nb_platform.h`. Nada específico de SO entra no núcleo
   (hoje o núcleo só inclui Node-API, GLES2, FreeType e HarfBuzz). No Linux, **Wayland e
   X11** são suportados, escolhidos em tempo de execução.
5. **TypeScript 7** (compilador nativo em Go) apenas para checagem: `bun run typecheck`.
6. **Teto de 120 fps** por padrão. Acima disso é desnecessário (decisão do projeto).

## Comandos

```sh
bun install              # deps de desenvolvimento
bun run build:native     # compila native/build/<platform>-<arch>/nodebuilder.node
bun run typecheck        # tsc 7 --noEmit (~0,1s)
bun test                 # testes headless, sem janela
bun run counter | todo   # exemplos (Bun executa .tsx direto)
bun run dev              # todo com --watch
bun run bench            # stress test com NB_STATS=1 (env: N=1000 MODE=one|all|static)
bun run bench:dashboard  # app realista com abas (env: TAB=overview|table|logs|settings
                         #   ROWS=500 LIVE=0 CYCLE=<frames por troca de aba>)
scripts/measure.sh <rótulo> <arquivo.tsx> [s]          # CPU/RAM de um processo
scripts/compare.sh <rótulo> <warm> <s> -- <comando...>  # CPU/RAM da árvore de processos
```

Depois de mudar qualquer `.c`/`.h`, rode `bun run build:native`. Antes de concluir uma
tarefa: `bun run typecheck && bun test`, e para mudanças visuais, abra um exemplo.

## Estrutura

```
src/
  reactive.ts    createSignal/Effect/Memo/Root, onCleanup, batch, untrack, read
  jsx-runtime.ts runtime JSX próprio; jsx() só cria descrições (ElementDesc)
  control.ts     <Show>, <For> (keyed por referência)
  node.ts        UINode (árvore retida), Style, handlers, invalidate(), measureText()
  layout.ts      flexbox simplificado
  paint.ts       árvore -> CommandBuffer (Float32Array) + parseColor
  widgets.ts     Window, Box/Row/Column, Spacer, Scroll, Divider, Text, Button,
                 Checkbox, TextField, Card
  app.ts         run(), eventos, foco, hover, agendamento de frames, NB_STATS
  native.ts      carrega native/build/${process.platform}-${process.arch}/nodebuilder.node
  theme.ts       cores/tamanhos padrão (tema claro)
  index.ts       API pública
native/
  include/nb.h          API portável: eventos, texto, renderer, opcodes do command buffer
  include/nb_platform.h CONTRATO que cada SO implementa (janela, event pump, fontes)
  core/                 portável, sem nada de SO
    addon.c             superfície N-API, fila de eventos, threadsafe function
    text.c              HarfBuzz + FreeType + atlas de glifos
    render_gles2.c      renderer GLES2: um shader, um formato de vértice, batch único
  platform/linux/       backend Linux
    linux.h             vtable nb_linux_backend (interno ao Linux)
    linux.c             implementa nb_platform_* escolhendo Wayland ou X11 em runtime
    wayland.c           Wayland (xdg-shell), EGL, ponteiro, teclado (xkb + compose), cursor
    x11.c               X11 (Xlib + EWMH), EGL, XIM (teclas mortas), Xcursor, XRandR
    pump.c              thread de poll() sobre os fds do backend ativo + eventfd de saída
    fonts.c             descoberta de fontes via fontconfig
    build.sh            compilação do backend (chamado por scripts/build-native.sh)
    protocols/          xdg-shell.xml (vendorizado; wayland-protocols não está instalado)
  build/<platform>-<arch>/  saída (nomes de process.platform/arch: linux-x64, ...)
examples/        counter.tsx, todo.tsx, bench.tsx, dashboard.tsx
test/            core.test.tsx (bun:test)
compare/electron bench e dashboard em Electron + DOM puro (baseline; SCENE=dashboard)
scripts/         build-native.sh, measure.sh, compare.sh
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
- `package.json#exports` aponta para `src/*.ts` (não há `dist/`).
- Widgets são **funções** que criam `UINode`s; não há classe base de widget.
- Props de estilo são planas (`padding`, `gap`, `background`...), tipadas como
  `StyleProps` (`MaybeAccessor` de cada campo de `Style`).
- **Ao adicionar um campo em `Style`**, inclua-o também em `STYLE_KEYS` (widgets.ts);
  handlers novos vão em `Handlers` (node.ts) e `HANDLER_KEYS`.
- Herdáveis via árvore: `color`, `fontSize`, `bold` (função `inherited`).
- Defaults de cor/tamanho vêm de `theme.ts`, não hard-coded nos widgets.
- Comentários e identificadores em **inglês**; textos de UI, README e este arquivo em
  **português**. Comentários são curtos e explicam o porquê, não o quê.
- Use `ReturnType<typeof setInterval>`, não `NodeJS.Timeout`.

### C (native/)
- `gnu11`, sem dependências além das libs do sistema.
- **Fronteira núcleo/plataforma:** `core/` só pode incluir `nb.h` (que inclui
  `nb_platform.h`), Node-API, GLES2, FreeType, HarfBuzz e a libc. Qualquer coisa de SO
  (Wayland, poll/eventfd/pthread, fontconfig...) vai em `platform/<os>/` e é exposta ao
  núcleo só por funções `nb_platform_*`. Precisa de algo novo do SO? Adicione ao contrato
  em `nb_platform.h`, documente a thread em que roda e implemente em cada backend.
- **Linux tem dois backends de janela** atrás do vtable `nb_linux_backend` (`linux.h`):
  `nb_wayland_backend` (wayland.c) e `nb_x11_backend` (x11.c). Funções dos backends são
  `static`; só o vtable é exportado. `linux.c` escolhe: `NB_BACKEND=wayland|x11` força;
  senão Wayland se `WAYLAND_DISPLAY`, depois X11 se `DISPLAY`. `open()` que falha não
  pode deixar nada aberto (o seletor chama `close()` e tenta o próximo).
- O pump do Linux faz `poll()` nos fds que `backend->fds()` devolve (fd *i* = bit *i* de
  `ready`) e chama `backend->process(ready)` na thread do JS.
- Cada backend usa `eglGetPlatformDisplay` com a plataforma explícita
  (`EGL_PLATFORM_WAYLAND_KHR` / `EGL_PLATFORM_X11_KHR`); nunca `eglGetDisplay`, que
  obriga o Mesa a adivinhar o tipo do ponteiro.
- Funcionalidade nova de janela no Linux = implementar nos **dois** backends.
- **Novo SO:** criar `native/platform/<os>/` com a implementação completa de
  `nb_platform.h` + `build.sh`, e adicionar o `case` em `scripts/build-native.sh`.
  O renderer é GLES2 (no Windows/macOS: ANGLE, ou um novo `core/render_<api>.c` com a
  mesma interface `nb_render_*`).
- Eventos para o JS: preencher `nb_event` e chamar `nb_push_event()` **na thread do JS**.
- **Modelo de threads do event pump:** o backend pode ter uma thread que só espera
  (no Linux, `poll()` no fd do display, no timerfd de repetição e num eventfd de saída)
  e chama `wake()`; o núcleo acorda o JS via `napi_threadsafe_function` e chama
  `nb_platform_pump_process()`, onde acontece toda a leitura/dispatch. No Linux,
  `nb_wl_dispatch()` nunca bloqueia (prepare_read/read_events/cancel_read).
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
  escuros nos cantos (bug já corrigido; não regredir).
- Mudou a API nativa? Atualize `core/addon.c` (export), `src/native.ts` (tipo) e, se
  precisar de algo do SO, `nb_platform.h` + backends. Se for opcode, os três lugares
  do formato abaixo.

### Formato do command buffer (paint.ts -> render_gles2.c)
Mantenha **`native/include/nb.h`, `src/paint.ts` e `native/core/render_gles2.c` em sincronia**.

| Op | Código | Floats seguintes |
|---|---|---|
| RECT | 1 | x y w h · r g b a · radius borderWidth · br bg bb ba |
| TEXT | 2 | x y(topo da linha) size font(0/1 bold) · r g b a · índice em `texts[]` |
| CLIP | 3 | x y w h radius (scissor + máscara arredondada mais interna) |
| UNCLIP | 4 | (nenhum) |
| SHADOW | 5 | x y w h · r g b a · radius blur |

Cores em 0..1, não pré-multiplicadas (o shader pré-multiplica).

### Layout (layout.ts)
- Flex: `direction` (padrão column em `Column`/`Box`), `gap`, `padding`, `grow`,
  `align` (padrão **stretch**), `justify`, `min/max`, `position: "absolute"` (`left/top`).
- **Encolhimento segue o CSS `min-size: auto`:** um filho não encolhe abaixo do próprio
  conteúdo, exceto se for `scrollable`/`clip` ou tiver `minWidth/minHeight` explícito.
- `Scroll` = coluna com `scrollable = true` e `minHeight: 0`.
- Clip (`clip`/scroll) recorta por dentro da borda, com raio `radius - borderWidth`.

## Testes e verificação

- `bun test` roda sem janela: `setTextMeasurer` instala métricas falsas
  (8 px por caractere, linha de 20 px). Teste reatividade, árvore (`debugTree`) e layout.
- Toda correção de bug de layout/reatividade ganha um teste em `test/core.test.tsx`.
- Verificação visual (KDE): abra o exemplo em background e capture a janela ativa:
  `spectacle -b -n -a -o <scratch>/x.png`. Para inspecionar pixels, use `magick` (crop +
  `-filter point -resize 800%`) ou PIL. Foi assim que os artefatos dos cantos foram achados.
- Não é possível digitar pela automação; entrada de teclado (acentos, teclas mortas) deve
  ser testada manualmente pelo usuário.

## Performance

- `NB_STATS=1` imprime por segundo: fps, ms/frame (state+layout, paint, native), nós,
  tamanho do command buffer, heap e RSS.
- Teto de fps: `run(app, { maxFps })` ou `NB_MAX_FPS`; padrão 120. No Wayland o frame
  continua alinhado ao vsync: pulamos vblanks com `native.requestFrame()` (commit sem
  desenho). No X11 o ritmo é por timer (não alinhado ao vsync; ver limitações).
  Tolerância de 1,5 ms para 144 Hz não cair para 72.
- `requestAnimationFrame(cb)` existe (app.ts) e é ritmado pelo compositor.
- **Referências medidas (2026-10-11, i7-12700H, Intel Iris Xe, KWin, monitor 240 Hz, teto 120):**

| Cenário | Electron 44 (DOM puro) | nodebuilder |
|---|---|---|
| 1000 células, parado | 0,2% CPU · 323 MB PSS | 0,3% CPU · 122 MB PSS |
| 1000 células, 1 texto muda | 116 fps · 66% · 326 MB | 106 fps · 39% · 148 MB |
| 1000 células, todas mudam | 111 fps · 237% · 439 MB | 104 fps · 65% · 192 MB |
| 3000 células, todas mudam | 49 fps · 176% · 461 MB | 49 fps · 94% · 244 MB |

- **Dashboard** (`examples/dashboard.tsx`, 500 serviços, ao vivo; mesmo hardware e data).
  Electron: `SCENE=dashboard TAB=<aba> scripts/compare.sh <rótulo> 3 5 -- compare/electron/node_modules/.bin/electron --ozone-platform=wayland compare/electron`

| Aba | Electron 44 (DOM puro) | nodebuilder |
|---|---|---|
| Visão geral (~190 nós) | 117 fps · 69% · 362 MB | 105 fps · 37% · 99 MB |
| Serviços (~6000 nós, 500 linhas) | 116 fps · 82% · 376 MB | **81 fps** · 83% · 173 MB |
| Logs (~1700 nós, 2 linhas/frame) | 102 fps · 153% · 452 MB | 108 fps · 70% · 180 MB |
| Configurações (~130 nós) | 115 fps · 60% · 306 MB | 108 fps · 23% · 91 MB |
| `CYCLE=30` (troca de aba a cada 30 frames) | 110 fps · 97% · 411 MB | 97 fps · 59% · 149 MB |

  A aba Serviços é onde perdemos: ~470 linhas fora da tela entram no layout, na pintura
  e no shaping todo frame (gargalos 1–3 abaixo); o Chromium só trabalha no que é visível.

- Quebra da RAM do nodebuilder: Bun vazio 15 MB, + texto 26 MB, + janela GL 108 MB;
  o framework em si ~15 MB. O resto é driver.
- **Gargalos conhecidos (ordem de prioridade para otimizar):**
  1. pintura sem culling (desenha nós fora da área visível);
  2. layout completo a cada frame (sem dirty flags / layout incremental);
  3. HarfBuzz re-shape de todo texto a cada frame (sem cache de shaping no C);
  4. GPU híbrida: o glvnd carrega libs da NVIDIA sem usá-las (+38 MB). Forçar só Mesa
     precisa detectar a GPU do compositor, senão quebra máquinas só-NVIDIA;
  5. redesenho da janela inteira (sem `EGL_KHR_partial_update`/dano);
  6. `CommandBuffer.push(...values)` aloca por chamada;
  7. latência: frame callback -> thread -> `setImmediate` antes de renderizar.
- Toda otimização deve ser medida antes/depois com `bench` + `compare.sh` (mesmo cenário).

## Limitações atuais

- TextField: sem seleção, clipboard, undo; Text: sem quebra de linha; uma fonte só
  (sem fallback: emojis não aparecem).
- Sem acessibilidade (AT-SPI), animações/transições, tema escuro, multi-janela, IME
  (text-input-v3), DnD, escala fracionária real (KDE 125% renderiza em 2x e reduz).
- Janela sempre com decoração própria (CSD): barra de título, mover, maximizar,
  redimensionar pelas bordas (6 px). `xdg-decoration` (SSD no KDE) ainda não.
- X11: frames por timer (sem extensão Present, então pode haver tearing sem compositor
  e ~5–10% menos fps que no Wayland); escala só inteira; testado apenas via XWayland
  (KDE). Sessão X11 pura e o caminho sem compositor ainda não foram testados.

## Armadilhas já encontradas

- Bun bloqueia scripts de instalação: o binário do Electron em `compare/electron` foi
  baixado com `node node_modules/electron/install.js`.
- O shell do usuário é **zsh**: `set -- $var` não divide palavras; em scripts use
  `#!/usr/bin/env sh|bash` ou expansão explícita.
- Com `set -o pipefail`, `grep` sem resultado derruba o script (use `|| true`).
- O `bun` do PATH é um shim (vite-plus); para medir o processo real use
  `bun -e 'console.log(process.execPath)'`.
- O KWin às vezes perde vblanks mesmo em cenas triviais (p90 ~7,6 ms a 240 Hz); fps um
  pouco abaixo do teto não é necessariamente bug nosso.
- `Object.keys(native)` retorna `[]` (propriedades não enumeráveis); não é erro.
- Depois de `bun run build:native`, o binário fica em `native/build/linux-x64/`; o caminho
  antigo `native/build/nodebuilder.node` não existe mais.
- Para testar o X11 numa sessão Wayland: `NB_BACKEND=x11` (usa o XWayland, `DISPLAY=:0`).
  `NB_DEBUG=1` mostra o backend escolhido, escala, Hz, visual e o `GL_RENDERER`.
