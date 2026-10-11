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

Requisitos: Linux com Wayland ou X11, [Bun](https://bun.sh) 1.4+.
