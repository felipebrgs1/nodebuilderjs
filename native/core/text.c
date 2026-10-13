// Text: shaping (HarfBuzz), rasterisation (FreeType) and two glyph atlases shared by every
// font and size: alpha (A8, tinted by the text color) and color (premultiplied RGBA, for
// emoji). Which face draws what is faces.c's call (family lists, app fonts, fallback).
//
// A string is cut into grapheme-ish clusters (a base plus its marks, variation selectors,
// skin tones, ZWJ-joined parts, flag pairs); each cluster goes to one face (the first of the
// style's faces that has the base, else a fallback), consecutive clusters with the same face
// form a run, and each run is shaped with its own font and the style's features. measure and
// draw walk the same runs, so they always agree. ASCII-only strings skip the clustering when
// the first face has all of ASCII.
#include "nb.h"

#include "faces.h"

#include FT_OUTLINE_H
#include <hb-ft.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define ATLAS_SIZE 1024
#define COLOR_ATLAS_SIZE 1024
#define MAX_GLYPH 512     // larger bitmaps are downscaled into the atlas and stretched back when drawn
#define MAX_SIZES 64
#define GLYPH_SLOTS 8192  // power of two
#define MAX_FEATURES 34   // a spec's (faces.c: 32) + the two letter spacing turns off

typedef struct {
  int face, px;
  uint8_t gen;  // the face's generation (nb_face_gen) when opened
  FT_Face ft;
  hb_font_t *hb;
  float bitmap_scale;  // fixed-size (bitmap) fonts: px / strike size; 1 otherwise
  FT_Pos embolden;     // synthetic bold: outline strength (26.6), 0 for none
} sized_font;

typedef struct {
  uint64_t key;
  bool used, color;
  int x, y, w, h;  // atlas rect
  int dw, dh;      // drawn size: w x h unless the bitmap was downscaled to fit
  int left, top;   // bitmap bearing
} glyph_slot;

static sized_font sizes[MAX_SIZES];
static int size_count;
static glyph_slot glyphs[GLYPH_SLOTS];
static uint8_t atlas[ATLAS_SIZE * ATLAS_SIZE];
static uint8_t *color_atlas;  // allocated on the first color glyph
static int shelf_x, shelf_y, shelf_h, cshelf_x, cshelf_y, cshelf_h;
static bool atlas_dirty, color_dirty;
static hb_buffer_t *buffer;

bool nb_text_init(void) {
  if (buffer) return true;
  if (!nb_fonts_init()) return false;
  buffer = hb_buffer_create();
  return true;
}

// ---- sizes ------------------------------------------------------------------------

int nb_text_size_count(void) { return size_count; }

static void close_size(int i) {
  hb_font_destroy(sizes[i].hb);
  FT_Done_Face(sizes[i].ft);
  memmove(&sizes[i], &sizes[i + 1], sizeof(sized_font) * (size_t)(size_count - i - 1));
  size_count--;
}

void nb_text_forget_face(int face) {
  for (int i = size_count - 1; i >= 0; i--)
    if (sizes[i].face == face) close_size(i);
}

