// Text: shaping (HarfBuzz), rasterisation (FreeType), font fallback and two glyph atlases
// shared by every font and size: alpha (A8, tinted by the text color) and color (premultiplied
// RGBA, for emoji). Which font files to use is the platform's call.
//
// A font id is weight (1..1000) * 2 + italic. Each id gets its UI face from the platform the
// first time it is used (a variable font gets its `wght` axis set; an upright face standing in
// for italic is slanted), and its own fallback order.
//
// A string is cut into grapheme-ish clusters (a base plus its marks, variation selectors,
// skin tones, ZWJ-joined parts, flag pairs); each cluster goes to one face (the UI font if it
// has the base, else a fallback the platform names), consecutive clusters with the same face
// form a run, and each run is shaped with its own font. measure and draw walk the same runs,
// so they always agree. ASCII-only strings skip all of this.
#include "nb.h"

#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_MULTIPLE_MASTERS_H
#include <hb-ft.h>
#include <hb.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define ATLAS_SIZE 1024
#define COLOR_ATLAS_SIZE 1024
#define MAX_SIZES 64
#define MAX_FACES 64      // UI fonts + fallbacks loaded at once (the rest draws as tofu)
#define MAX_STYLES 64     // font ids whose UI face is remembered
#define GLYPH_SLOTS 8192  // power of two
#define FALLBACK_SLOTS 4096  // power of two

// A font file as drawn: face 0 is the regular UI font; other weights, italics and fallbacks
// are added as they are needed.
typedef struct {
  char *path;
  int index;      // face inside the file (collections, named instances)
  bool oblique;   // slant the upright glyphs (italic asked, the family has none)
  bool variable;  // has a `wght` axis, set to `weight`
  int weight;
  FT_Face probe;  // unsized, for coverage checks
} face_entry;

typedef struct {
  int font;  // font id
  int face;
} style_entry;

typedef struct {
  int face, px;
  FT_Face ft;
  hb_font_t *hb;
  float bitmap_scale;  // fixed-size (bitmap) fonts: px / strike size; 1 otherwise
} sized_font;

typedef struct {
  uint64_t key;
  bool used, color;
  int x, y, w, h;  // atlas rect
  int left, top;   // bitmap bearing
} glyph_slot;

typedef struct {
  uint64_t key;  // codepoint | font id << 21 | emoji << 33, + 1 (0 = empty)
  int face;      // -1: no font has it
} fallback_slot;

static FT_Library ft;
static face_entry faces[MAX_FACES];
static int face_count;
static style_entry styles[MAX_STYLES];
static int style_count;
static sized_font sizes[MAX_SIZES];
static int size_count;
static glyph_slot glyphs[GLYPH_SLOTS];
static uint8_t atlas[ATLAS_SIZE * ATLAS_SIZE];
static uint8_t *color_atlas;  // allocated on the first color glyph
static int shelf_x, shelf_y, shelf_h, cshelf_x, cshelf_y, cshelf_h;
static bool atlas_dirty, color_dirty;
static fallback_slot fallbacks[FALLBACK_SLOTS];
static int fallback_count;
static hb_buffer_t *buffer;

static int add_face(char *path, int index, bool oblique, int weight);

bool nb_text_init(void) {
  if (buffer) return true;
  if (FT_Init_FreeType(&ft)) return false;
  int index = 0;
  bool oblique = false;
  char *path = nb_platform_font_path(400, false, &index, &oblique);
  if (!path) {
    fprintf(stderr, "nodebuilder: no UI font found\n");
    return false;
  }
  add_face(path, index, false, 400);  // face 0
  styles[style_count++] = (style_entry){.font = NB_FONT_REGULAR, .face = 0};
  buffer = hb_buffer_create();
  return true;
}

// ---- faces and sizes --------------------------------------------------------------

static FT_Face probe(int face) {
  face_entry *f = &faces[face];
  if (!f->probe && FT_New_Face(ft, f->path, f->index, &f->probe)) f->probe = NULL;
  return f->probe;
}

static bool has_weight_axis(FT_Face f) {
  FT_MM_Var *mm;
  if (!f || !FT_HAS_MULTIPLE_MASTERS(f) || FT_Get_MM_Var(f, &mm)) return false;
  bool found = false;
  for (FT_UInt a = 0; a < mm->num_axis; a++)
    if (mm->axis[a].tag == FT_MAKE_TAG('w', 'g', 'h', 't')) found = true;
  FT_Done_MM_Var(ft, mm);
  return found;
}

