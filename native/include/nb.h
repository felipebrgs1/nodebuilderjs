// Shared declarations for the portable native core (native/core/).
// OS-specific code lives in native/platform/<os>/ behind nb_platform.h.
// The core is deliberately small: events, GPU drawing (GLES2) and text
// (FreeType/HarfBuzz). Everything else lives in TypeScript.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "nb_platform.h"

// ---- events (platform -> addon.c) -------------------------------------------

enum nb_event_type {
  NB_EV_CONFIGURE = 1,
  NB_EV_CLOSE,
  NB_EV_FRAME,
  NB_EV_POINTER_MOVE,
  NB_EV_POINTER_DOWN,
  NB_EV_POINTER_UP,
  NB_EV_POINTER_LEAVE,
  NB_EV_SCROLL,
  NB_EV_KEY_DOWN,
  NB_EV_KEY_UP,
  NB_EV_FOCUS,
  NB_EV_CLIPBOARD,  // answer to nb_platform_clipboard_read: `data` holds the text
};

enum nb_mod { NB_MOD_CTRL = 1, NB_MOD_SHIFT = 2, NB_MOD_ALT = 4, NB_MOD_SUPER = 8 };

typedef struct {
  int type;
  double x, y;     // pointer position (logical px)
  double dx, dy;   // scroll delta
  int button;      // 0 left, 1 middle, 2 right
  int width, height, scale;
  bool maximized, activated, focused, repeat;
  bool transparent;  // window can show see-through (rounded) corners
  int mods;        // NB_MOD_* held during a pointer, scroll or key event
  char key[64];    // xkb keysym name, e.g. "Return", "a", "BackSpace"
  char text[32];   // UTF-8 produced by the key (after compose / dead keys)
  char *data;      // malloc'd payload (NB_EV_CLIPBOARD text, NULL = empty); the core frees it
} nb_event;

// Implemented by core/addon.c; platforms call it from the JS thread.
void nb_push_event(const nb_event *e);

// ---- core/text.c ------------------------------------------------------------

// Font id: weight (1..1000, CSS: 400 regular, 700 bold) * 2 + italic (0/1). Out of range: regular.
#define NB_FONT_ID(weight, italic) ((weight) * 2 + ((italic) ? 1 : 0))
enum { NB_FONT_REGULAR = NB_FONT_ID(400, 0), NB_FONT_BOLD = NB_FONT_ID(700, 0) };

// `color`: the quad samples the color atlas (emoji: premultiplied RGBA, not tinted) instead of
// the alpha atlas (tinted by the text color).
typedef void (*nb_glyph_emit)(void *ud, float x0, float y0, float x1, float y1,
                              float u0, float v0, float u1, float v1, bool color);

bool nb_text_init(void);
// All values in physical pixels. `font`: a font id. `spec`: the family list, OpenType features and
// variation axes joined by U+001F (src/render/node.ts fontSpec), or NULL/"" for the UI font.
// `spacing`: letter spacing, added after every grapheme cluster (the last one too); nonzero turns
// ligatures off.
float nb_text_measure(int font, const char *spec, const char *utf8, int px, float spacing, float *ascent, float *descent);
void nb_text_draw(int font, const char *spec, const char *utf8, int px, float spacing, float x, float top,
                  nb_glyph_emit emit, void *ud);
/** Starts a frame: the atlas pages its glyphs come from are not wiped until the next one. */
void nb_text_begin_frame(void);
/** The A8 glyph atlas (size x size) and the rows changed since the last upload, [y0, y1). */
const uint8_t *nb_text_atlas(int *size, int *y0, int *y1);
void nb_text_atlas_uploaded(void);
/** Premultiplied RGBA color-glyph atlas; NULL (and no rows changed) until a color glyph is drawn. */
const uint8_t *nb_text_color_atlas(int *size, int *y0, int *y1);
void nb_text_color_atlas_uploaded(void);

// ---- core/faces.c: app fonts -------------------------------------------------

typedef struct {
  char family[256];
  int weight_min, weight_max;  // one weight, or a variable font's wght range
  bool italic, variable;
} nb_font_info;

/**
 * Adds the faces of a font file (copied; every face of a collection) to the app's families.
 * `family` NULL: the file's own name; `weight_min` 0: the file's weight (a variable font, its wght
 * range); `italic` < 0: the file's slant. Writes up to `max` faces to `out` and returns how many
 * were added, or -1 with the reason in `error` (not a font, or a format FreeType can't read).
 */
int nb_fonts_register(const uint8_t *data, size_t size, const char *family, int weight_min, int weight_max, int italic,
                      nb_font_info *out, int max, char *error, size_t error_size);
/** Calls `fn` with every family `spec` can name: the registered ones, then the installed ones. */
void nb_fonts_families(void (*fn)(const char *family, void *ud), void *ud);

typedef struct {
  int faces, variations, specs, styles, sizes;  // live entries of each table
} nb_font_stats;
/** How full the font tables are (tests: animated axes must keep them bounded). */
void nb_fonts_stats(nb_font_stats *out);
/** Diagnostics: the FreeType and HarfBuzz versions in use ("major.minor.patch"). Needs no font. */
void nb_fonts_versions(char *freetype, size_t size, const char **harfbuzz);
/** Diagnostics: the family name of face `index` of a font file; false when FreeType can't open it. */
bool nb_fonts_file_family(const char *path, int index, char *out, size_t size);

// ---- core/render_gles2.c ----------------------------------------------------

// Command buffer opcodes (producer: src/render/paint.ts; keep both in sync).
enum {
  NB_OP_RECT = 1 /* x y w h  r g b a  tl tr br bl (corner radii)  border  br bg bb ba */,
  NB_OP_TEXT = 2 /* x y(line top) size font(id)  r g b a  text_index  letter_spacing  spec_index (-1: none) */,
  NB_OP_CLIP = 3 /* x y w h  tl tr br bl (corner radii) */,
  NB_OP_UNCLIP = 4,
  NB_OP_SHADOW = 5 /* x y w h  r g b a  tl tr br bl (corner radii)  blur  dy (the box casting it is at y - dy: not drawn there, as in CSS) */,
  NB_OP_IMAGE = 6 /* x y w h  u0 v0 u1 v1  r g b a (tint, a = opacity)  radius id */,
  NB_OP_LINE = 7 /* x0 y0 x1 y1  width  r g b a  capStart capEnd (0 butt, 1 round) */,
  NB_OP_TRIANGLES = 8 /* count  r g b a  then count x (x y coverage) */,
  NB_OP_ARC = 9 /* cx cy  outer inner  start sweep (radians, 0 = up, clockwise)  r g b a */,
  /* x0 y0 x1 y1  n  then n x (offset r g b a): the next drawing op is filled with this linear
     gradient (its own color multiplies it; paint.ts sends white). Interpolated premultiplied. */
  NB_OP_GRADIENT = 10,
};

// Images: RGBA8 with straight alpha, copied on create. The GL texture is made at the
// next frame that draws it (there may be no context yet) and freed at the next frame
// after destroy (the context must be current). Ids are > 0; 0 means failure.
int nb_image_create(int width, int height, const uint8_t *rgba);
void nb_image_destroy(int id);

bool nb_render_init(void);
/** Reads the bound framebuffer (w x h) into `out` as RGBA8, rows top to bottom, straight alpha. */
void nb_render_read_pixels(int w, int h, uint8_t *out);
void nb_render_frame(int buffer_w, int buffer_h, float scale, const float *cmds, size_t count,
                     const char **texts, size_t text_count);