static sized_font *get_font(int face, int px) {
  if (face < 0 || face >= NB_MAX_FACES) face = 0;
  if (px < 1) px = 1;
  if (px > 0xFFFF) px = 0xFFFF;  // 16 bits of the glyph cache key
  for (int i = 0; i < size_count; i++)
    if (sizes[i].face == face && sizes[i].px == px) return &sizes[i];

  if (size_count == MAX_SIZES) close_size(0);  // evict the oldest
  FT_Face f = nb_face_open(face);
  if (!f) return NULL;
  hb_font_t *hb;
  float bitmap_scale = 1;
  if (!FT_IS_SCALABLE(f) && f->num_fixed_sizes > 0) {
    // Bitmap font (CBDT/sbix emoji): pick the strike closest to px (the larger on a tie, so
    // glyphs are downscaled), and let HarfBuzz scale the advances from the font's own tables.
    int best = 0;
    for (int i = 1; i < f->num_fixed_sizes; i++) {
      int d = abs((int)(f->available_sizes[i].y_ppem >> 6) - px), bd = abs((int)(f->available_sizes[best].y_ppem >> 6) - px);
      if (d < bd || (d == bd && f->available_sizes[i].y_ppem > f->available_sizes[best].y_ppem)) best = i;
    }
    FT_Select_Size(f, best);
    float strike = f->available_sizes[best].y_ppem / 64.0f;
    bitmap_scale = strike > 0 ? px / strike : 1;
    hb_face_t *hface = hb_ft_face_create_referenced(f);
    hb = hb_font_create(hface);
    hb_face_destroy(hface);
    hb_font_set_scale(hb, px * 64, px * 64);
  } else {
    FT_Set_Pixel_Sizes(f, 0, px);
    hb = hb_ft_font_create_referenced(f);
    hb_ft_font_set_load_flags(hb, FT_LOAD_DEFAULT | FT_LOAD_TARGET_LIGHT);
  }
  // Synthetic bold, as FreeType's FT_GlyphSlot_Embolden: 1/24 em thicker (advances unchanged).
  FT_Pos embolden = nb_face_embolden(face) && FT_IS_SCALABLE(f) ? FT_MulFix(f->units_per_EM, f->size->metrics.y_scale) / 24 : 0;
  sizes[size_count] = (sized_font){.face = face, .px = px, .gen = nb_face_gen(face), .ft = f, .hb = hb, .bitmap_scale = bitmap_scale, .embolden = embolden};
  return &sizes[size_count++];
}

static uint32_t next_codepoint(const unsigned char *s, int len, int *i) {
  unsigned c = s[*i];
  int n = c < 0x80 ? 0 : c >= 0xF0 ? 3 : c >= 0xE0 ? 2 : c >= 0xC0 ? 1 : -1;
  if (n < 0 || *i + n >= len) {  // stray or truncated byte: one replacement character
    (*i)++;
    return 0xFFFD;
  }
  uint32_t cp = n == 0 ? c : c & (0x3F >> n);
  for (int k = 1; k <= n; k++) {
    if ((s[*i + k] & 0xC0) != 0x80) {
      (*i)++;
      return 0xFFFD;
    }
    cp = cp << 6 | (s[*i + k] & 0x3F);
  }
  *i += n + 1;
  return cp;
}

static bool regional_indicator(uint32_t cp) { return cp >= 0x1F1E6 && cp <= 0x1F1FF; }

// Emoji_Presentation=Yes by default (Unicode emoji-data), approximately: the emoji planes,
// plus the BMP ones (the rest of the BMP symbols draw as text unless followed by U+FE0F).
static bool emoji_by_default(uint32_t cp) {
  if (cp >= 0x1F300 && cp <= 0x1FAFF) return true;
  if (cp == 0x1F004 || cp == 0x1F0CF || cp == 0x1F18E || (cp >= 0x1F191 && cp <= 0x1F19A) || regional_indicator(cp)) return true;
  if (cp >= 0x1F201 && cp <= 0x1F251) return true;
  static const uint32_t bmp[][2] = {
      {0x231A, 0x231B}, {0x23E9, 0x23EC}, {0x23F0, 0x23F0}, {0x23F3, 0x23F3}, {0x25FD, 0x25FE}, {0x2614, 0x2615},
      {0x2648, 0x2653}, {0x267F, 0x267F}, {0x2693, 0x2693}, {0x26A1, 0x26A1}, {0x26AA, 0x26AB}, {0x26BD, 0x26BE},
      {0x26C4, 0x26C5}, {0x26CE, 0x26CE}, {0x26D4, 0x26D4}, {0x26EA, 0x26EA}, {0x26F2, 0x26F3}, {0x26F5, 0x26F5},
      {0x26FA, 0x26FA}, {0x26FD, 0x26FD}, {0x2705, 0x2705}, {0x270A, 0x270B}, {0x2728, 0x2728}, {0x274C, 0x274C},
      {0x274E, 0x274E}, {0x2753, 0x2755}, {0x2757, 0x2757}, {0x2795, 0x2797}, {0x27B0, 0x27B0}, {0x27BF, 0x27BF},
      {0x2B1B, 0x2B1C}, {0x2B50, 0x2B50}, {0x2B55, 0x2B55}};
  if (cp < 0x231A || cp > 0x2B55) return false;
  for (size_t i = 0; i < sizeof bmp / sizeof bmp[0]; i++)
    if (cp >= bmp[i][0] && cp <= bmp[i][1]) return true;
  return false;
}

