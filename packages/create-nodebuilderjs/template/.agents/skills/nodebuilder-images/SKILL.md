---
name: nodebuilder-images
description: Show images (PNG, JPEG, WebP, AVIF, HEIC) with nodebuilder's Image widget and include the files in the packaged app. Use when adding photos, logos, avatars, thumbnails or any image file to the UI. For icons and SVG, use the nodebuilder-icons skill.
---

# Images

```tsx
import { Column, Image, createSignal } from "@nodebuilderjs/core";
import logo from "./assets/logo.png" with { type: "file" };
import photo from "./assets/photo.jpg" with { type: "file" };

const [user] = createSignal({ name: "Ana", avatar: logo });

<Column gap={8}>
  <Image src={logo} width={64} />                     {/* height follows the aspect ratio */}
  <Image src={photo} width={200} height={120} fit="cover" radius={12} />
  <Image src={() => user().avatar} width={32} height={32} radius={16} opacity={0.9} />
</Column>
```

## Rules

- **Import files with `with { type: "file" }`.** The import becomes the file path, and
  `nodebuilder package` embeds the image in the executable. `new URL("./x.png", import.meta.url)`
  and bare paths work in `bun run dev`, but **break in the packaged app**.
- `src` accepts: a path (relative to the current directory), a `file:` `URL`, the file bytes
  (`Uint8Array`, e.g. from a `fetch`) or pixels `{ width, height, data }` (8-bit RGBA).
  It can be a function: changing `src` releases the old image.
- Size: without `width`/`height`, it uses the file's pixels (1 pixel = 1 logical px). With only one
  of the two, the other follows the aspect ratio. For HiDPI screens, use a 2x larger file and fix the
  size (`width={64}` for a 128 px PNG).
- `fit`: `contain` (default, whole image centered), `cover` (fills and crops), `fill`
  (stretches). `radius` rounds the corners; `opacity` goes from 0 to 1.
- The same file used in several places is decoded once; the memory is released when the
  last `Image` leaves the screen.
- A file that fails to load: a warning in the console and nothing drawn (the app does not crash).

## Formats

| Format | How | Notes |
|---|---|---|
| PNG, JPEG, WebP | decoded in TypeScript | always work; JPEG honors the EXIF orientation |
| AVIF, HEIC | `libheif` system library | without it, only these fail ("needs libheif"); the `.deb`/`.rpm` package suggests it but does not install it. Prefer WebP/PNG/JPEG for the app's own images |
| SVG | through the `Icon` widget (skill `nodebuilder-icons`) | subset for icons; illustrations with gradients/text: export a 2x PNG |
| Animated GIF, video | not supported | |

## Caveats

- Decoding is synchronous: a 4-megapixel photo takes ~0.1 s and freezes the UI
  meanwhile. Shrink large images before putting them in the app (e.g. thumbnails).
- Images scaled down a lot on screen look jagged (no mipmaps): use files close to the
  displayed size.
- In `bun test`, `Image` works without a window (textures are simulated); AVIF/HEIC
  need the native addon and libheif.
