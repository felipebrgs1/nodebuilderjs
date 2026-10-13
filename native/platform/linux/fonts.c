// Linux font discovery through fontconfig (honours the user's desktop settings).
#include <fontconfig/fontconfig.h>
#include <stdlib.h>
#include <string.h>

#include "nb.h"

// `family` (NULL: the UI font, "sans-serif") at a CSS weight and slant, or a color emoji font.
// Built with FcPatternAddString, not FcNameParse: family names may contain ':' or '-'.
static FcPattern *pattern(const char *family, int weight, bool italic, bool emoji) {
  FcPattern *pat = FcPatternCreate();
  FcPatternAddString(pat, FC_FAMILY, (const FcChar8 *)(emoji ? "emoji" : family ? family : "sans-serif"));
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

// fontconfig always answers with some font; a named family must really be the one found.
static bool has_family(FcPattern *font, const char *family) {
  FcChar8 *name;
  for (int i = 0; FcPatternGetString(font, FC_FAMILY, i, &name) == FcResultMatch; i++)
    if (FcStrCmpIgnoreCase(name, (const FcChar8 *)family) == 0) return true;
  return false;
}

char *nb_platform_font_path(const char *family, bool generic, int weight, bool italic, nb_font_match *match) {
  if (!FcInit()) return NULL;
  FcPattern *pat = pattern(family, weight, italic, false);
  FcResult result;
  FcPattern *found = FcFontMatch(NULL, pat, &result);
  char *path = NULL;
  if (found && (!family || generic || has_family(found, family))) {
    FcChar8 *file;
    int index = 0, slant = FC_SLANT_ROMAN;
    FcBool embolden = FcFalse;
    if (FcPatternGetString(found, FC_FILE, 0, &file) == FcResultMatch) path = strdup((const char *)file);
    FcPatternGetInteger(found, FC_INDEX, 0, &index);
    FcPatternGetInteger(found, FC_SLANT, 0, &slant);
    // The system config (90-synthetic.conf) marks a lighter match for a bold request.
    FcPatternGetBool(found, FC_EMBOLDEN, 0, &embolden);
    // An upright match stands in for italic: either the slant says so, or the system config
    // (90-synthetic.conf) already marked it italic and added a shear matrix for us to apply.
    FcMatrix *matrix;
    bool sheared = FcPatternGetMatrix(found, FC_MATRIX, 0, &matrix) == FcResultMatch && matrix->xy != 0;
    if (match) *match = (nb_font_match){.index = index, .oblique = italic && (slant == FC_SLANT_ROMAN || sheared), .embolden = embolden};
  }
  if (found) FcPatternDestroy(found);
  FcPatternDestroy(pat);
  return path;
}

// Fallback: the fonts fontconfig would try after the family, best first (FcFontSort, the same
// order browsers and toolkits get), sorted once per (family, weight, italic, emoji) and kept.
#define MAX_SETS 32
static struct {
  char *family;  // NULL: the UI font
  int weight;
  bool italic, emoji;
  FcFontSet *set;
} sorted[MAX_SETS];
static int sorted_count, sorted_next;

static bool same_family(const char *a, const char *b) { return a == b || (a && b && strcmp(a, b) == 0); }

static FcFontSet *fallback_set(const char *family, int weight, bool italic, bool emoji) {
  if (emoji) family = NULL, weight = 0, italic = false;
  for (int i = 0; i < sorted_count; i++)
    if (sorted[i].weight == weight && sorted[i].italic == italic && sorted[i].emoji == emoji && same_family(sorted[i].family, family))
      return sorted[i].set;
  FcPattern *pat = pattern(family, weight, italic, emoji);
  FcResult result;
  FcFontSet *set = FcFontSort(NULL, pat, FcFalse, NULL, &result);
  FcPatternDestroy(pat);
  int slot = sorted_count < MAX_SETS ? sorted_count++ : sorted_next++ % MAX_SETS;  // full: replace the oldest
  if (sorted[slot].set) FcFontSetDestroy(sorted[slot].set);
  free(sorted[slot].family);
  sorted[slot].family = family ? strdup(family) : NULL;
  sorted[slot].weight = weight;
  sorted[slot].italic = italic;
  sorted[slot].emoji = emoji;
  sorted[slot].set = set;
  return set;
}

char *nb_platform_font_fallback(uint32_t codepoint, const char *family, bool generic, int weight, bool italic, bool emoji,
                                int *face_index) {
  if (!FcInit()) return NULL;
  FcFontSet *set = fallback_set(family, weight, italic, emoji);
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

void nb_platform_font_families(void (*fn)(const char *family, void *ud), void *ud) {
  if (!FcInit()) return;
  FcPattern *pat = FcPatternCreate();
  FcObjectSet *os = FcObjectSetBuild(FC_FAMILY, NULL);
  FcFontSet *set = FcFontList(NULL, pat, os);
  for (int i = 0; set && i < set->nfont; i++) {
    FcChar8 *name;
    if (FcPatternGetString(set->fonts[i], FC_FAMILY, 0, &name) == FcResultMatch) fn((const char *)name, ud);
  }
  if (set) FcFontSetDestroy(set);
  FcObjectSetDestroy(os);
  FcPatternDestroy(pat);
}