// Joins the previous codepoint's cluster: marks, variation selectors, skin tones, tags.
static bool extends(uint32_t cp) {
  if ((cp >= 0xFE00 && cp <= 0xFE0F) || (cp >= 0x1F3FB && cp <= 0x1F3FF) || (cp >= 0xE0020 && cp <= 0xE007F) ||
      (cp >= 0xE0100 && cp <= 0xE01EF) || cp == 0x200C)
    return true;
  if (cp < 0x300) return false;
  hb_unicode_general_category_t gc = hb_unicode_general_category(hb_unicode_funcs_get_default(), cp);
  return gc == HB_UNICODE_GENERAL_CATEGORY_NON_SPACING_MARK || gc == HB_UNICODE_GENERAL_CATEGORY_SPACING_MARK ||
         gc == HB_UNICODE_GENERAL_CATEGORY_ENCLOSING_MARK;
}

// Ends the cluster starting at byte `start`; returns its end and the face to use.
static int cluster(const unsigned char *s, int len, int start, int style, int primary, int *face) {
  int i = start;
  uint32_t base = next_codepoint(s, len, &i);
  if (base < 0x80 && (i >= len || s[i] < 0x80)) {  // plain ASCII
    *face = base < 0x20 || nb_font_ascii(style) ? primary : nb_font_face_for(style, base, false);
    return i;
  }
  bool emoji = emoji_by_default(base), text = false, ri = regional_indicator(base);
  while (i < len) {
    int j = i;
    uint32_t cp = next_codepoint(s, len, &j);
    if (cp == 0x200D) {  // ZWJ: the next codepoint joins too
      emoji = true;
      i = j;
      if (i < len) next_codepoint(s, len, &i);
    } else if (ri && regional_indicator(cp)) {  // a flag is a pair
      ri = false;
      i = j;
    } else if (extends(cp)) {
      if (cp == 0xFE0F || (cp >= 0x1F3FB && cp <= 0x1F3FF) || cp == 0x20E3) emoji = true;
      if (cp == 0xFE0E) text = true;
      i = j;
    } else {
      break;
    }
  }
  *face = base < 0x20 ? primary : nb_font_face_for(style, base, emoji && !text);
  return i;
}

// ---- atlases ----------------------------------------------------------------------

static void reset_atlas(void) {
  memset(glyphs, 0, sizeof glyphs);
  memset(atlas, 0, sizeof atlas);
  if (color_atlas) memset(color_atlas, 0, (size_t)COLOR_ATLAS_SIZE * COLOR_ATLAS_SIZE * 4);
  shelf_x = shelf_y = shelf_h = cshelf_x = cshelf_y = cshelf_h = 0;
  atlas_dirty = color_dirty = true;
}

static bool pack(int size, int *sx, int *sy, int *sh, int w, int h, int *x, int *y) {
  if (*sx + w + 1 > size) {
    *sy += *sh + 1;
    *sx = 0;
    *sh = 0;
  }
  if (*sy + h + 1 > size || w + 1 > size) return false;
  *x = *sx;
  *y = *sy;
  *sx += w + 1;
  if (h > *sh) *sh = h;
  return true;
}

