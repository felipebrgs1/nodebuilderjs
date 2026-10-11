# Plano: suporte nativo a Windows e macOS

Cada SO usa as próprias bibliotecas do sistema, e o núcleo fica só com o que é portável.

## Princípio

| | Linux | Windows | macOS |
|---|---|---|---|
| Janela e eventos | Wayland / X11 | Win32 | Cocoa (AppKit) |
| Texto | FreeType + HarfBuzz + fontconfig | DirectWrite | CoreText |
| GPU | GLES2 via EGL | GL 2.1 via WGL | GL 2.1 via CGL, depois Metal |
| Ritmo de frames | frame callback / timerfd | `DwmFlush` | `CVDisplayLink` |
| Área de transferência | wl_data_device / seleções X11 | `CF_UNICODETEXT` | `NSPasteboard` |
| HEIC/AVIF | libheif (dlopen) | WIC | ImageIO |
| Compilação | `cc` + pkg-config | mingw-w64 (cross-compile no Linux) | clang + frameworks (no Mac/CI) |

A regra 1 continua valendo nos três: só bibliotecas do sistema.

## Etapa 1: preparar o contrato (no Linux, ~1 semana)

O objetivo é que tudo que depende de SO saia do `core/` sem mudar nenhum pixel.

### 1.1 Texto atrás do contrato

- `core/text.c` fica só com o atlas, os caches de glifos e de tamanhos e o laço de `measure`/`draw`.
- FreeType e HarfBuzz vão para `platform/linux/text.c`.
- O contrato ganha uma seção de texto:

  ```c
  nb_font *nb_platform_font_open(int font, int px, float *ascent, float *descent);
  void     nb_platform_font_close(nb_font *f);
  unsigned nb_platform_text_shape(nb_font *f, const char *utf8, nb_shaped_glyph *out, unsigned cap);
  bool     nb_platform_glyph_raster(nb_font *f, uint16_t face, uint32_t glyph, nb_glyph_bitmap *out);
  ```

  - `face` prepara o fallback de fonte. A chave do cache de glifos passa a incluir a face.
  - `nb_platform_font_path` sai do contrato e vira detalhe interno do Linux. CoreText e
    DirectWrite não trabalham com caminho de arquivo.

### 1.2 GL atrás de um header próprio

- `native/include/nb_gl.h`:
  - no Linux, inclui `<GLES2/gl2.h>`;
  - nos outros SOs, declara uns 30 ponteiros de função, carregados por `nb_platform_gl_proc(name)`.
- Shader: o `precision` vai para dentro de `#ifdef GL_ES`, porque o GLSL 1.10/1.20 desktop
  não aceita.

### 1.3 Escala fracionária no contrato

- `scale` passa de `int` para `float` em `nb_event`, `begin_frame` e `nb_platform_scale`.
- O Linux continua mandando inteiros por enquanto. O suporte de verdade vem na etapa 3.

### 1.4 Informação da plataforma para o TS

- O evento `configure` ganha `platform: "linux" | "win32" | "darwin"`, ou o addon exporta uma
  constante.
- O TS usa essa informação para:
  - **Modificador principal:** Ctrl no Linux e no Windows, Cmd no macOS. Hoje
    `runtime/input.ts`, o `TextField` e o `<Text selectable>` testam `ctrl` direto; esses
    pontos passam a usar `primary`.
  - **Decoração da `<Window>`:** no Mac, os botões nativos (os "semáforos"
    vermelho/amarelo/verde) ficam à esquerda e a `<Window>` não desenha os próprios. Nos
    outros SOs, nada muda.

### Verificação (TDD)

- **Testes primeiro:**
  - `primary` mapeado conforme a plataforma: `test/input`, com host falso.
  - Layout e pintura a 1,25 e 1,5, com retângulos caindo em pixel inteiro: `test/core` e
    `test/draw`.
- **Sem regressão visual:** captura de counter, todo, icons e charts antes e depois. O
  `magick compare -metric AE` precisa dar **0**.
- **Desempenho:** `bench:dashboard` com `NB_STATS=1`, antes e depois na mesma sessão. O
  shaping agora atravessa o contrato, e a diferença precisa ficar no ruído.