// A variable face is opened at its base index, because HarfBuzz ignores the coordinates
// FreeType gives a named instance (index >> 16); the instance's coordinates come from the
// probe, opened with the full index, with `wght` set to the weight (clamped to the axis).
static void set_variations(FT_Face f, int face) {
  FT_Face named = probe(face);
  FT_MM_Var *mm;
  if (!named || FT_Get_MM_Var(f, &mm)) return;
  FT_Fixed coords[16];
  FT_UInt n = mm->num_axis < 16 ? mm->num_axis : 16;
  if (!FT_Get_Var_Design_Coordinates(named, n, coords)) {
    for (FT_UInt a = 0; a < n; a++) {
      const FT_Var_Axis *axis = &mm->axis[a];
      if (axis->tag != FT_MAKE_TAG('w', 'g', 'h', 't')) continue;
      FT_Fixed w = (FT_Fixed)faces[face].weight << 16;
      coords[a] = w < axis->minimum ? axis->minimum : w > axis->maximum ? axis->maximum : w;
    }
    FT_Set_Var_Design_Coordinates(f, n, coords);
  }
  FT_Done_MM_Var(ft, mm);
}

// The face for (path, index), taking ownership of `path`. A static file is shared by every
// weight that maps to it; a variable one gets an entry per weight. `weight` 0: leave the axes.
static int add_face(char *path, int index, bool oblique, int weight) {
  bool variable = false;
  for (int i = 0; i < face_count; i++) {
    if (faces[i].index != index || faces[i].oblique != oblique || strcmp(faces[i].path, path) != 0) continue;
    if (!faces[i].variable || faces[i].weight == weight) {
      free(path);
      return i;
    }
    variable = true;  // the same variable file at another weight
  }
  if (face_count == MAX_FACES) {
    free(path);
    return -1;
  }
  int i = face_count++;
  faces[i] = (face_entry){.path = path, .index = index, .oblique = oblique, .weight = weight};
  faces[i].variable = weight > 0 && (variable || has_weight_axis(probe(i)));
  return i;
}

// The UI face of a font id, asked of the platform once.
static int primary_face(int font) {
  for (int i = 0; i < style_count; i++)
    if (styles[i].font == font) return styles[i].face;
  int index = 0;
  bool oblique = false;
  char *path = nb_platform_font_path(font >> 1, font & 1, &index, &oblique);
  int face = path ? add_face(path, index, oblique, font >> 1) : -1;
  if (face < 0) face = 0;
  if (style_count < MAX_STYLES) styles[style_count++] = (style_entry){.font = font, .face = face};
  return face;
}

static int valid_font(int font) { return font >= 2 && font <= 2001 ? font : NB_FONT_REGULAR; }

static sized_font *get_font(int face, int px) {
  if (face < 0 || face >= face_count) face = 0;
  if (px < 1) px = 1;
  for (int i = 0; i < size_count; i++)
    if (sizes[i].face == face && sizes[i].px == px) return &sizes[i];

  if (size_count == MAX_SIZES) {  // evict the oldest
    hb_font_destroy(sizes[0].hb);
    FT_Done_Face(sizes[0].ft);
    memmove(&sizes[0], &sizes[1], sizeof(sized_font) * (MAX_SIZES - 1));
    size_count--;
  }
  FT_Face f;
  int index = faces[face].variable ? faces[face].index & 0xFFFF : faces[face].index;
  if (FT_New_Face(ft, faces[face].path, index, &f)) return NULL;
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
    if (faces[face].variable) set_variations(f, face);
    if (faces[face].oblique) {  // ~11 degrees, about what browsers use for synthetic italics
      FT_Matrix shear = {.xx = 0x10000, .xy = 0x3333, .yx = 0, .yy = 0x10000};
      FT_Set_Transform(f, &shear, NULL);
    }
    FT_Set_Pixel_Sizes(f, 0, px);
    hb = hb_ft_font_create_referenced(f);
    hb_ft_font_set_load_flags(hb, FT_LOAD_DEFAULT | FT_LOAD_TARGET_LIGHT);
  }
  sizes[size_count] = (sized_font){.face = face, .px = px, .ft = f, .hb = hb, .bitmap_scale = bitmap_scale};
  return &sizes[size_count++];
}