// Box-filters a bitmap into an atlas at w x h: gray coverage into the A8 atlas, premultiplied
// BGRA into the color atlas as premultiplied RGBA.
static void put_bitmap(const FT_Bitmap *bm, bool color, int x, int y, int w, int h) {
  if (!color && w == (int)bm->width && h == (int)bm->rows) {
    for (int r = 0; r < h; r++) memcpy(&atlas[(y + r) * ATLAS_SIZE + x], bm->buffer + r * bm->pitch, w);
    return;
  }
  int channels = color ? 4 : 1;
  float sx = (float)bm->width / w, sy = (float)bm->rows / h;
  for (int dy = 0; dy < h; dy++) {
    float y0 = dy * sy, y1 = y0 + sy;
    for (int dx = 0; dx < w; dx++) {
      float x0 = dx * sx, x1 = x0 + sx, acc[4] = {0, 0, 0, 0}, total = 0;
      for (int ry = (int)y0; ry < (int)ceilf(y1) && ry < (int)bm->rows; ry++) {
        float wy = fminf(y1, ry + 1) - fmaxf(y0, ry);
        const uint8_t *row = bm->buffer + ry * bm->pitch;
        for (int rx = (int)x0; rx < (int)ceilf(x1) && rx < (int)bm->width; rx++) {
          float wgt = wy * (fminf(x1, rx + 1) - fmaxf(x0, rx));
          const uint8_t *p = row + rx * channels;
          if (color) {  // B G R A
            acc[0] += p[2] * wgt; acc[1] += p[1] * wgt; acc[2] += p[0] * wgt; acc[3] += p[3] * wgt;
          } else {
            acc[0] += p[0] * wgt;
          }
          total += wgt;
        }
      }
      uint8_t *out = color ? color_atlas + ((size_t)(y + dy) * COLOR_ATLAS_SIZE + x + dx) * 4
                           : &atlas[(size_t)(y + dy) * ATLAS_SIZE + x + dx];
      for (int c = 0; c < channels; c++) out[c] = total > 0 ? (uint8_t)fminf(acc[c] / total + 0.5f, 255) : 0;
    }
  }
}