- **Fechamento:** `bun run build:native && bun run typecheck && bun test`.
- **Docs:**
  - AGENTS.md: a fronteira do `core/` deixa de incluir FreeType/HarfBuzz, e a tabela
    "Princípio" acima entra no arquivo.
  - ARCHITECTURE: a seção de texto.

## Etapa 2: Windows x64 (~4 semanas)

### 2.0 Fase de risco (2 a 3 dias): decide se o resto vale

1. **N-API:** o addon cross-compilado precisa carregar em `bun.exe`, em `node.exe` e no
   executável compilado (`meuapp.exe`).
   - O caminho normal é o delay-load hook, que redireciona para o processo hospedeiro.
   - Plano B: resolver cada `napi_*` com `GetProcAddress(GetModuleHandle(NULL), …)`.
2. **Janela:** uma janela com `glClear` animado.
3. **DirectWrite em C:** os headers C do `dwrite.h` do mingw-w64 precisam servir. Se não
   servirem, o plano B é um único `text.cpp`.
4. **Executável compilado:** o
   `bun build --compile --target=bun-windows-x64 --windows-hide-console` precisa embutir o
   `.node`.

### 2.1 Backend (`native/platform/windows/`, ~1,5 semana)

| Arquivo | Conteúdo |
|---|---|
| `windows.c` | janela, `WndProc`, cursor, título, mover, redimensionar, maximizar, minimizar |
| `pump.c` | thread de UI, fila de eventos com mutex, thread de ritmo |
| `gl.c` | contexto WGL, `nb_platform_gl_proc` via `wglGetProcAddress` |
| `text.c` | DirectWrite |
| `clipboard.c` | `CF_UNICODETEXT`, UTF-16 ↔ UTF-8 |
| `codecs.c` | HEIC/AVIF via WIC (falha com mensagem clara sem as extensões da Store) |
| `keys.c` | tabela VK → nomes de keysym do xkb, para o TS não mudar |
| `build.sh` | mingw-w64; libs `user32 gdi32 opengl32 dwmapi dwrite windowscodecs ole32 shell32` |

**Threads**

- O `open` cria uma thread de UI dona do HWND, que roda o `GetMessage`.
- O `WndProc` traduz as mensagens para `nb_event` e as enfileira. Quando a fila deixa de
  estar vazia, chama `wake()`.
- O `pump_process`, na thread do JS, esvazia a fila com `nb_push_event`.
- Comandos do JS (cursor, mover, maximizar…) viram `PostMessage` para a thread de UI.
- O GL fica corrente na thread do JS, que desenha no HDC da janela.

**Ritmo de frames**

- `wglSwapIntervalEXT(0)`, para o `SwapBuffers` não bloquear o JS.
- Uma thread de ritmo chama `DwmFlush()` e emite `NB_EV_FRAME` quando há frame pedido.
- Se a medição mostrar perda de vblanks, a alternativa é `D3DKMTWaitForVerticalBlankEvent`.

**Janela sem moldura com comportamento nativo**

- `WS_OVERLAPPEDWINDOW` com `WM_NCCALCSIZE` devolvendo 0. Mantém snap, animações e os cantos
  arredondados do Windows 11 (`DWMWA_WINDOW_CORNER_PREFERENCE`).
- `transparent=false`.
- Mover: `WM_SYSCOMMAND` com `SC_MOVE|HTCAPTION`. Redimensionar: `SC_SIZE` com a borda vinda
  de `NB_EDGE_*`.

**Entrada**

- Mouse:
  - `TrackMouseEvent` para o "leave".
  - `SetCapture` durante o arrasto.
  - A roda é convertida para a unidade e o sentido do Wayland.
- Teclado:
  - O texto vem do `WM_CHAR` (o `TranslateMessage` já trata teclas mortas).
  - O `WM_CHAR` é juntado ao `KEY_DOWN` que o gerou, porque no Linux texto e tecla chegam no
    mesmo evento.

**Texto (DirectWrite)**

- `IDWriteTextLayout` com um `IDWriteTextRenderer` próprio que só coleta os glifos. Isso traz
  fallback de fonte e emojis (monocromáticos na primeira versão).
- Rasterização em tons de cinza com `CreateGlyphRunAnalysis`.
- Fonte da interface: Segoe UI (no Windows 11, Segoe UI Variable quando existir).

**DPI e escala**

- `SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)` e `WM_DPICHANGED`, usando o retângulo
  sugerido.
