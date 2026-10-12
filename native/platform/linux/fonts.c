// Linux font discovery through fontconfig (honours the user's desktop settings).
#include <fontconfig/fontconfig.h>
#include <stdlib.h>
#include <string.h>

#include "nb.h"

// The UI font ("sans-serif") at a CSS weight and slant, or a color emoji font.
static FcPattern *pattern(int weight, bool italic, bool emoji) {
  FcPattern *pat = FcNameParse((const FcChar8 *)(emoji ? "emoji" : "sans-serif"));
  if (emoji) {
    FcPatternAddBool(pat, FC_COLOR, FcTrue);
  } else {
    if (weight < 1) weight = 1;
    if (weight > 1000) weight = 1000;
    FcPatternAddInteger(pat, FC_WEIGHT, FcWeightFromOpenType(weight));
    FcPatternAddInteger(pat, FC_SLANT, italic ? FC_SLANT_ITALIC : FC_SLANT_ROMAN);
  }
  FcConfigSubstitute(NULL, pat, FcMatchPattern);
  FcDefaultSubstitute(pat);
  return pat;
}

char *nb_platform_font_path(int weight, bool italic, int *face_index, bool *oblique) {
  if (!FcInit()) return NULL;
  FcPattern *pat = pattern(weight, italic, false);
  FcResult result;
  FcPattern *found = FcFontMatch(NULL, pat, &result);
  char *path = NULL;
  if (found) {
    FcChar8 *file;
    int index = 0, slant = FC_SLANT_ROMAN;
    if (FcPatternGetString(found, FC_FILE, 0, &file) == FcResultMatch) path = strdup((const char *)file);
    FcPatternGetInteger(found, FC_INDEX, 0, &index);
    FcPatternGetInteger(found, FC_SLANT, 0, &slant);
    if (face_index) *face_index = index;
    // An upright match stands in for italic: either the slant says so, or the system config
    // (90-synthetic.conf) already marked it italic and added a shear matrix for us to apply.
    FcMatrix *matrix;
    bool sheared = FcPatternGetMatrix(found, FC_MATRIX, 0, &matrix) == FcResultMatch && matrix->xy != 0;
    if (oblique) *oblique = italic && (slant == FC_SLANT_ROMAN || sheared);
    FcPatternDestroy(found);
  }
  FcPatternDestroy(pat);
  return path;
}

// Fallback: the fonts fontconfig would try after the UI font, best first (FcFontSort, the same
// order browsers and toolkits get), sorted once per (weight, italic, emoji) and kept.
#define MAX_SETS 32
static struct {
  int weight;
  bool italic, emoji;
  FcFontSet *set;
} sorted[MAX_SETS];
static int sorted_count, sorted_next;

static FcFontSet *fallback_set(int weight, bool italic, bool emoji) {
  if (emoji) weight = 0, italic = false;
  for (int i = 0; i < sorted_count; i++)
    if (sorted[i].weight == weight && sorted[i].italic == italic && sorted[i].emoji == emoji) return sorted[i].set;
  FcPattern *pat = pattern(weight, italic, emoji);
  FcResult result;
  FcFontSet *set = FcFontSort(NULL, pat, FcFalse, NULL, &result);
  FcPatternDestroy(pat);
  int slot = sorted_count < MAX_SETS ? sorted_count++ : sorted_next++ % MAX_SETS;  // full: replace the oldest
  if (sorted[slot].set) FcFontSetDestroy(sorted[slot].set);
  sorted[slot].weight = weight;
  sorted[slot].italic = italic;
  sorted[slot].emoji = emoji;
  sorted[slot].set = set;
  return set;
}

char *nb_platform_font_fallback(uint32_t codepoint, int weight, bool italic, bool emoji, int *face_index) {
  if (!FcInit()) return NULL;
  FcFontSet *set = fallback_set(weight, italic, emoji);
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