static glyph_slot *get_glyph(sized_font *sf, uint32_t gid) {
  uint64_t key = (uint64_t)sf->face << 56 | (uint64_t)sf->gen << 48 | (uint64_t)sf->px << 32 | gid;
  uint32_t h = (uint32_t)((key * 0x9E3779B97F4A7C15ull) >> 40) & (GLYPH_SLOTS - 1);
  glyph_slot *slot = NULL;
  for (int i = 0; i < GLYPH_SLOTS; i++) {
    glyph_slot *s = &glyphs[(h + i) & (GLYPH_SLOTS - 1)];
    if (s->used && s->key == key) return s;
    if (!s->used) { slot = s; break; }
  }
  if (!slot) {  // cache full: start over (glyphs are re-rasterised on demand)
    reset_atlas();
    slot = &glyphs[h];
  }

  FT_Int32 flags = FT_LOAD_RENDER | FT_LOAD_TARGET_LIGHT;
  if (FT_HAS_COLOR(sf->ft)) flags = FT_LOAD_RENDER | FT_LOAD_COLOR;
  if (sf->embolden) flags &= ~FT_LOAD_RENDER;  // thicken the outline, then render it
  if (FT_Load_Glyph(sf->ft, gid, flags)) return NULL;
  FT_GlyphSlot g = sf->ft->glyph;
  if (sf->embolden && g->format == FT_GLYPH_FORMAT_OUTLINE) {
    FT_Outline_Embolden(&g->outline, sf->embolden);
    FT_Outline_Translate(&g->outline, -sf->embolden / 2, 0);  // grow around the stem, not to the right only
  }
  if (g->format != FT_GLYPH_FORMAT_BITMAP && FT_Render_Glyph(g, FT_RENDER_MODE_LIGHT)) return NULL;
  FT_Bitmap *bm = &g->bitmap;
  int dw = bm->width, dh = bm->rows, left = g->bitmap_left, top = g->bitmap_top;
  bool color = bm->pixel_mode == FT_PIXEL_MODE_BGRA;
  if (color) {  // bitmap strikes come at their own size: scale them to the requested one
    float s = sf->bitmap_scale;
    dw = dw ? (int)fmaxf(1, roundf(dw * s)) : 0;
    dh = dh ? (int)fmaxf(1, roundf(dh * s)) : 0;
    left = (int)roundf(left * s);
    top = (int)roundf(top * s);
  } else if (dw && dh && bm->pixel_mode != FT_PIXEL_MODE_GRAY) {
    return NULL;  // mono bitmaps: not supported
  }
  // A bitmap larger than MAX_GLYPH would leave no room for others (or not fit at all): keep a
  // downscaled copy, which the GPU stretches back to dw x dh.
  int w = dw, hgt = dh, big = dw > dh ? dw : dh;
  if (big > MAX_GLYPH) {
    w = (int)fmaxf(1, roundf((float)dw * MAX_GLYPH / big));
    hgt = (int)fmaxf(1, roundf((float)dh * MAX_GLYPH / big));
  }
  int x = 0, y = 0;
  if (w && hgt) {
    if (color && !color_atlas && !(color_atlas = calloc((size_t)COLOR_ATLAS_SIZE * COLOR_ATLAS_SIZE, 4))) return NULL;
    int size = color ? COLOR_ATLAS_SIZE : ATLAS_SIZE;
    int *sx = color ? &cshelf_x : &shelf_x, *sy = color ? &cshelf_y : &shelf_y, *sh = color ? &cshelf_h : &shelf_h;
    if (!pack(size, sx, sy, sh, w, hgt, &x, &y)) {  // full: start over; an empty atlas always fits MAX_GLYPH
      reset_atlas();
      slot = &glyphs[h];
      if (!pack(size, sx, sy, sh, w, hgt, &x, &y)) return NULL;
    }
    put_bitmap(bm, color, x, y, w, hgt);
    if (color) color_dirty = true; else atlas_dirty = true;
  }
  *slot = (glyph_slot){.key = key, .used = true, .color = color, .x = x, .y = y, .w = w, .h = hgt,
                       .dw = dw, .dh = dh, .left = left, .top = top};
  return slot;
}

// ---- runs -------------------------------------------------------------------------

typedef void (*glyph_fn)(void *ud, sized_font *sf, const hb_glyph_info_t *info, const hb_glyph_position_t *pos,
                         float pen);

// Letter spacing turns ligatures off, as in CSS: they would hide the spacing inside them.
static const hb_feature_t no_ligatures[] = {
    {HB_TAG('l', 'i', 'g', 'a'), 0, HB_FEATURE_GLOBAL_START, HB_FEATURE_GLOBAL_END},
    {HB_TAG('c', 'l', 'i', 'g'), 0, HB_FEATURE_GLOBAL_START, HB_FEATURE_GLOBAL_END},
};