// ---- fallback ---------------------------------------------------------------------

static int platform_fallback(uint32_t cp, int font, bool emoji) {
  int index = 0, weight = emoji ? 0 : font >> 1;
  char *path = nb_platform_font_fallback(cp, font >> 1, font & 1, emoji, &index);
  return path ? add_face(path, index, false, weight) : -1;
}

static bool covers(int face, uint32_t cp) {
  FT_Face f = probe(face);
  return f && FT_Get_Char_Index(f, cp) != 0;
}

static uint32_t fallback_hash(uint64_t key) { return (uint32_t)((key * 0x9E3779B97F4A7C15ull) >> 40) & (FALLBACK_SLOTS - 1); }

// The face for a cluster whose base is `cp`, in font id `font` (UI face `primary`): emoji
// presentation prefers a color font, otherwise the UI face when it has the glyph, then the
// system's fallback for that weight and slant. Cached per codepoint and font id.
static int face_for(int font, int primary, uint32_t cp, bool emoji) {
  uint64_t key = (cp | (uint64_t)font << 21 | (uint64_t)emoji << 33) + 1;
  uint32_t h = fallback_hash(key);
  for (;; h = (h + 1) & (FALLBACK_SLOTS - 1)) {
    if (fallbacks[h].key == key) return fallbacks[h].face < 0 ? primary : fallbacks[h].face;
    if (!fallbacks[h].key) break;
  }
  int face = -1;
  if (emoji) face = platform_fallback(cp, font, true);
  if (face < 0 && covers(primary, cp)) face = primary;
  if (face < 0) face = platform_fallback(cp, font, false);
  if (fallback_count * 4 >= FALLBACK_SLOTS * 3) {  // mostly full: start over
    memset(fallbacks, 0, sizeof fallbacks);
    fallback_count = 0;
    h = fallback_hash(key);
  }
  fallbacks[h] = (fallback_slot){.key = key, .face = face};
  fallback_count++;
  return face < 0 ? primary : face;
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
static int cluster(const unsigned char *s, int len, int start, int font, int primary, int *face) {
  int i = start;
  uint32_t base = next_codepoint(s, len, &i);
  if (base < 0x80 && (i >= len || s[i] < 0x80)) {  // plain ASCII
    *face = primary;
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
  *face = base < 0x20 ? primary : face_for(font, primary, base, emoji && !text);
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

// Box-filters a premultiplied BGRA bitmap into the color atlas as premultiplied RGBA, w x h.
static void put_color(const FT_Bitmap *bm, int x, int y, int w, int h) {
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
          const uint8_t *p = row + rx * 4;  // B G R A
          acc[0] += p[2] * wgt; acc[1] += p[1] * wgt; acc[2] += p[0] * wgt; acc[3] += p[3] * wgt;
          total += wgt;
        }
      }
      uint8_t *out = color_atlas + ((size_t)(y + dy) * COLOR_ATLAS_SIZE + x + dx) * 4;
      for (int c = 0; c < 4; c++) out[c] = total > 0 ? (uint8_t)fminf(acc[c] / total + 0.5f, 255) : 0;
    }
  }
}

