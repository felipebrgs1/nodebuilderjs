# Changelog

## 0.2.0 (2026-10-11)

### Novidades
- **Imagens:** widget `<Image>` com `fit` (`contain`, `cover`, `fill`), cantos e opacidade.
  PNG, JPEG e WebP decodificados em TypeScript (idênticos a libpng, libjpeg-turbo e libwebp);
  AVIF e HEIC pela `libheif` do sistema, opcional.
- **Ícones:** widget `<Icon>` com um renderizador de SVG próprio, para Lucide
  (`lucide-static` ou `lucide`) e Phosphor (`@phosphor-icons/core`). A cor é herdada como a
  do texto e aplicada na GPU.
- **Desenho livre:** widget `<Canvas draw={(g) => ...}>` com linhas, polígonos, círculos,
  arcos e texto, desenhados pela GPU com antialiasing.
- **Gráficos:** `@nodebuilderjs/core/charts`, com API no formato do Recharts: `LineChart`,
  `AreaChart`, `BarChart`, `ComposedChart` e `PieChart`, com eixos, grade, legenda, tooltip,
  empilhamento, linhas tracejadas e rótulos. Não pesa nada em apps que não o importam.
- **Eventos:** `onPointerMove`; eventos de ponteiro ganham `localX`/`localY` (relativos ao
  nó), e arrastar continua chegando ao nó onde o clique começou.
- **Testes de apps:** `interact(root)` em `@nodebuilderjs/core/testing` simula mouse e
  teclado sem janela (`hover`, `press`, `drag`, `scroll`, `key`, `type`).
- **Apps criados com `bun create nodebuilderjs`** vêm com skills para agentes
  (`.agents/skills/`, com links em `.claude/skills/`).

### Desempenho
- Culling: o que está fora da área visível de um `Scroll` não é posicionado, pintado nem
  testado no clique. Tabela de 500 linhas: de 78 para 104 fps com teto de 120.
- Medidas de texto guardadas por nó: "1 texto muda entre 1000" caiu de 39% para 23% de CPU.

### Mudanças que podem afetar seu código
- `PointerEvent` tem os campos novos `localX` e `localY`, e a interface `Painter` tem os
  métodos novos `image`, `line`, `triangles` e `arc`. Só afeta quem cria esses objetos à mão.
- Os arquivos de `src/` foram organizados em pastas (`render/`, `widgets/`...). As entradas
  públicas (`@nodebuilderjs/core`, `/jsx-runtime`, `/testing`) não mudaram; caminhos internos
  como `@nodebuilderjs/core/src/...` mudaram.

### Correções
- `click()` de `@nodebuilderjs/core/testing` mandava o botão do meio; agora manda o esquerdo.

## 0.1.1 (2026-10-11)

Primeira versão publicada: reatividade estilo SolidJS, layout flexbox, widgets básicos,
núcleo nativo Wayland/X11 com OpenGL ES 2, `bun create nodebuilderjs` e `nodebuilder package`
(AppImage, `.deb`, `.rpm`, `.tar.gz`).
