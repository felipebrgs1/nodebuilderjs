# Roadmap

Para onde o nodebuilder vai. A ordem dentro de cada seção é a prioridade atual; não há
datas. Sugestões e discussão em [issues](https://github.com/felipebrgs1/nodebuilderjs/issues).

## Já existe (0.1)

- Reatividade estilo SolidJS (signals, memos, effects, ownership), JSX próprio, `<For>` e `<Show>`
- Layout flexbox, rolagem, recorte com cantos arredondados, sombras
- Widgets: `Window` com decoração própria, `Column`/`Row`/`Box`, `Scroll`, `Text`, `Image`
  (PNG), `Button`, `TextField`, `Checkbox`, `Card`, `Divider`, `Spacer`
- Núcleo nativo próprio: Wayland e X11 (escolhidos em tempo de execução), OpenGL ES 2,
  HarfBuzz + FreeType, teclas mortas e acentos, escala inteira (HiDPI)
- Roda no Bun e no Node
- `bun create nodebuilderjs`, helpers de teste sem janela, `AGENTS.md` no template
- `nodebuilder package`: AppImage, `.deb`, `.rpm` e `.tar.gz` (glibc 2.34+)
- Benchmarks contra Electron, Tauri, Flutter e egui com as mesmas cenas

## Onde estamos (benchmarks de 2026-10-11)

Números completos no [README](README.md#benchmarks). Resumo, com teto de 60 fps:

| | Situação | O que fazer |
|---|---|---|
| Memória parado e em telas leves | **a menor dos cinco** (81–91 MB) | manter |
| CPU com muitos textos mudando | a menor com 1000 textos (44%); egui gasta menos com 3000 (84% contra 94%) | manter e melhorar |
| Lista longa (tabela de 500 linhas) | era o pior fps (49, contra 54–59); com culling, 104 fps com teto de 120 (era 78) | lista virtualizada |
| Um texto mudando entre 1000 | 39% de CPU; 23% depois do culling, ainda longe de proporcional | trabalho proporcional ao que mudou |
| Ritmo de frames | 55–58 fps em telas leves (egui e Electron: 59–60); com teto de 120, de 91 a 111 fps entre rodadas | agendamento de frames |
| Memória sob carga | 157–194 MB (egui: 108–128) | menos alocação por nó e por frame |
| Tamanho do executável | ~91 MB (~31 MB compactado), quase tudo é o runtime do Bun | investigar |

O que não pode se perder: menor memória em uso normal, CPU baixa quando muito texto muda,
120 fps quando o monitor permite (Tauri e Flutter param em 60 no Linux) e escrever tudo
em TypeScript.

## 1. Desempenho

Cada item tem uma meta medida com as mesmas cenas (`examples/bench.tsx` e
`examples/dashboard.tsx`) e o mesmo método do README. Detalhes técnicos dos gargalos no
[AGENTS.md](AGENTS.md#performance).

1. ~~**Culling:**~~ **feito.** Layout, pintura e clique ignoram o que está fora da área
   visível de um `Scroll` (ou de qualquer nó que recorte). Resultado, antes → depois na mesma
   sessão: tabela de 500 linhas com teto de 120, 78 → 104 fps e 82% → 51% de CPU; com teto de
   60, 55% → 40% de CPU, mas 48 → 53 fps: o trabalho por frame caiu para ~3,5 ms e o que
   falta é o agendamento (item 4), que limita também as telas leves (51–54 fps nessa sessão).
   O tamanho natural de todas as linhas ainda é calculado todo frame (~2,5 ms), o que fica
   para os itens 2 e 3.
2. **Lista virtualizada** (`<VirtualFor>` ou `VirtualList`): criar só os nós das linhas
   visíveis, como o `ListView.builder` do Flutter, para listas de milhares de itens. *Meta:
   10 mil linhas com o mesmo custo de 50.*
3. **Trabalho proporcional ao que mudou:**
   - layout incremental: recalcular só os nós marcados como sujos e seus ancestrais;
   - cache de shaping no C: hoje o HarfBuzz refaz o shaping de todo texto a cada frame;
   - desenho parcial: redesenhar só a região que mudou (`EGL_KHR_partial_update`).

   *Meta: "1 texto muda entre 1000" abaixo de 10% de CPU (hoje 39%).*
4. **Ritmo de frames estável:** descobrir por que o agendamento perde vblanks (aviso do
   compositor → thread → `setImmediate` → frame) e por que o fps oscila entre rodadas.
   Começar medindo a distribuição do tempo entre frames. *Meta: 59–60 fps estáveis com teto
   de 60 nas telas leves, como egui e Electron.*
5. **Memória sob carga:** menos objetos por nó e por propriedade reativa, command buffer sem
   alocação por chamada, e revisar o cache de medidas de texto. Suspeita a confirmar: quando
   muitos textos mudam, o cache chega ao limite de 20 mil entradas, é esvaziado e tudo é
   medido de novo pelo C. *Meta: ≤ 130 MB nas cenas do painel (hoje até 166 MB).*
6. Em notebooks com GPU híbrida, evitar carregar as bibliotecas da NVIDIA sem usá-las (+38 MB).
7. **Tamanho do executável:** ver o que dá para reduzir no runtime do Bun embutido (~90 MB).

## 2. Solidificar

O que garante que as melhorias acima não regridam e que o projeto aguente mais usuários.

- **Benchmark automatizado:** transformar a rodada usada no README num script do
  repositório, com 3 repetições por cena, mediana, saída em JSON e comparação com a última
  rodada salva. Rodar antes de cada versão.
- **Teste de desempenho sem janela:** no `bun test`, montar o painel com métricas falsas e
  verificar o tempo de layout e pintura e quantos nós são pintados (ex.: com culling, a
  tabela só pinta as linhas visíveis). Pega regressões sem precisar de GPU.
- **CI no GitHub Actions:** typecheck, testes e build do núcleo nativo no container Ubuntu
  22.04 a cada push; gerar os pacotes npm e os binários no CI (a publicação continua com
  aprovação manual, como o npm exige).
- **Teste com janela de verdade no CI:** abrir um app num compositor headless (Weston) e
  conferir que um frame é desenhado, nos backends Wayland e X11.
- **Testar o que ainda não foi testado:** sessão X11 pura (não XWayland), X11 sem compositor,
  outras GPUs (AMD, NVIDIA) e outros compositores (GNOME/Mutter, Sway).
- **Estabilizar a API para a 1.0:** revisar nomes e props dos widgets, escrever a referência
  da API e melhorar as mensagens de erro (props inválidas, uso fora de um componente).

## Texto e entrada

- Quebra de linha e texto com várias linhas
- Fallback de fontes (emojis, CJK) e escolha de família de fonte
- `TextField`: seleção, área de transferência, desfazer/refazer, campo de várias linhas
- IME (`text-input-v3`) para teclados de idiomas asiáticos

## Widgets e visual

- Imagens: PNG já funciona (`<Image>` com `fit`, cantos e opacidade). Falta: JPEG
  (decodificador próprio ou `libjpeg-turbo` do sistema), SVG para ícones, decodificar fora
  da thread do JS, mipmaps para imagens muito reduzidas e versões @2x para HiDPI
- Animações e transições
- Tema escuro, seguindo a preferência do sistema
- Novos widgets: slider, seleção (dropdown), abas, tooltip, diálogo modal, menu de contexto

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
- Flatpak e metadados AppStream (para aparecer nas lojas de apps)
- Pacotes assinados (GPG)

## Outros sistemas

- Windows e macOS: implementar o contrato `native/include/nb_platform.h` em
  `native/platform/<os>/`, com ANGLE para o OpenGL ES (ver
  [ARCHITECTURE.md](ARCHITECTURE.md#portabilidade-para-outros-sistemas))

## Ferramentas

- Inspetor da árvore de nós e do layout com o app rodando
- Recarregar ao salvar mantendo o estado (hoje o `bun --watch` reinicia o app)
