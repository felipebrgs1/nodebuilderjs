// Linux font discovery through fontconfig (honours the user's desktop settings).
#include <fontconfig/fontconfig.h>
#include <stdlib.h>
#include <string.h>

#include "nb.h"

static char *match(const char *pattern) {
  FcPattern *pat = FcNameParse((const FcChar8 *)pattern);
  FcConfigSubstitute(NULL, pat, FcMatchPattern);
  FcDefaultSubstitute(pat);
  FcResult result;
  FcPattern *found = FcFontMatch(NULL, pat, &result);
  char *path = NULL;
  if (found) {
    FcChar8 *file;
    if (FcPatternGetString(found, FC_FILE, 0, &file) == FcResultMatch) path = strdup((const char *)file);
    FcPatternDestroy(found);
  }
  FcPatternDestroy(pat);
  return path;
}

char *nb_platform_font_path(int font) {
  if (!FcInit()) return NULL;
  return match(font == NB_FONT_BOLD ? "sans-serif:bold" : "sans-serif");
}

// Fallback: the fonts fontconfig would try after the UI font, best first (FcFontSort, the same
// order browsers and toolkits get), sorted once per (font, emoji) and kept for the process.
static FcFontSet *sorted[NB_FONT_COUNT][2];

static FcFontSet *fallback_set(int font, bool emoji) {
  FcFontSet **set = &sorted[font][emoji];
  if (*set) return *set;
  FcPattern *pat = FcNameParse((const FcChar8 *)(emoji ? "emoji" : font == NB_FONT_BOLD ? "sans-serif:bold" : "sans-serif"));
  if (emoji) FcPatternAddBool(pat, FC_COLOR, FcTrue);
  FcConfigSubstitute(NULL, pat, FcMatchPattern);
  FcDefaultSubstitute(pat);
  FcResult result;
  *set = FcFontSort(NULL, pat, FcFalse, NULL, &result);
  FcPatternDestroy(pat);
  return *set;
}

char *nb_platform_font_fallback(uint32_t codepoint, int font, bool emoji, int *face_index) {
  if (!FcInit()) return NULL;
  if (font < 0 || font >= NB_FONT_COUNT) font = NB_FONT_REGULAR;
  FcFontSet *set = fallback_set(font, emoji);
  for (int i = 0; set && i < set->nfont; i++) {
    FcPattern *p = set->fonts[i];
    FcCharSet *chars;
    FcChar8 *file;
    FcBool color = FcFalse;
    if (FcPatternGetCharSet(p, FC_CHARSET, 0, &chars) != FcResultMatch || !FcCharSetHasChar(chars, codepoint)) continue;
    if (emoji && (FcPatternGetBool(p, FC_COLOR, 0, &color) != FcResultMatch || !color)) continue;
    if (FcPatternGetString(p, FC_FILE, 0, &file) != FcResultMatch) continue;
    int index = 0;
    FcPatternGetInteger(p, FC_INDEX, 0, &index);
    if (face_index) *face_index = index;
    return strdup((const char *)file);
  }
  return NULL;
}
