# {{title}}

App desktop nativo para Linux feito com [nodebuilder](https://www.npmjs.com/package/@nodebuilderjs/core):
componentes TSX com reatividade estilo SolidJS, desenhados por um núcleo nativo (Wayland/X11 + GLES).

```sh
bun run dev        # abre a janela e reinicia ao salvar
bun start          # roda uma vez
bun test           # testes sem janela (test/)
bun run typecheck  # TypeScript 7
bun run package    # AppImage, .deb, .rpm e .tar.gz em dist/
```

## Estrutura

```
src/
  main.tsx             abre a janela: run(() => <App />)
  App.tsx              layout da tela; cria o estado e o passa aos componentes
  estado.ts            signals e ações do app (contador, tarefas, histórico)
  icones.ts            ícones SVG usados pelo app
  componentes/
    Contador.tsx       botões e texto reativo
    Tarefas.tsx        campo de texto, lista com For/Checkbox, Show
    Atividade.tsx      gráfico (@nodebuilderjs/core/charts) que acompanha o estado
test/
  App.test.tsx         testes sem janela: mount + interact (clicar, digitar)
```

Para apagar o exemplo e começar do zero, deixe só a `<Window>` em `App.tsx`.

Requisitos: Linux com Wayland ou X11, [Bun](https://bun.sh) 1.4+.
