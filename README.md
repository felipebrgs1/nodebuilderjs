# nodebuilder

Protótipo de framework de UI nativa para Linux em TypeScript, rodando no Bun (também funciona no Node).
Sem DOM, sem Electron, sem GTK/Qt: componentes TSX com reatividade estilo SolidJS,
renderizados por um núcleo nativo próprio (Wayland + GLES2 + FreeType/HarfBuzz).

## Rodar

```sh
bun install            # dev: typescript 7 (tsgo), @types/bun, node-api-headers
bun run build:native   # compila native/build/<platform>-<arch>/nodebuilder.node
bun run counter        # exemplo contador (Bun executa o .tsx direto, sem build)
bun run todo           # exemplo lista de tarefas
bun run dev            # todo com --watch
bun test               # testes headless (sem janela)
bun run typecheck      # tsc 7 (compilador nativo em Go), só checagem
```

Requisitos do sistema: sessão Wayland, headers de wayland-client/egl/cursor, EGL, GLESv2,
xkbcommon, freetype2, harfbuzz e fontconfig.

## Arquitetura

```
examples/*.tsx      app do usuário (TSX + signals)
src/reactive.ts     createSignal / createEffect / createMemo / createRoot / onCleanup
src/jsx-runtime.ts  runtime JSX próprio (jsxImportSource: "nodebuilder")
src/control.ts      <Show>, <For> (keyed)
src/node.ts         árvore retida (UINode); mutações agendam um frame
src/layout.ts       flexbox simplificado (row/column, gap, padding, grow, align, justify, scroll)
src/paint.ts        árvore -> buffer de comandos (Float32Array)
src/widgets.ts      Window (decoração própria), Box/Row/Column, Text, Button, TextField, Checkbox, Card, Scroll
src/app.ts          loop de eventos: hover, clique, foco, teclado, scroll, resize/move da janela
native/include/     nb.h (API portável) + nb_platform.h (contrato por SO)
native/core/        núcleo C portável: addon.c (N-API), text.c, render_gles2.c
native/platform/    backends por SO; hoje só linux/ (Wayland, EGL, xkb, fontconfig)
```

O addon não usa libuv (o Bun não implementa): o backend do SO avisa que há eventos
(no Linux, uma thread que só faz `poll()`), e o núcleo acorda o JS via
`napi_threadsafe_function`. Toda leitura/dispatch acontece na thread do JS.
Para portar a outro SO: implementar `native/include/nb_platform.h` em
`native/platform/<os>/` (veja AGENTS.md).

Componentes executam **uma vez**. Só props passadas como função (`text={() => ...}`,
`{count}`) são reativas, e atualizam o nó diretamente, sem virtual DOM.