static glyph_slot *get_glyph(sized_font *sf, uint32_t gid) {
  uint64_t key = ((uint64_t)sf->face << 56) | ((uint64_t)sf->px << 32) | gid;
  uint32_t h = (uint32_t)((key * 0x9E3779B97F4A7C15ull) >> 40) & (GLYPH_SLOTS - 1);
  glyph_slot *slot = NULL;
  for (int i = 0; i < GLYPH_SLOTS; i++) {
    glyph_slot *s = &glyphs[(h + i) & (GLYPH_SLOTS - 1)];
    if (s->used && s->key == key) return s;
    if (!s->used) { slot = s; break; }
  }
  if (!slot) {  // cache full: start over (glyphs are re-rasterised on demand)
    reset_atlas();
    return get_glyph(sf, gid);
  }

  FT_Int32 flags = FT_LOAD_RENDER | FT_LOAD_TARGET_LIGHT;
  if (FT_HAS_COLOR(sf->ft)) flags = FT_LOAD_RENDER | FT_LOAD_COLOR;
  if (FT_Load_Glyph(sf->ft, gid, flags)) return NULL;
  FT_GlyphSlot g = sf->ft->glyph;
  FT_Bitmap *bm = &g->bitmap;
  int x = 0, y = 0, w = bm->width, hgt = bm->rows, left = g->bitmap_left, top = g->bitmap_top;
  bool color = bm->pixel_mode == FT_PIXEL_MODE_BGRA;
  if (color) {
    float s = sf->bitmap_scale;
    w = w ? (int)fmaxf(1, roundf(w * s)) : 0;
    hgt = hgt ? (int)fmaxf(1, roundf(hgt * s)) : 0;
    left = (int)roundf(left * s);
    top = (int)roundf(top * s);
    if (w && hgt) {
      if (!color_atlas && !(color_atlas = calloc((size_t)COLOR_ATLAS_SIZE * COLOR_ATLAS_SIZE, 4))) return NULL;
      if (!pack(COLOR_ATLAS_SIZE, &cshelf_x, &cshelf_y, &cshelf_h, w, hgt, &x, &y)) {
        reset_atlas();
        return get_glyph(sf, gid);
      }
      put_color(bm, x, y, w, hgt);
      color_dirty = true;
    }
  } else if (w && hgt) {
    if (bm->pixel_mode != FT_PIXEL_MODE_GRAY) return NULL;  // mono bitmaps: not supported
    if (!pack(ATLAS_SIZE, &shelf_x, &shelf_y, &shelf_h, w, hgt, &x, &y)) {
      reset_atlas();
      return get_glyph(sf, gid);
    }
    for (int r = 0; r < hgt; r++) memcpy(&atlas[(y + r) * ATLAS_SIZE + x], bm->buffer + r * bm->pitch, w);
    atlas_dirty = true;
  }
  *slot = (glyph_slot){.key = key, .used = true, .color = color, .x = x, .y = y, .w = w, .h = hgt, .left = left, .top = top};
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

// Shapes `utf8` run by run (one face each) and calls `fn` per glyph with its pen position;
// returns the total advance. `spacing` goes after every cluster (the last one too, as in
// browsers), so the width of a string is the sum of the widths of its parts.
static float layout_runs(sized_font *primary, int font, const char *utf8, float spacing, glyph_fn fn, void *ud) {
  const unsigned char *s = (const unsigned char *)utf8;
  unsigned char high = 0;
  int len = 0, ui = primary->face, px = primary->px;
  for (; s[len]; len++) high |= s[len];
  bool ascii = high < 0x80;
  float pen = 0;
  int start = 0;
  while (start < len) {
    int face = ui, end = len;
    if (!ascii) {  // extend the run while clusters keep the same face
      int f, i = cluster(s, len, start, font, ui, &face);
      while (i < len) {
        int next = cluster(s, len, i, font, ui, &f);
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
      hb_shape(sf->hb, buffer, spacing != 0 ? no_ligatures : NULL, spacing != 0 ? 2 : 0);
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

float nb_text_measure(int font, const char *utf8, int px, float spacing, float *ascent, float *descent) {
  font = valid_font(font);
  sized_font *sf = get_font(primary_face(font), px);
  if (!sf) return 0;
  if (ascent) *ascent = sf->ft->size->metrics.ascender / 64.0f;
  if (descent) *descent = -sf->ft->size->metrics.descender / 64.0f;
  return layout_runs(sf, font, utf8, spacing, NULL, NULL);
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
  d->emit(d->ud, gx, gy, gx + g->w, gy + g->h, g->x * inv, g->y * inv, (g->x + g->w) * inv, (g->y + g->h) * inv, g->color);
}

void nb_text_draw(int font, const char *utf8, int px, float spacing, float x, float top, nb_glyph_emit emit, void *ud) {
  font = valid_font(font);
  sized_font *sf = get_font(primary_face(font), px);
  if (!sf) return;
  draw_ctx d = {.x = x, .baseline = roundf(top + sf->ft->size->metrics.ascender / 64.0f), .emit = emit, .ud = ud};
  layout_runs(sf, font, utf8, spacing, draw_glyph, &d);
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
