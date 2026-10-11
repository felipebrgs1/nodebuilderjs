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
