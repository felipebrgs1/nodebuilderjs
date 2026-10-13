# Test fonts

Made for these tests with `build.py` (fontTools 4.66.1, `python3 build.py`); same license as
the repository. Every glyph is a box, so advances (1000 units per em: at fontSize 100, one unit
is 0.1 px) and pixels are easy to predict.

| File | Family | Faces | Glyphs (advance) |
|---|---|---|---|
| `NBTest-Regular.ttf` | NB Test | 400 upright | `x` 500, `i` 200, `f` 300, `0` 600, `1` 300, space 250; `liga` (ff 400), `tnum` (1 → 600) |
| `NBTest-Bold.ttf` | NB Test | 700 upright | as Regular, `x` 700 |
| `NBTest-Italic.ttf` | NB Test | 400 italic | as Regular, `x` 600 |
| `NBFallback-Regular.ttf`, `.otf` (CFF), `.woff`, `.woff2` | NB Fallback | 400 upright | `z` 900, `x` 100 |
| `NBVar.ttf` | NB Var | variable: `wght` 100..900 (default 400), `wdth` 50..100 | `x` 500 at the default; 900 at wght 900, 300 at wght 100, 250 narrower at wdth 50 |
| `NBCollection.ttc` | NB Test, NB Fallback | the two Regulars in one collection | |
