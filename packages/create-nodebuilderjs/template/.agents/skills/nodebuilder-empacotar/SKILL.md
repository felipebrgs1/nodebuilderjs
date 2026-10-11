---
name: nodebuilder-empacotar
description: Gerar e distribuir o app nodebuilder (AppImage, .deb, .rpm, .tar.gz) com nodebuilder package, incluir arquivos (imagens, dados) no executável e configurar nome, ícone e app id. Use ao preparar uma versão para instalar, ao mudar o nome/ícone do app ou quando o app empacotado se comporta diferente do bun run dev.
---

# Empacotar

```sh
bun run package        # = nodebuilder package src/main.tsx --title "..." --app-id ...
bunx nodebuilder package src/main.tsx --targets deb,rpm --icon assets/icone.svg --version 1.2.0
bunx nodebuilder package --help
```

Gera em `dist/` um executável único (Bun + app + núcleo nativo, ~31 MB compactado) dentro de
AppImage, `.deb`, `.rpm` e `.tar.gz`, com atalho no menu e ícone. Roda em distros com glibc
2.34+ (Ubuntu 22.04+, Debian 12+, Fedora, RHEL 9+).

## Regras

- **Arquivos do app** (imagens, JSON, sons) entram no executável só se forem importados com
  `with { type: "file" }` (o import vira o caminho). `readFileSync("./dados.json")` com
  caminho solto funciona no dev e **falha no pacote**. Para JSON, `import dados from
  "./dados.json"` também embute.
- O `appId` da `<Window>` precisa ser igual ao `--app-id` (o template já faz isso); senão o
  ícone e o agrupamento na barra de tarefas não funcionam.
- `--icon`: `.svg` ou PNG 256x256. `--name` é o nome do executável/pacote (minúsculas).
- Bibliotecas do sistema (Wayland, X11, EGL, FreeType, HarfBuzz, fontconfig) são
  dependências declaradas dos pacotes, nunca embutidas. `libheif` (só para AVIF/HEIC) é
  apenas sugerida.
- Dados do usuário: salve em `~/.local/share/<app>` (`process.env.XDG_DATA_HOME`), nunca
  ao lado do executável (em `/usr/bin` não dá para escrever).

## Verificar

- Rode o executável gerado fora da pasta do projeto (`cd / && caminho/do/app`) para pegar
  arquivos que só existiam no disco do desenvolvimento.
- AppImage: `chmod +x dist/*.AppImage && ./dist/*.AppImage`.
