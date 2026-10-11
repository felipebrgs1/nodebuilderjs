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
- **Widgets prontos:** `Window`, `Column`, `Row`, `Scroll`, `Text`, `Image`, `Button`,
  `TextField`, `Checkbox`, `Card`, `Divider`, `Spacer`, além de `<For>` e `<Show>` para listas
  e condições.

Exemplos completos em [`examples/`](examples): contador, lista de tarefas, imagens e um painel
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
esses formatos dão erro, e os pacotes gerados a sugerem sem obrigar. SVG ainda não.

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
- Texto sem quebra de linha e com uma fonte só (emojis não aparecem).
- Campo de texto sem seleção, área de transferência e desfazer.
- Imagens: sem SVG (no roadmap); AVIF/HEIC dependem da `libheif` do sistema.
- Sem animações, tema escuro, acessibilidade e IME (teclados de idiomas asiáticos).

## Contribuir

```sh
git clone https://github.com/felipebrgs1/nodebuilderjs && cd nodebuilderjs
bun install
bun run build:native     # compila o núcleo em C (precisa dos headers de Wayland, X11, EGL...)
bun run counter          # roda um exemplo
bun test && bun run typecheck
```

[ARCHITECTURE.md](ARCHITECTURE.md) explica como o framework é organizado por dentro, e o
[AGENTS.md](AGENTS.md) traz as regras e convenções do projeto.

## Licença

[MIT](LICENSE)