- A escala `dpi/96` é fracionária e já chega ao TS assim (a etapa 3 cuida do arredondamento).

**`app_id`:** vira o `AppUserModelID`.

### 2.2 TS e distribuição (~1 semana)

- `scripts/build-native.sh`: `PLATFORM=win32`, para cross-compile.
- `native.ts`: `case "win32-x64"`, com os dois `require` literais.
- Pacote `packages/win32-x64` (`os: ["win32"]`), em `optionalDependencies` do core.
- `nodebuilder package --targets exe,zip`:
  - executável portátil com ícone, metadados e `--windows-hide-console`;
  - `.zip` com o executável.
- **Instalador (MSIX/MSI):** depois do `.zip`, escrito à mão como o RPM.
- **Assinatura:** sem certificado, o SmartScreen avisa. Fica documentado no README.
- **`npm:build` / `npm:publish`:** passam a incluir o `@nodebuilderjs/win32-x64`, compilado
  no CI.

### 2.3 Verificação

| O quê | Como |
|---|---|
| Suíte completa | CI `windows-latest`: `bun run typecheck && bun test` |
| Tabela VK → keysym, conversões UTF-16 | teste via `loadNative()` com `test.skipIf(process.platform !== "win32")` |
| Visual | todos os exemplos no Windows 10 e 11, a 100%, 125% e 150%, com captura |
| Teclado real | acentos e teclas mortas em layout ABNT2 e US-International, digitando |
| Desempenho | `bench` e `bench:dashboard` com `NB_STATS=1`, comparados com o Linux na mesma máquina, se possível |
| Pacote | `.zip` extraído numa máquina limpa, fora do repositório |

## Etapa 3: escala fracionária de verdade (3 a 5 dias, Windows e Linux)

- **TS:**
  - bordas, linhas e clips arredondados para o pixel físico;
  - texto rasterizado em `round(px * scale)`;
  - ícones e SVG na escala real.
- **Linux:**
  - Wayland: `wp-fractional-scale-v1` com `wp-viewporter`, o que acaba com o "KDE 125%
    renderiza em 2x e reduz";
  - X11: `Xft.dpi / 96` sem arredondar.
- **Testes:** os da etapa 1.3, agora com os valores vindos de verdade.

## Etapa 4: macOS arm64 e x64 (~5 a 6 semanas)

### 4.0 Fase de risco (3 a 5 dias)

1. **Loop de eventos na thread do JS.**
   - O AppKit exige a thread principal, que é a do JS. Não dá para rodar `[NSApp run]` nem ter
     uma thread de UI separada.
   - Proposta:
     - uma thread de `CVDisplayLink` chama `wake()` a cada vsync enquanto há frame pedido ou a
       janela tem foco;
     - o `pump_process` esvazia a fila com `nextEventMatchingMask:…untilDate:distantPast`;
     - com a janela ociosa, o ritmo cai (por exemplo, para 20 Hz), e um observer de
       `NSWindow` acelera de novo quando a janela recebe foco.
   - **Medir:** uso de CPU com a janela parada e latência de entrada.
2. **Loops modais:** menus e redimensionamento nativo prendem a thread principal. O JS para
   durante o arrasto, então é preciso decidir se o conteúdo congela ou se o tamanho é
   desenhado ao soltar.
3. **N-API:** o addon carrega no Bun, no Node e no executável compilado
   (`-undefined dynamic_lookup`).

### 4.1 Backend (`native/platform/darwin/`, Objective-C)

| Arquivo | Conteúdo |
|---|---|
| `window.m` | `NSWindow` com `fullSizeContentView` e barra de título transparente; botões nativos; foco; cursor (`NSCursor`); maximizar (zoom ou tela cheia); minimizar |
| `view.m` | `NSView` com `NSTextInputClient` (teclas mortas e, no futuro, IME), mouse, roda (rolagem precisa do trackpad), mapeamento keyCode → keysym |
| `pump.m` | `CVDisplayLink`, drenagem de eventos |
| `gl.m` | `NSOpenGLContext` legado 2.1 com `nb_platform_gl_proc` (primeira versão) |
| `text.m` | CoreText: `CTFontCreateUIFontForLanguage` (SF Pro), `CTLine` para shaping e fallback, `CGBitmapContext` em tons de cinza para o glifo |
| `clipboard.m` | `NSPasteboard`, síncrono |
| `codecs.m` | ImageIO (HEIC; AVIF no macOS 13+) |
| `build.sh` | clang, `-framework AppKit CoreText CoreGraphics ImageIO QuartzCore OpenGL` |

