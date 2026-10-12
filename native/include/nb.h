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
  int mods;        // NB_MOD_* held during a key or scroll event
  char key[64];    // xkb keysym name, e.g. "Return", "a", "BackSpace"
  char text[32];   // UTF-8 produced by the key (after compose / dead keys)
  char *data;      // malloc'd payload (NB_EV_CLIPBOARD text, NULL = empty); the core frees it
} nb_event;

// Implemented by core/addon.c; platforms call it from the JS thread.
void nb_push_event(const nb_event *e);

// ---- core/text.c ------------------------------------------------------------

enum { NB_FONT_REGULAR = 0, NB_FONT_BOLD = 1, NB_FONT_COUNT };

typedef void (*nb_glyph_emit)(void *ud, float x0, float y0, float x1, float y1,
                              float u0, float v0, float u1, float v1);

bool nb_text_init(void);
// All values in physical pixels.
float nb_text_measure(int font, const char *utf8, int px, float *ascent, float *descent);
void nb_text_draw(int font, const char *utf8, int px, float x, float top, nb_glyph_emit emit, void *ud);
const uint8_t *nb_text_atlas(int *size, bool *dirty);
void nb_text_atlas_uploaded(void);

// ---- core/render_gles2.c ----------------------------------------------------

// Command buffer opcodes (producer: src/render/paint.ts; keep both in sync).
enum {
  NB_OP_RECT = 1,
  NB_OP_TEXT = 2,
  NB_OP_CLIP = 3 /* x y w h radius */,
  NB_OP_UNCLIP = 4,
  NB_OP_SHADOW = 5,
  NB_OP_IMAGE = 6 /* x y w h  u0 v0 u1 v1  r g b a (tint, a = opacity)  radius id */,
  NB_OP_LINE = 7 /* x0 y0 x1 y1  width  r g b a  capStart capEnd (0 butt, 1 round) */,
  NB_OP_TRIANGLES = 8 /* count  r g b a  then count x (x y coverage) */,
  NB_OP_ARC = 9 /* cx cy  outer inner  start sweep (radians, 0 = up, clockwise)  r g b a */,
};

// Images: RGBA8 with straight alpha, copied on create. The GL texture is made at the
// next frame that draws it (there may be no context yet) and freed at the next frame
// after destroy (the context must be current). Ids are > 0; 0 means failure.
int nb_image_create(int width, int height, const uint8_t *rgba);
void nb_image_destroy(int id);

bool nb_render_init(void);
void nb_render_frame(int buffer_w, int buffer_h, float scale, const float *cmds, size_t count,
                     const char **texts, size_t text_count);
