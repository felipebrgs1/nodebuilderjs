# Roadmap

Para onde o nodebuilder vai. A ordem dentro de cada seção é a prioridade atual; não há
datas. Sugestões e discussão em [issues](https://github.com/felipebrgs1/nodebuilderjs/issues).

## Já existe (0.1)

- Reatividade estilo SolidJS (signals, memos, effects, ownership), JSX próprio, `<For>` e `<Show>`
- Layout flexbox, rolagem, recorte com cantos arredondados, sombras
- Widgets: `Window` com decoração própria, `Column`/`Row`/`Box`, `Scroll`, `Text`, `Button`,
  `TextField`, `Checkbox`, `Card`, `Divider`, `Spacer`
- Núcleo nativo próprio: Wayland e X11 (escolhidos em tempo de execução), OpenGL ES 2,
  HarfBuzz + FreeType, teclas mortas e acentos, escala inteira (HiDPI)
- Roda no Bun e no Node
- `bun create nodebuilderjs`, helpers de teste sem janela, `AGENTS.md` no template
- `nodebuilder package`: AppImage, `.deb`, `.rpm` e `.tar.gz` (glibc 2.34+)
- Benchmarks contra Electron, Tauri, Flutter e egui com as mesmas cenas

## Desempenho

O nodebuilder já usa bem menos CPU e memória que o Electron e o Tauri, e fica no nível do egui, mas perde
em listas longas. A ordem abaixo é a dos gargalos medidos (detalhes no
[AGENTS.md](AGENTS.md#performance)).

1. **Culling:** não pintar nem medir o que está fora da área visível. Na tabela de 500 linhas,
   é o que separa os 49 fps do nodebuilder dos 54 a 59 dos outros (teto de 60), e os 80 dos
   116 do Electron (teto de 120).
2. **Layout incremental:** recalcular só os nós marcados como sujos, em vez da árvore toda.
3. **Cache de shaping no C:** hoje o HarfBuzz refaz o shaping de todo texto a cada frame.
4. **Desenho parcial:** redesenhar só a região que mudou (`EGL_KHR_partial_update`).
5. Menos alocação por frame no command buffer.
6. Menos latência entre o aviso do compositor e o início do frame.
7. Em notebooks com GPU híbrida, evitar carregar as bibliotecas da NVIDIA sem usá-las (+38 MB).

## Texto e entrada

- Quebra de linha e texto com várias linhas
- Fallback de fontes (emojis, CJK) e escolha de família de fonte
- `TextField`: seleção, área de transferência, desfazer/refazer, campo de várias linhas
- IME (`text-input-v3`) para teclados de idiomas asiáticos

## Widgets e visual

- Imagens (PNG/JPEG/SVG) e ícones
- Animações e transições
- Tema escuro, seguindo a preferência do sistema
- Novos widgets: slider, seleção (dropdown), abas, tooltip, diálogo modal, menu de contexto
- Lista virtualizada para milhares de itens

## Integração com o desktop

- Acessibilidade (AT-SPI): leitores de tela e navegação por teclado completa
- Escala fracionária real (125%, 150%) no Wayland
- Decoração do sistema quando disponível (`xdg-decoration`, como no KDE)
- Várias janelas por app
- Arrastar e soltar (arquivos e texto)
- Diálogos nativos de arquivo (portal do XDG)
- X11: extensão Present (frames alinhados ao vsync, sem tearing)

## Distribuição

- Linux arm64 (Raspberry Pi, notebooks ARM)
- CI no GitHub Actions para compilar os binários e publicar no npm
- Flatpak e metadados AppStream (para aparecer nas lojas de apps)
- Pacotes assinados (GPG)

## Outros sistemas

- Windows e macOS: implementar o contrato `native/include/nb_platform.h` em
  `native/platform/<os>/`, com ANGLE para o OpenGL ES (ver
  [ARCHITECTURE.md](ARCHITECTURE.md#portabilidade-para-outros-sistemas))

## Ferramentas

- Inspetor da árvore de nós e do layout com o app rodando
- Recarregar ao salvar mantendo o estado (hoje o `bun --watch` reinicia o app)