// Shapes `utf8` run by run (one face each) with the style's features and calls `fn` per glyph
// with its pen position; returns the total advance. `spacing` goes after every cluster (the
// last one too, as in browsers), so the width of a string is the sum of the widths of its parts.
static float layout_runs(sized_font *primary, int style, const char *utf8, float spacing, glyph_fn fn, void *ud) {
  const unsigned char *s = (const unsigned char *)utf8;
  unsigned char high = 0;
  int len = 0, ui = primary->face, px = primary->px;
  for (; s[len]; len++) high |= s[len];
  bool ascii = high < 0x80 && nb_font_ascii(style);  // all in the first face: one run
  // The spec's features go after the ones letter spacing turns off, so an explicit "liga" wins.
  hb_feature_t features[MAX_FEATURES];
  int nfeatures = 0, nspec;
  const hb_feature_t *spec = nb_font_features(style, &nspec);
  if (spacing != 0) features[nfeatures++] = no_ligatures[0], features[nfeatures++] = no_ligatures[1];
  for (int i = 0; i < nspec && nfeatures < MAX_FEATURES; i++) features[nfeatures++] = spec[i];
  float pen = 0;
  int start = 0;
  while (start < len) {
    int face = ui, end = len;
    if (!ascii) {  // extend the run while clusters keep the same face
      int f, i = cluster(s, len, start, style, ui, &face);
      while (i < len) {
        int next = cluster(s, len, i, style, ui, &f);
        if (f != face) break;
        i = next;
      }
      end = i;
    }
    sized_font *sf;
    if (face == ui) {
      sf = primary ? primary : (primary = get_font(ui, px));
    } else {
      sf = get_font(face, px);
      primary = NULL;  // loading a size may evict and move the cached ones
    }
    if (sf) {
      hb_buffer_clear_contents(buffer);
      hb_buffer_add_utf8(buffer, utf8, len, start, end - start);
      hb_buffer_guess_segment_properties(buffer);
      hb_shape(sf->hb, buffer, features, (unsigned)nfeatures);
      unsigned n;
      hb_glyph_info_t *info = hb_buffer_get_glyph_infos(buffer, &n);
      hb_glyph_position_t *pos = hb_buffer_get_glyph_positions(buffer, &n);
      for (unsigned i = 0; i < n; i++) {
        if (fn) fn(ud, sf, &info[i], &pos[i], pen);
        pen += pos[i].x_advance / 64.0f;
        if (spacing != 0 && (i + 1 == n || info[i + 1].cluster != info[i].cluster)) pen += spacing;
      }
    }
    start = end;
  }
  return pen;
}

float nb_text_measure(int font, const char *spec, const char *utf8, int px, float spacing, float *ascent, float *descent) {
  int style = nb_font_style(spec, font);
  sized_font *sf = get_font(nb_font_primary(style), px);
  if (!sf) return 0;
  if (ascent) *ascent = sf->ft->size->metrics.ascender / 64.0f;
  if (descent) *descent = -sf->ft->size->metrics.descender / 64.0f;
  return layout_runs(sf, style, utf8, spacing, NULL, NULL);
}

typedef struct {
  float x, baseline;
  nb_glyph_emit emit;
  void *ud;
} draw_ctx;

static void draw_glyph(void *ud, sized_font *sf, const hb_glyph_info_t *info, const hb_glyph_position_t *pos, float pen) {
  draw_ctx *d = ud;
  glyph_slot *g = get_glyph(sf, info->codepoint);
  if (!g || !g->w || !g->h) return;
  float gx = roundf(d->x + pen + pos->x_offset / 64.0f) + g->left;
  float gy = d->baseline - roundf(pos->y_offset / 64.0f) - g->top;
  float inv = 1.0f / (g->color ? COLOR_ATLAS_SIZE : ATLAS_SIZE);
  d->emit(d->ud, gx, gy, gx + g->dw, gy + g->dh, g->x * inv, g->y * inv, (g->x + g->w) * inv, (g->y + g->h) * inv, g->color);
}

void nb_text_draw(int font, const char *spec, const char *utf8, int px, float spacing, float x, float top,
                  nb_glyph_emit emit, void *ud) {
  int style = nb_font_style(spec, font);
  sized_font *sf = get_font(nb_font_primary(style), px);
  if (!sf) return;
  draw_ctx d = {.x = x, .baseline = roundf(top + sf->ft->size->metrics.ascender / 64.0f), .emit = emit, .ud = ud};
  layout_runs(sf, style, utf8, spacing, draw_glyph, &d);
}

const uint8_t *nb_text_atlas(int *size, bool *dirty) {
  *size = ATLAS_SIZE;
  *dirty = atlas_dirty;
  return atlas;
}

void nb_text_atlas_uploaded(void) { atlas_dirty = false; }

const uint8_t *nb_text_color_atlas(int *size, bool *dirty) {
  *size = COLOR_ATLAS_SIZE;
  *dirty = color_dirty && color_atlas;
  return color_atlas;
}

void nb_text_color_atlas_uploaded(void) { color_dirty = false; }
