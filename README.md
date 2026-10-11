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
- **Widgets prontos:** `Window`, `Column`, `Row`, `Scroll`, `Text`, `Button`, `TextField`,
  `Checkbox`, `Card`, `Divider`, `Spacer`, além de `<For>` e `<Show>` para listas e condições.

Exemplos completos em [`examples/`](examples): contador, lista de tarefas e um painel com
abas, tabela e gráfico.

## Distribuir

```sh
bun run package
```

Gera em `dist/` um **AppImage**, um **`.deb`**, um **`.rpm`** e um **`.tar.gz`**, cada um com
um executável único (Bun + seu app + núcleo nativo), atalho no menu e ícone. Funciona em
Ubuntu 22.04+, Debian 12+, Fedora, RHEL 9+ e derivados.

## Benchmarks

A mesma cena feita três vezes: em nodebuilder, em **Electron 44** e em **Tauri 2**. Nos dois
últimos, o frontend é idêntico (HTML e JavaScript puros, sem framework); muda só o runtime:
Chromium no Electron, o WebKitGTK do sistema no Tauri. Máquina: i7-12700H, Intel Iris Xe,
KDE Plasma (Wayland), monitor de 240 Hz.

O Tauri usa o `requestAnimationFrame` do WebKitGTK, que no Linux não passa de **60 fps**.
Para comparar o mesmo trabalho, a tabela abaixo limita os três a 60 fps.

Cada célula: **fps · CPU · memória**. CPU de 100% é um núcleo inteiro; memória é a PSS
somada de todos os processos do app.

| Cena | Electron | Tauri | nodebuilder |
|---|---|---|---|
| **Painel** ([dashboard.tsx](examples/dashboard.tsx)): visão geral | 59 · 59% · 311 MB | 60 · 71% · 274 MB | 57 · **29% · 87 MB** |
| Painel: tabela com 500 linhas | 59 · 64% · 357 MB | 59 · 64% · 293 MB | 48 · **55% · 155 MB** |
| Painel: logs ao vivo | 59 · 94% · 385 MB | 59 · 143% · 297 MB | 52 · **41% · 139 MB** |
| Painel: configurações | 59 · 44% · 280 MB | 60 · 48% · 263 MB | 58 · **19% · 82 MB** |
| Painel: troca de aba a cada 30 frames | 58 · 66% · 359 MB | 58 · 84% · 322 MB | 52 · **40% · 142 MB** |
| **Grade** ([bench.tsx](examples/bench.tsx)): 1000 células paradas | 0% · 283 MB | 0% · 250 MB | 0,6% · **77 MB** |
| Grade: 1000 células, um texto muda | 59 · 52% · 291 MB | 60 · **37%** · 260 MB | 57 · 40% · **99 MB** |
| Grade: 1000 células, todas mudam | 59 · 123% · 390 MB | 31 · 144% · 316 MB | 57 · **46% · 129 MB** |
| Grade: 3000 células, todas mudam | 51 · 177% · 412 MB | 21 · 122% · 368 MB | 49 · **93% · 199 MB** |

**Em resumo:**
- **Memória:** o nodebuilder usa de 27% a 48% da memória do Electron e de 31% a 54% da do
  Tauri. Parado, ocupa 77 MB, contra 250 MB do Tauri e 283 MB do Electron.
- **CPU:** o nodebuilder gasta menos que o Electron em todas as cenas animadas (de 37% a 86%
  do que ele gasta; em metade delas, menos da metade). O Tauri fica perto do Electron e gasta
  mais nas cenas com muito texto mudando.
- **fps:** o Tauri não sustenta 60 fps quando muitos textos mudam a cada frame (31 e 21 fps).
  Com teto de 120 fps, o Electron fica entre 104 e 118 fps e o nodebuilder entre 77 e 116
  (com 3000 células, 50 fps nos dois).
- **Onde o nodebuilder perde:** listas longas. Ele ainda mede e desenha o que está fora da
  tela (48 fps na tabela de 500 linhas, contra 59 dos outros). É o primeiro item do
  [roadmap](ROADMAP.md).
- **Onde o Tauri ganha:** tamanho. O binário tem 5,7 MB porque usa o WebKit do sistema; o
  executável do nodebuilder tem ~91 MB (~31 MB compactado), e o Electron ~280 MB.

Medido em 2026-10-11. Para reproduzir, veja [ARCHITECTURE.md](ARCHITECTURE.md#medindo-desempenho).

## Limitações atuais

- Só Linux x64 (arm64, Windows e macOS estão no roadmap).
- Texto sem quebra de linha e com uma fonte só (emojis não aparecem).
- Campo de texto sem seleção, área de transferência e desfazer.
- Sem imagens, animações, tema escuro, acessibilidade e IME (teclados de idiomas asiáticos).

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
