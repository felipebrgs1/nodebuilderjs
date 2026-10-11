---
name: nodebuilder-imagens
description: Mostrar imagens (PNG, JPEG, WebP, AVIF, HEIC) com o widget Image do nodebuilder e incluir os arquivos no app empacotado. Use ao adicionar fotos, logos, avatares, miniaturas ou qualquer arquivo de imagem à interface. Para ícones e SVG, use a skill nodebuilder-icones.
---

# Imagens

```tsx
import { Image } from "@nodebuilderjs/core";
import logo from "./assets/logo.png" with { type: "file" };

<Image src={logo} width={64} />                       // altura segue a proporção
<Image src={foto} width={200} height={120} fit="cover" radius={12} />
<Image src={() => avatarDe(usuario())} width={32} height={32} radius={16} opacity={0.9} />
```

## Regras

- **Importe arquivos com `with { type: "file" }`.** O import vira o caminho do arquivo, e o
  `nodebuilder package` embute a imagem no executável. `new URL("./x.png", import.meta.url)`
  e caminhos soltos funcionam no `bun run dev`, mas **quebram no app empacotado**.
- `src` aceita: caminho (relativo ao diretório atual), `URL` `file:`, bytes do arquivo
  (`Uint8Array`, ex.: de um `fetch`) ou pixels `{ width, height, data }` (RGBA 8 bits).
  Pode ser uma função: trocar o `src` libera a imagem antiga.
- Tamanho: sem `width`/`height`, usa os pixels do arquivo (1 pixel = 1 px lógico). Com só um
  dos dois, o outro segue a proporção. Para telas HiDPI, use um arquivo 2x maior e fixe o
  tamanho (`width={64}` para um PNG de 128 px).
- `fit`: `contain` (padrão, imagem inteira centralizada), `cover` (preenche e corta), `fill`
  (estica). `radius` arredonda; `opacity` vai de 0 a 1.
- O mesmo arquivo em vários lugares é decodificado uma vez; a memória é liberada quando o
  último `Image` sai da tela.
- Arquivo que não carrega: aviso no console e nada desenhado (o app não quebra).

## Formatos

| Formato | Como | Observação |
|---|---|---|
| PNG, JPEG, WebP | decodificados em TypeScript | sempre funcionam; JPEG respeita a orientação do EXIF |
| AVIF, HEIC | biblioteca do sistema `libheif` | sem ela, só esses dão erro ("needs libheif"); o pacote `.deb`/`.rpm` a sugere, mas não instala. Prefira WebP/PNG/JPEG para imagens do próprio app |
| SVG | pelo widget `Icon` (skill `nodebuilder-icones`) | subconjunto para ícones; ilustrações com gradiente/texto: exporte PNG 2x |
| GIF animado, vídeo | não suportado | |

## Cuidados

- A decodificação é síncrona: uma foto de 4 megapixels leva ~0,1 s e trava a interface
  nesse meio-tempo. Reduza imagens grandes antes de colocar no app (ex.: miniaturas).
- Imagens muito reduzidas na tela ficam serrilhadas (sem mipmaps): use arquivos perto do
  tamanho exibido.
- Em `bun test`, `Image` funciona sem janela (as texturas são simuladas); AVIF/HEIC
  precisam do addon nativo e da libheif.
