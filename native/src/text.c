// Text: font discovery (fontconfig), shaping (HarfBuzz), rasterisation (FreeType)
// and a single alpha glyph atlas shared by every font size.
#include "nb.h"

#include <fontconfig/fontconfig.h>
#include <ft2build.h>
#include FT_FREETYPE_H
#include <hb-ft.h>
#include <hb.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define ATLAS_SIZE 1024
#define MAX_SIZES 48
#define GLYPH_SLOTS 8192  // power of two

typedef struct {
  int font, px;
  FT_Face face;
  hb_font_t *hb;
} sized_font;

typedef struct {
  uint64_t key;
  bool used;
  int x, y, w, h;      // atlas rect
  int left, top;       // bitmap bearing
} glyph_slot;

static FT_Library ft;
static char *font_paths[NB_FONT_COUNT];
static sized_font sizes[MAX_SIZES];
static int size_count;
static glyph_slot glyphs[GLYPH_SLOTS];
static uint8_t atlas[ATLAS_SIZE * ATLAS_SIZE];
static int shelf_x, shelf_y, shelf_h;
static bool atlas_dirty;
static hb_buffer_t *buffer;

static char *find_font(const char *pattern) {
  FcPattern *pat = FcNameParse((const FcChar8 *)pattern);
  FcConfigSubstitute(NULL, pat, FcMatchPattern);
  FcDefaultSubstitute(pat);
  FcResult result;
  FcPattern *match = FcFontMatch(NULL, pat, &result);
  char *path = NULL;
  if (match) {
    FcChar8 *file;
    if (FcPatternGetString(match, FC_FILE, 0, &file) == FcResultMatch) path = strdup((const char *)file);
    FcPatternDestroy(match);
  }
  FcPatternDestroy(pat);
  return path;
}

bool nb_text_init(void) {
  if (buffer) return true;
  if (FT_Init_FreeType(&ft) || !FcInit()) return false;
  font_paths[NB_FONT_REGULAR] = find_font("sans-serif");
  font_paths[NB_FONT_BOLD] = find_font("sans-serif:bold");
  if (!font_paths[NB_FONT_REGULAR]) {
    fprintf(stderr, "nodebuilder: no sans-serif font found\n");
    return false;
  }
  if (!font_paths[NB_FONT_BOLD]) font_paths[NB_FONT_BOLD] = strdup(font_paths[NB_FONT_REGULAR]);
  buffer = hb_buffer_create();
  return true;
}

static sized_font *get_font(int font, int px) {
  if (font < 0 || font >= NB_FONT_COUNT) font = 0;
  if (px < 1) px = 1;
  for (int i = 0; i < size_count; i++)
    if (sizes[i].font == font && sizes[i].px == px) return &sizes[i];

  if (size_count == MAX_SIZES) {  // evict the oldest
    hb_font_destroy(sizes[0].hb);
    FT_Done_Face(sizes[0].face);
    memmove(&sizes[0], &sizes[1], sizeof(sized_font) * (MAX_SIZES - 1));
    size_count--;
  }
  FT_Face face;
  if (FT_New_Face(ft, font_paths[font], 0, &face)) return NULL;
  FT_Set_Pixel_Sizes(face, 0, px);
  hb_font_t *hb = hb_ft_font_create_referenced(face);
  hb_ft_font_set_load_flags(hb, FT_LOAD_DEFAULT | FT_LOAD_TARGET_LIGHT);
  sizes[size_count] = (sized_font){.font = font, .px = px, .face = face, .hb = hb};
  return &sizes[size_count++];
}

static void reset_atlas(void) {
  memset(glyphs, 0, sizeof glyphs);
  memset(atlas, 0, sizeof atlas);
  shelf_x = shelf_y = shelf_h = 0;
  atlas_dirty = true;
}