**Decisões específicas do Mac**

- **Janela:** a `<Window>` usa os botões nativos, deixando um recuo à esquerda informado pelo
  addon.
- **Mover e redimensionar:**
  - `move()` vira `performWindowDragWithEvent:`;
  - as bordas de redimensionar são do próprio sistema, então `resize()` não faz nada.
- **Escala:** `backingScaleFactor` (1 ou 2).
- **Modificador principal:** Cmd, conforme a etapa 1.4.

### 4.2 Renderer Metal (~1,5 semana, depois do GL funcionar)

- `core/render_metal.m`, com a mesma interface `nb_render_*` e a mesma lógica do
  `render_gles2.c`: um shader, um formato de vértice, um batch.
- O shader é reescrito em MSL e desenha num `CAMetalLayer`.
- O GL fica como alternativa até o Metal passar nas mesmas capturas.

### 4.3 TS e distribuição

- `native.ts`: casos `darwin-arm64` e `darwin-x64`.
- Pacotes `@nodebuilderjs/darwin-arm64` e `@nodebuilderjs/darwin-x64`, compilados em runners
  `macos-*`. Não há cross-compile a partir do Linux.
- `nodebuilder package --targets app,dmg,zip`:
  - `.app` com `Info.plist` e `.icns` gerado do SVG;
  - `.dmg` só no Mac (`hdiutil`), `.zip` em qualquer SO.
- **Assinatura ad-hoc**, obrigatória no arm64: precisa confirmar se o `bun build --compile` já
  faz.
- **Notarização:** precisa de uma conta Apple Developer (US$ 99/ano). Sem ela, o Gatekeeper
  bloqueia na primeira abertura.

### 4.4 Verificação

| O quê | Como |
|---|---|
| Suíte completa | CI `macos-latest`, nas duas arquiteturas se possível |
| Visual | exemplos com GL e depois com Metal, capturados (`screencapture -l <janela>`) |
| Teclado real | acentos e teclas mortas no layout ABNT2 do Mac |
| Ociosidade | CPU com a janela parada, comparada com o Linux |
| Pacote | `.app` aberto numa máquina sem o repositório |

## Etapa 5: acabamento (contínuo)

- **Linux:** fallback de fonte via fontconfig, o que resolve os emojis no Linux também.
- **Emojis coloridos** nos três SOs: precisa de um atlas RGBA além do alfa. Muda o renderer.
- **Windows:**
  - Snap Layouts do Windows 11: `HTMAXBUTTON` sobre o botão maximizar da `<Window>`, o que
    exige que o TS informe a região do botão;
  - fallback para máquinas sem GL 2.1 (VM, área de trabalho remota): ANGLE ou
    `render_d3d11.c`.
- **Mac:** IME via `NSTextInputClient`, que já fica pronto para isso.
- **arm64:** Windows ARM e Linux ARM, quando houver CI.

## Cronograma

| Etapa | Duração | Depende de |
|---|---|---|
| 1. Contrato (Linux) | ~1 semana | — |
| 2. Windows | ~4 semanas | 1 |
| 3. Escala fracionária | 3–5 dias | 1 (melhor depois da 2, para testar com 125%/150% reais) |
| 4. macOS | ~5–6 semanas | 1 |
| 5. Acabamento | contínuo | — |

**Total até os três SOs: cerca de 11 a 13 semanas** de trabalho focado. As fases de risco
(2.0 e 4.0) podem encurtar ou cancelar o resto.

## Decisões em aberto

1. **Máquinas de teste:** há acesso a um Windows e a um Mac, físicos ou VM? O CI cobre os
   testes automáticos, mas a verificação visual e a do teclado precisam de uma máquina de
   verdade.
2. **Certificados:** fazer a assinatura no Windows e a notarização no Mac agora ou deixar para
   depois? Sem elas, o usuário final vê avisos.
3. **Ordem:** Windows antes do Mac, como no plano, ou o contrário?
4. **Mac:** começar pelo GL legado, mais rápido de colocar de pé, ou ir direto para o Metal?
