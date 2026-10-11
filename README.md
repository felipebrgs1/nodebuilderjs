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

Mesma cena feita em nodebuilder e em Electron 44 com DOM puro (sem framework), na mesma
máquina: i7-12700H, Intel Iris Xe, KDE Plasma (Wayland), teto de 120 fps.

**App realista** ([`examples/dashboard.tsx`](examples/dashboard.tsx): barra lateral, abas,
gráfico, tabela de 500 linhas e logs ao vivo):

| Aba | Electron | nodebuilder |
|---|---|---|
| Visão geral | 117 fps · 69% CPU · 362 MB | 105 fps · **37% CPU · 99 MB** |
| Tabela com 500 linhas | 116 fps · 82% CPU · 376 MB | 81 fps · 83% CPU · **173 MB** |
| Logs ao vivo | 102 fps · 153% CPU · 452 MB | 108 fps · **70% CPU · 180 MB** |
| Configurações | 115 fps · 60% CPU · 306 MB | 108 fps · **23% CPU · 91 MB** |

**Teste de estresse** ([`examples/bench.tsx`](examples/bench.tsx): grade de células de texto):

| Cenário | Electron | nodebuilder |
|---|---|---|
| 1000 células, parado | 0,2% CPU · 323 MB | 0,3% CPU · **122 MB** |
| 1000 células, todas mudando | 111 fps · 237% CPU · 439 MB | 104 fps · **65% CPU · 192 MB** |
| 3000 células, todas mudando | 49 fps · 176% CPU · 461 MB | 49 fps · **94% CPU · 244 MB** |

Memória é PSS somado de todos os processos; CPU de 100% equivale a um núcleo inteiro.

Onde ainda perdemos: listas longas. Hoje o nodebuilder calcula e desenha também o que está
fora da tela, e é a primeira coisa no [roadmap](ROADMAP.md). Para reproduzir as medições,
veja [ARCHITECTURE.md](ARCHITECTURE.md#medindo-desempenho).

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
