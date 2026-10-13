// Internal to the core: font faces and styles (faces.c) for the text engine (text.c).
//
// A face is a font file (or a face of a collection) as drawn: with its variation coordinates
// and the synthetic italic (oblique) or bold it needs. Faces are never freed, so their ids are
// stable keys for text.c's sized fonts and glyph cache.
//
// A style is what a TEXT command asks for: a spec (family list, features, variations) at a
// font id (weight * 2 + italic). It resolves to a stack of faces (one per family of the list
// that has a match, then the UI font) and the system fallback after them. Style ids last until
// the next font registration, so text.c asks for them per call and never keeps them.
#pragma once

#include <ft2build.h>
#include FT_FREETYPE_H
#include <hb.h>
#include <stdbool.h>
#include <stdint.h>

#define NB_MAX_FACES 255  // face ids fit in 8 bits of the glyph cache key

extern FT_Library nb_ft;

bool nb_fonts_init(void);
/** The style for `spec` (NULL or "": the UI font) at font id `font`. */
int nb_font_style(const char *spec, int font);
/** The style's first face: its metrics are the line's. */
int nb_font_primary(int style);
/** The first face has every printable ASCII character (then ASCII needs no fallback lookups). */
bool nb_font_ascii(int style);
/** The face that draws a cluster whose base is `cp` (`emoji`: emoji presentation). Cached. */
int nb_font_face_for(int style, uint32_t cp, bool emoji);
/** The style's OpenType features (from its spec). */
const hb_feature_t *nb_font_features(int style, int *count);
/** A new FT_Face for `face` with its variations and slant set (the caller sizes and frees it). */
FT_Face nb_face_open(int face);
/** Synthetic bold: thicken the outlines. */
bool nb_face_embolden(int face);
