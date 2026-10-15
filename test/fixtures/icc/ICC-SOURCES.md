# Color profile fixtures

All made for these tests (no third-party files). The pixels are the same 4x2 RGBA image in
every file: red, green, blue, (128,64,32), (10,200,90), white, black, (200,100,50) at alpha 128.
The ICC profiles were written by `writeIcc` (`src/image/icc.ts`): Display P3, and Adobe RGB
(1998) primaries with a 563/256 gamma. LittleCMS 2.19 reads them; the reference values in
`test/image/icc.test.ts` come from `transicc -t 1 -n` (relative colorimetric) with them.

| File | Made with |
|---|---|
| `png-plain.png` | `magick -size 4x2 -depth 8 rgba:in.rgba png-plain.png` (ImageMagick 7.1.2-32) |
| `png-p3-iccp.png` | the same with `-profile p3.icc` (assigns the profile: the input has none) |
| `png-adobe-iccp.png` | the same with `-profile adobe.icc` |
| `jpeg-p3-icc.jpg` | `magick ... -alpha off -scale 400% -profile p3.icc -quality 100` |
| `webp-p3-iccp.webp` | `magick ... -profile p3.icc -define webp:lossless=true` |
| `avif-p3-nclx.avif` | `avifenc -l --cicp 12/13/0 png-plain.png` (libavif 1.4.2) |
| `heic-p3-icc.heic` | `heif-enc -L png-p3-iccp.png` (libheif 1.23.6; carries the PNG's profile) |

The tests build the rest themselves: a PNG with a cICP chunk, and a JPEG whose ICC profile is
split across APP2 segments (a multi-segment profile is over 64 KB, too big for a fixture).