static bool pack(int w, int h, int *x, int *y) {
  if (shelf_x + w + 1 > ATLAS_SIZE) {
    shelf_y += shelf_h + 1;
    shelf_x = 0;
    shelf_h = 0;
  }
  if (shelf_y + h + 1 > ATLAS_SIZE || w + 1 > ATLAS_SIZE) return false;
  *x = shelf_x;
  *y = shelf_y;
  shelf_x += w + 1;
  if (h > shelf_h) shelf_h = h;
  return true;
}

static glyph_slot *get_glyph(sized_font *sf, uint32_t gid) {
  uint64_t key = ((uint64_t)sf->font << 56) | ((uint64_t)sf->px << 32) | gid;
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

  if (FT_Load_Glyph(sf->face, gid, FT_LOAD_RENDER | FT_LOAD_TARGET_LIGHT)) return NULL;
  FT_GlyphSlot g = sf->face->glyph;
  FT_Bitmap *bm = &g->bitmap;
  int x = 0, y = 0;
  if (bm->width && bm->rows) {
    if (!pack(bm->width, bm->rows, &x, &y)) {
      reset_atlas();
      return get_glyph(sf, gid);
    }
    for (unsigned r = 0; r < bm->rows; r++)
      memcpy(&atlas[(y + r) * ATLAS_SIZE + x], bm->buffer + r * bm->pitch, bm->width);
    atlas_dirty = true;
  }
  *slot = (glyph_slot){.key = key, .used = true, .x = x, .y = y, .w = bm->width, .h = bm->rows,
                       .left = g->bitmap_left, .top = g->bitmap_top};
  return slot;
}

static unsigned shape(sized_font *sf, const char *utf8, hb_glyph_info_t **info, hb_glyph_position_t **pos) {
  hb_buffer_clear_contents(buffer);
  hb_buffer_add_utf8(buffer, utf8, -1, 0, -1);
  hb_buffer_guess_segment_properties(buffer);
  hb_shape(sf->hb, buffer, NULL, 0);
  unsigned n;
  *info = hb_buffer_get_glyph_infos(buffer, &n);
  *pos = hb_buffer_get_glyph_positions(buffer, &n);
  return n;
}

float nb_text_measure(int font, const char *utf8, int px, float *ascent, float *descent) {
  sized_font *sf = get_font(font, px);
  if (!sf) return 0;
  if (ascent) *ascent = sf->face->size->metrics.ascender / 64.0f;
  if (descent) *descent = -sf->face->size->metrics.descender / 64.0f;
  hb_glyph_info_t *info;
  hb_glyph_position_t *pos;
  unsigned n = shape(sf, utf8, &info, &pos);
  float w = 0;
  for (unsigned i = 0; i < n; i++) w += pos[i].x_advance / 64.0f;
  return w;
}

void nb_text_draw(int font, const char *utf8, int px, float x, float top, nb_glyph_emit emit, void *ud) {
  sized_font *sf = get_font(font, px);
  if (!sf) return;
  float baseline = roundf(top + sf->face->size->metrics.ascender / 64.0f);
  hb_glyph_info_t *info;
  hb_glyph_position_t *pos;
  unsigned n = shape(sf, utf8, &info, &pos);
  float pen = x;
  const float inv = 1.0f / ATLAS_SIZE;
  for (unsigned i = 0; i < n; i++) {
    glyph_slot *g = get_glyph(sf, info[i].codepoint);
    if (g && g->w && g->h) {
      float gx = roundf(pen + pos[i].x_offset / 64.0f) + g->left;
      float gy = baseline - roundf(pos[i].y_offset / 64.0f) - g->top;
      emit(ud, gx, gy, gx + g->w, gy + g->h, g->x * inv, g->y * inv, (g->x + g->w) * inv, (g->y + g->h) * inv);
    }
    pen += pos[i].x_advance / 64.0f;
  }
}

const uint8_t *nb_text_atlas(int *size, bool *dirty) {
  *size = ATLAS_SIZE;
  *dirty = atlas_dirty;
  return atlas;
}

void nb_text_atlas_uploaded(void) { atlas_dirty = false; }
