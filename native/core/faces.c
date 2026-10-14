// Font faces, app fonts, CSS family lists and matching, features, variations and the
// per-codepoint fallback. See faces.h. Which system font files exist is the platform's call
// (nb_platform_font_*); app fonts (nb_fonts_register) live in memory here.
#include "faces.h"

#include "nb.h"

#include FT_MULTIPLE_MASTERS_H
#include FT_TRUETYPE_TABLES_H
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_FILES 256
#define MAX_REGISTERED 512
#define MAX_SPECS 1024
#define SPEC_SLOTS 2048    // power of two, > MAX_SPECS
#define MAX_VSETS 256      // distinct variation lists
#define MAX_FAMILIES 8     // per family list
#define MAX_FEATURES 32
#define MAX_VARIATIONS 16
#define MAX_STACK (MAX_FAMILIES + 1)
#define STYLE_SLOTS 1024   // power of two
#define FALLBACK_SLOTS 4096  // power of two
#define PLATFORM_CACHE 256  // installed-family lookups remembered
#define FACE_RESERVE 32    // free faces kept for a call (a style stack plus its fallbacks)
#define VSET_RESERVE 8
#define FALLBACK_STALE -2  // a fallback slot whose face was evicted: looked up again on the next hit

FT_Library nb_ft;

// A font file, or one face of a collection. App fonts point into their registered bytes.
typedef struct {
  char *path;
  const uint8_t *data;
  size_t size;
  int index;      // face index, with the named instance in the high bits (system variable fonts)
  FT_Face probe;  // unsized, at `index`: coverage checks, axes, the named instance's coordinates
  bool mm, wght, color;
  int wght_min, wght_max;
} font_file;

typedef struct {
  int file;
  bool oblique, embolden;
  int weight;     // the wght coordinate (files with a wght axis; 0 otherwise)
  int vset;       // the spec's variation list (files with axes; 0 otherwise)
  bool live;      // false: an evicted slot, free for the next face
  uint8_t gen;    // bumped when the slot is reused, so glyphs cached for the old face miss
  uint32_t used;  // the tick of the last style or fallback that returned it (LRU)
} face_entry;

typedef struct {
  char *text;
  hb_variation_t vars[MAX_VARIATIONS];
  int count;
} variation_set;

typedef struct {
  char name[128];
  bool generic;
} family_name;

// What a TEXT command's spec string says, parsed once.
typedef struct {
  char *text;
  family_name families[MAX_FAMILIES];
  int nfamilies;
  hb_feature_t features[MAX_FEATURES];
  int nfeatures;
  int vset;
} spec_entry;

typedef struct {
  uint32_t key;  // spec << 11 | font id, + 1 (0 = empty)
  int faces[MAX_STACK];
  int count;
  const char *fallback;  // the first system family of the list (NULL: the UI font)
  bool fallback_generic;
  bool ascii;  // faces[0] has all of printable ASCII
} style_entry;

typedef struct {
  uint64_t key;  // codepoint | style << 21 | emoji << 40, + 1 (0 = empty)
  int face;      // -1: no font has it
} fallback_slot;

typedef struct {
  char *family;
  int file, weight_min, weight_max;
  bool italic;
} registry_entry;

// What the platform answered for an installed family (NULL: the UI font) at a weight and slant.
typedef struct {
  char *family;
  bool generic, italic, oblique, embolden;
  int weight, file;  // file -1: not installed
} platform_entry;

static font_file files[MAX_FILES];
static int file_count;
static face_entry faces[NB_MAX_FACES];
static int face_count, live_faces;  // slots ever used, and the ones holding a face
static variation_set vsets[MAX_VSETS] = {{.text = ""}};  // text NULL: a free slot
static int vset_count = 1, live_vsets = 1;
static uint32_t tick;  // one per nb_font_style call
static spec_entry specs[MAX_SPECS];
static int spec_slots[SPEC_SLOTS];  // spec index + 1
static int spec_count;
static style_entry styles[STYLE_SLOTS];
static int style_count;
static fallback_slot fallbacks[FALLBACK_SLOTS];
static int fallback_count;
static registry_entry registry[MAX_REGISTERED];
static int registry_count;
static platform_entry platform_cache[PLATFORM_CACHE];
static int platform_count;

static int platform_face(const char *family, bool generic, int weight, bool italic, int vset);
static int intern_spec(const char *text);

bool nb_fonts_init(void) {
  if (nb_ft) return true;
  if (FT_Init_FreeType(&nb_ft)) return false;
  specs[0].text = "";
  spec_count = 1;
  if (platform_face(NULL, false, 400, false, 0) != 0) {  // face 0: the regular UI font
    fprintf(stderr, "nodebuilder: no UI font found\n");
    FT_Done_FreeType(nb_ft);
    nb_ft = NULL;
    return false;
  }
  return true;
}

// ---- files and faces ----------------------------------------------------------------

static bool ascii_equal(const char *a, const char *b) {
  for (; *a && *b; a++, b++) {
    char x = *a >= 'A' && *a <= 'Z' ? *a + 32 : *a, y = *b >= 'A' && *b <= 'Z' ? *b + 32 : *b;
    if (x != y) return false;
  }
  return *a == *b;
}

static void read_axes(font_file *f) {
  FT_MM_Var *mm;
  f->color = FT_HAS_COLOR(f->probe);
  if (!FT_HAS_MULTIPLE_MASTERS(f->probe) || FT_Get_MM_Var(f->probe, &mm)) return;
  f->mm = mm->num_axis > 0;
  for (FT_UInt a = 0; a < mm->num_axis; a++) {
    if (mm->axis[a].tag != FT_MAKE_TAG('w', 'g', 'h', 't')) continue;
    f->wght = true;
    f->wght_min = (int)(mm->axis[a].minimum >> 16);
    f->wght_max = (int)(mm->axis[a].maximum >> 16);
  }
  FT_Done_MM_Var(nb_ft, mm);
}

// The file for a path (taking ownership of it) or for registered bytes, at `index`; -1 when
// FreeType can't open it or the table is full.
static int add_file(char *path, const uint8_t *data, size_t size, int index) {
  for (int i = 0; i < file_count; i++) {
    if (files[i].index != index) continue;
    if (path ? files[i].path && strcmp(files[i].path, path) == 0 : files[i].data == data) {
      free(path);
      return i;
    }
  }
  FT_Face probe;
  if (file_count == MAX_FILES ||
      (path ? FT_New_Face(nb_ft, path, index, &probe) : FT_New_Memory_Face(nb_ft, data, (FT_Long)size, index, &probe))) {
    free(path);
    return -1;
  }
  font_file *f = &files[file_count];
  *f = (font_file){.path = path, .data = data, .size = size, .index = index, .probe = probe};
  read_axes(f);
  return file_count++;
}

// The face for a file drawn this way, shared by everyone who asks for the same thing. Only a
// file with axes has per-weight and per-variation faces.
static int add_face(int file, bool oblique, bool embolden, int weight, int vset) {
  if (file < 0) return -1;
  font_file *f = &files[file];
  if (!f->mm) vset = 0;
  if (!f->wght) weight = 0;
  int closest = -1, free_slot = -1;
  for (int i = 0; i < face_count; i++) {
    face_entry *e = &faces[i];
    if (!e->live) {
      if (free_slot < 0) free_slot = i;
      continue;
    }
    if (e->file != file || e->oblique != oblique || e->embolden != embolden) continue;
    if (e->weight == weight && e->vset == vset) return e->used = tick, i;
    if (closest < 0 || abs(e->weight - weight) < abs(faces[closest].weight - weight)) closest = i;
  }
  if (free_slot < 0) {
    // Full even after nb_font_style's eviction (one call needing ~200 faces): the nearest we have.
    if (face_count == NB_MAX_FACES) return closest >= 0 ? closest : 0;
    free_slot = face_count++;
  }
  uint8_t gen = (uint8_t)(faces[free_slot].gen + 1);
  faces[free_slot] = (face_entry){.file = file, .oblique = oblique, .embolden = embolden, .weight = weight, .vset = vset,
                                  .live = true, .gen = gen, .used = tick};
  live_faces++;
  return free_slot;
}

static bool covers(int face, uint32_t cp) { return FT_Get_Char_Index(files[faces[face].file].probe, cp) != 0; }

// A variable face is opened at its base index, because HarfBuzz ignores the coordinates
// FreeType gives a named instance (index >> 16); the instance's coordinates come from the
// probe, then `wght` is set to the weight and the spec's variations override any axis (all
// clamped to the axis).
static void set_variations(FT_Face ft, const face_entry *e) {
  const font_file *f = &files[e->file];
  FT_MM_Var *mm;
  if (FT_Get_MM_Var(ft, &mm)) return;
  FT_Fixed coords[32];
  FT_UInt n = mm->num_axis < 32 ? mm->num_axis : 32;
  if (!FT_Get_Var_Design_Coordinates(f->probe, n, coords)) {
    const variation_set *vs = &vsets[e->vset];
    for (FT_UInt a = 0; a < n; a++) {
      const FT_Var_Axis *axis = &mm->axis[a];
      FT_Fixed v = coords[a];
      if (axis->tag == FT_MAKE_TAG('w', 'g', 'h', 't') && e->weight) v = (FT_Fixed)e->weight << 16;
      for (int k = 0; k < vs->count; k++)
        if (vs->vars[k].tag == axis->tag) v = (FT_Fixed)(vs->vars[k].value * 65536.0f);
      coords[a] = v < axis->minimum ? axis->minimum : v > axis->maximum ? axis->maximum : v;
    }
    FT_Set_Var_Design_Coordinates(ft, n, coords);
  }
  FT_Done_MM_Var(nb_ft, mm);
}

FT_Face nb_face_open(int face) {
  if (face < 0 || face >= face_count || !faces[face].live) face = 0;
  const face_entry *e = &faces[face];
  const font_file *f = &files[e->file];
  FT_Face ft;
  int index = f->mm ? f->index & 0xFFFF : f->index;
  if (f->data ? FT_New_Memory_Face(nb_ft, f->data, (FT_Long)f->size, index, &ft) : FT_New_Face(nb_ft, f->path, index, &ft))
    return NULL;
  if (f->mm) set_variations(ft, e);
  if (e->oblique && FT_IS_SCALABLE(ft)) {  // ~11 degrees, about what browsers use for synthetic italics
    FT_Matrix shear = {.xx = 0x10000, .xy = 0x3333, .yx = 0, .yy = 0x10000};
    FT_Set_Transform(ft, &shear, NULL);
  }
  return ft;
}

bool nb_face_embolden(int face) { return face >= 0 && face < face_count && faces[face].embolden; }

uint8_t nb_face_gen(int face) { return face >= 0 && face < face_count ? faces[face].gen : 0; }

// ---- system and app families ------------------------------------------------------------

// The platform's match is remembered: every new weight is a new style (an animated fontWeight,
// one per frame), and asking fontconfig costs far more than the rest of resolving it.
static const platform_entry *platform_match(const char *family, bool generic, int weight, bool italic) {
  for (int i = 0; i < platform_count; i++) {
    const platform_entry *p = &platform_cache[i];
    if (p->weight == weight && p->italic == italic && p->generic == generic &&
        (family ? p->family && strcmp(p->family, family) == 0 : !p->family))
      return p;
  }
  if (platform_count == PLATFORM_CACHE) {  // full: start over
    for (int i = 0; i < platform_count; i++) free(platform_cache[i].family);
    platform_count = 0;
  }
  nb_font_match m = {0};
  char *path = nb_platform_font_path(family, generic, weight, italic, &m);
  int file = path ? add_file(path, NULL, 0, m.index) : -1;
  platform_entry *p = &platform_cache[platform_count++];
  *p = (platform_entry){.family = family ? strdup(family) : NULL, .generic = generic, .italic = italic, .weight = weight,
                        .file = file, .oblique = m.oblique, .embolden = m.embolden};
  return p;
}

static int platform_face(const char *family, bool generic, int weight, bool italic, int vset) {
  const platform_entry *p = platform_match(family, generic, weight, italic);
  if (p->file < 0) return -1;
  // A variable font has the weight itself; anything else lighter than asked is emboldened.
  return add_face(p->file, p->oblique, p->embolden && !files[p->file].wght, weight, vset);
}

// Among the faces registered under `family`, the ones CSS would pick (CSS Fonts 4, "font style
// matching"): the slant first (italic, else upright slanted; upright, else italic), then the
// weight: inside a face's range; else, asking 400..500, heavier up to 500, then lighter, then
// heavier; below 400, lighter then heavier; above 500, heavier then lighter. Faces that tie
// (same descriptors) all go to the stack, in the order they were registered, so each one fills
// in the characters the ones before it lack. What a face lacks is synthesized: the slant, and
// bold when asking 600+ of a face below 600. Returns how many faces were pushed.
static int rank_of(const registry_entry *r, int weight, int *distance) {
  if (weight >= r->weight_min && weight <= r->weight_max) return *distance = 0, 0;
  if (r->weight_min > weight) {  // heavier
    *distance = r->weight_min - weight;
    return weight < 400 ? 2 : weight > 500 ? 1 : r->weight_min <= 500 ? 1 : 3;
  }
  *distance = weight - r->weight_max;  // lighter
  return weight < 400 ? 1 : 2;
}

static void push_face(style_entry *st, int face);

static int push_registered(style_entry *st, const char *family, int weight, bool italic, int vset) {
  bool any = false, has_slant = false;
  for (int i = 0; i < registry_count; i++) {
    if (!ascii_equal(registry[i].family, family)) continue;
    any = true;
    if (registry[i].italic == italic) has_slant = true;
  }
  if (!any) return 0;
  bool slant = has_slant ? italic : !italic;
  int best_rank = -1, best_distance = 0, pushed = 0;
  for (int pass = 0; pass < 2; pass++) {  // find the best rank, then push every face that has it
    for (int i = 0; i < registry_count; i++) {
      registry_entry *r = &registry[i];
      if (r->italic != slant || !ascii_equal(r->family, family)) continue;
      int distance, rank = rank_of(r, weight, &distance);
      if (pass == 0) {
        if (best_rank < 0 || rank < best_rank || (rank == best_rank && distance < best_distance)) best_rank = rank, best_distance = distance;
      } else if (rank == best_rank && distance == best_distance) {
        int used = weight < r->weight_min ? r->weight_min : weight > r->weight_max ? r->weight_max : weight;
        push_face(st, add_face(r->file, italic && !r->italic, weight >= 600 && used < 600, used, vset));
        pushed++;
      }
    }
  }
  return pushed;
}

// ---- specs ------------------------------------------------------------------------------

static const char *const generics[][2] = {
    {"serif", "serif"},         {"sans-serif", "sans-serif"},  {"monospace", "monospace"},   {"cursive", "cursive"},
    {"fantasy", "fantasy"},     {"emoji", "emoji"},            {"math", "math"},             {"fangsong", "fangsong"},
    {"system-ui", "sans-serif"}, {"ui-sans-serif", "sans-serif"}, {"ui-rounded", "sans-serif"}, {"ui-serif", "serif"},
    {"ui-monospace", "monospace"},
};

static bool space(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }

// A CSS family list: names, quoted or not (whitespace runs collapse), and unquoted generic names.
static void parse_families(spec_entry *sp, const char *s, const char *end) {
  while (s < end && sp->nfamilies < MAX_FAMILIES) {
    while (s < end && (space(*s) || *s == ',')) s++;
    if (s >= end) break;
    family_name *fam = &sp->families[sp->nfamilies];
    size_t n = 0;
    bool quoted = *s == '"' || *s == '\'';
    if (quoted) {
      char q = *s++;
      for (; s < end && *s != q; s++)
        if (n + 1 < sizeof fam->name) fam->name[n++] = *s;
      while (s < end && *s != ',') s++;
    } else {
      for (; s < end && *s != ','; s++) {
        if (space(*s)) {
          if (n && fam->name[n - 1] != ' ' && n + 1 < sizeof fam->name) fam->name[n++] = ' ';
        } else if (n + 1 < sizeof fam->name) {
          fam->name[n++] = *s;
        }
      }
      while (n && fam->name[n - 1] == ' ') n--;
    }
    fam->name[n] = 0;
    if (!n) continue;
    fam->generic = false;
    for (size_t g = 0; !quoted && g < sizeof generics / sizeof generics[0]; g++) {
      if (!ascii_equal(fam->name, generics[g][0])) continue;
      strcpy(fam->name, generics[g][1]);
      fam->generic = true;
    }
    sp->nfamilies++;
  }
}

// Calls `fn` with each comma-separated item, trimmed.
static void each_item(const char *s, const char *end, void (*fn)(const char *item, int len, void *ud), void *ud) {
  while (s < end) {
    const char *comma = memchr(s, ',', (size_t)(end - s));
    const char *stop = comma ? comma : end, *a = s, *b = stop;
    while (a < b && space(*a)) a++;
    while (b > a && space(b[-1])) b--;
    if (b > a) fn(a, (int)(b - a), ud);
    s = stop + 1;
  }
}

static void add_feature(const char *item, int len, void *ud) {
  spec_entry *sp = ud;
  if (sp->nfeatures < MAX_FEATURES && hb_feature_from_string(item, len, &sp->features[sp->nfeatures])) sp->nfeatures++;
}

static void add_variation(const char *item, int len, void *ud) {
  variation_set *vs = ud;
  if (vs->count < MAX_VARIATIONS && hb_variation_from_string(item, len, &vs->vars[vs->count])) vs->count++;
}

static int intern_vset(const char *s, const char *end) {
  size_t n = (size_t)(end - s);
  if (!n) return 0;
  int slot = -1;
  for (int i = 1; i < vset_count; i++) {
    if (!vsets[i].text) {
      if (slot < 0) slot = i;
    } else if (strlen(vsets[i].text) == n && memcmp(vsets[i].text, s, n) == 0) {
      return i;
    }
  }
  if (slot < 0) {
    if (vset_count == MAX_VSETS) return 0;  // full even after nb_font_style made room
    slot = vset_count;
  }
  variation_set *vs = &vsets[slot];
  vs->text = strndup(s, n);
  vs->count = 0;
  each_item(s, end, add_variation, vs);
  if (!vs->count) return free(vs->text), vs->text = NULL, 0;
  if (slot == vset_count) vset_count++;
  live_vsets++;
  return slot;
}

// Spec: family list, features and variations, separated by U+001F.
static void parse_spec(spec_entry *sp) {
  const char *s = sp->text, *end = s + strlen(s);
  const char *f1 = memchr(s, 0x1f, (size_t)(end - s));
  const char *fam_end = f1 ? f1 : end;
  const char *feat = f1 ? f1 + 1 : end;
  const char *f2 = memchr(feat, 0x1f, (size_t)(end - feat));
  const char *feat_end = f2 ? f2 : end;
  const char *vars = f2 ? f2 + 1 : end;
  sp->nfamilies = sp->nfeatures = 0;
  parse_families(sp, s, fam_end);
  each_item(feat, feat_end, add_feature, sp);
  sp->vset = intern_vset(vars, end);
}

static uint32_t hash_string(const char *s) {
  uint32_t h = 2166136261u;
  for (; *s; s++) h = (h ^ (unsigned char)*s) * 16777619u;
  return h;
}

static void reset_styles(void) {
  memset(styles, 0, sizeof styles);
  memset(fallbacks, 0, sizeof fallbacks);
  style_count = fallback_count = 0;
}

static int intern_spec(const char *text) {
  if (!text || !*text) return 0;
  uint32_t h = hash_string(text) & (SPEC_SLOTS - 1);
  for (;; h = (h + 1) & (SPEC_SLOTS - 1)) {
    int i = spec_slots[h] - 1;
    if (i < 0) break;
    if (strcmp(specs[i].text, text) == 0) return i;
  }
  if (spec_count == MAX_SPECS) {  // full: start over (styles refer to specs, so they go too)
    for (int i = 1; i < spec_count; i++) free(specs[i].text);
    memset(spec_slots, 0, sizeof spec_slots);
    spec_count = 1;
    reset_styles();
    return intern_spec(text);
  }
  int i = spec_count++;
  specs[i].text = strdup(text);
  parse_spec(&specs[i]);
  spec_slots[h] = i + 1;
  return i;
}

// ---- styles -----------------------------------------------------------------------------

static void push_face(style_entry *st, int face) {
  if (face < 0 || st->count == MAX_STACK) return;
  for (int i = 0; i < st->count; i++)
    if (st->faces[i] == face) return;
  st->faces[st->count++] = face;
}

static void resolve(style_entry *st, int spec, int font) {
  const spec_entry *sp = &specs[spec];
  int weight = font >> 1;
  bool italic = font & 1;
  st->count = 0;
  st->fallback = NULL;
  for (int i = 0; i < sp->nfamilies; i++) {
    const family_name *fam = &sp->families[i];
    if (!fam->generic && push_registered(st, fam->name, weight, italic, sp->vset)) continue;
    int face = platform_face(fam->name, fam->generic, weight, italic, sp->vset);
    if (face >= 0 && !st->fallback) st->fallback = fam->name, st->fallback_generic = fam->generic;
    push_face(st, face);
  }
  int ui = platform_face(NULL, false, weight, italic, sp->vset);
  push_face(st, ui < 0 ? 0 : ui);
  st->ascii = true;
  for (uint32_t cp = 0x20; cp < 0x7F && st->ascii; cp++) st->ascii = covers(st->faces[0], cp);
}

// ---- eviction ---------------------------------------------------------------------------
//
// Every distinct weight of a variable font and every distinct variation list is a face, so an
// animated fontWeight or fontVariations makes a new one per frame. Before a call could run out,
// nb_font_style evicts the least recently used faces of variable files (the others are bounded
// by the files) and the styles and fallbacks that pointed at them resolve again on their next
// use. It runs only there, at the start of a measure or draw call, when nothing holds a face.

static int by_use(const void *a, const void *b) {
  uint32_t x = faces[*(const int *)a].used, y = faces[*(const int *)b].used;
  return x < y ? -1 : x > y;
}

static void evict_faces(void) {
  int order[NB_MAX_FACES], n = 0;
  for (int i = 1; i < face_count; i++)  // never face 0, the UI font
    if (faces[i].live && files[faces[i].file].mm) order[n++] = i;
  qsort(order, (size_t)n, sizeof order[0], by_use);
  bool evicted[NB_MAX_FACES] = {false};
  for (int k = 0; k < n && live_faces > NB_MAX_FACES / 2; k++) {
    faces[order[k]].live = false;
    evicted[order[k]] = true;
    live_faces--;
    nb_text_forget_face(order[k]);
  }
  for (int h = 0; h < STYLE_SLOTS; h++) {
    style_entry *st = &styles[h];
    for (int i = 0; i < st->count; i++)
      if (evicted[st->faces[i]]) st->count = 0;  // stale: resolved again when asked for
  }
  for (int h = 0; h < FALLBACK_SLOTS; h++)
    if (fallbacks[h].key && fallbacks[h].face >= 0 && evicted[fallbacks[h].face]) fallbacks[h].face = FALLBACK_STALE;
}

// Variation lists are referenced by specs and faces: drop every spec (and so every style), evict
// faces, then free the lists no face uses.
static void evict_variations(void) {
  for (int i = 1; i < spec_count; i++) free(specs[i].text);
  memset(spec_slots, 0, sizeof spec_slots);
  spec_count = 1;
  reset_styles();
  evict_faces();
  bool used[MAX_VSETS] = {true};
  for (int i = 0; i < face_count; i++)
    if (faces[i].live) used[faces[i].vset] = true;
  for (int i = 1; i < vset_count; i++) {
    if (used[i] || !vsets[i].text) continue;
    free(vsets[i].text);
    vsets[i].text = NULL;
    live_vsets--;
  }
}

static int valid_font(int font) { return font >= 2 && font <= 2001 ? font : NB_FONT_REGULAR; }

int nb_font_style(const char *spec_text, int font) {
  tick++;
  if (live_vsets > MAX_VSETS - VSET_RESERVE) evict_variations();
  if (live_faces > NB_MAX_FACES - FACE_RESERVE) evict_faces();
  font = valid_font(font);
  int spec = intern_spec(spec_text);
  uint32_t key = ((uint32_t)spec << 11 | (uint32_t)font) + 1;
  uint32_t h = (key * 2654435761u >> 16) & (STYLE_SLOTS - 1);
  for (;; h = (h + 1) & (STYLE_SLOTS - 1)) {
    if (styles[h].key == key) {
      style_entry *st = &styles[h];
      if (!st->count) resolve(st, spec, font);  // a face of it was evicted
      for (int i = 0; i < st->count; i++) faces[st->faces[i]].used = tick;
      return (int)h;
    }
    if (!styles[h].key) break;
  }
  if (style_count * 4 >= STYLE_SLOTS * 3) {  // mostly full: start over
    reset_styles();
    return nb_font_style(spec_text, font);
  }
  style_entry *st = &styles[h];
  st->key = key;
  style_count++;
  resolve(st, spec, font);
  return (int)h;
}

int nb_font_primary(int style) { return styles[style].faces[0]; }

bool nb_font_ascii(int style) { return styles[style].ascii; }

const hb_feature_t *nb_font_features(int style, int *count) {
  const spec_entry *sp = &specs[(styles[style].key - 1) >> 11];
  *count = sp->nfeatures;
  return sp->features;
}

// ---- fallback ---------------------------------------------------------------------------

static int platform_fallback(const style_entry *st, uint32_t cp, bool emoji) {
  int index = 0, font = (int)((st->key - 1) & 0x7FF), vset = specs[(st->key - 1) >> 11].vset;
  char *path = nb_platform_font_fallback(cp, st->fallback, st->fallback_generic, font >> 1, font & 1, emoji, &index);
  if (!path) return -1;
  return add_face(add_file(path, NULL, 0, index), false, false, emoji ? 0 : font >> 1, vset);
}

static uint32_t fallback_hash(uint64_t key) { return (uint32_t)((key * 0x9E3779B97F4A7C15ull) >> 40) & (FALLBACK_SLOTS - 1); }

// Emoji presentation prefers a color font of the list, then the system's; otherwise the first
// face of the list that has the glyph, then the system's fallback after the list's first system
// family. Nothing has it: the first face (its .notdef).
int nb_font_face_for(int style, uint32_t cp, bool emoji) {
  const style_entry *st = &styles[style];
  uint64_t key = (cp | (uint64_t)style << 21 | (uint64_t)emoji << 40) + 1;
  uint32_t h = fallback_hash(key);
  for (;; h = (h + 1) & (FALLBACK_SLOTS - 1)) {
    if (fallbacks[h].key == key && fallbacks[h].face != FALLBACK_STALE) {
      int face = fallbacks[h].face;
      if (face < 0) return st->faces[0];
      faces[face].used = tick;
      return face;
    }
    if (fallbacks[h].key == key || !fallbacks[h].key) break;
  }
  int face = -1;
  if (emoji) {
    for (int i = 0; i < st->count && face < 0; i++)
      if (files[faces[st->faces[i]].file].color && covers(st->faces[i], cp)) face = st->faces[i];
    if (face < 0) face = platform_fallback(st, cp, true);
  }
  for (int i = 0; i < st->count && face < 0; i++)
    if (covers(st->faces[i], cp)) face = st->faces[i];
  if (face < 0) face = platform_fallback(st, cp, false);
  if (fallbacks[h].key == key) {  // a stale slot: refreshed in place
    fallbacks[h].face = face;
    return face < 0 ? st->faces[0] : face;
  }
  if (fallback_count * 4 >= FALLBACK_SLOTS * 3) {  // mostly full: start over
    memset(fallbacks, 0, sizeof fallbacks);
    fallback_count = 0;
    h = fallback_hash(key);
  }
  fallbacks[h] = (fallback_slot){.key = key, .face = face};
  fallback_count++;
  return face < 0 ? st->faces[0] : face;
}

// ---- app fonts --------------------------------------------------------------------------

static int file_weight(FT_Face f) {
  TT_OS2 *os2 = FT_Get_Sfnt_Table(f, FT_SFNT_OS2);
  int w = os2 && os2->version != 0xFFFF ? os2->usWeightClass : 0;
  if (w >= 1 && w <= 9) w *= 100;  // some old fonts use 1..9
  if (w < 1 || w > 1000) w = f->style_flags & FT_STYLE_FLAG_BOLD ? 700 : 400;
  return w;
}

int nb_fonts_register(const uint8_t *data, size_t size, const char *family, int weight_min, int weight_max, int italic,
                      nb_font_info *out, int max, char *error, size_t error_size) {
  if (!nb_fonts_init()) {
    snprintf(error, error_size, "text engine initialisation failed");
    return -1;
  }
  // The same bytes registered again (another name, weight...) share one copy.
  const uint8_t *blob = NULL;
  for (int i = 0; i < file_count && !blob; i++)
    if (files[i].data && files[i].size == size && memcmp(files[i].data, data, size) == 0) blob = files[i].data;
  uint8_t *copy = NULL;
  if (!blob) {
    if (!(copy = malloc(size ? size : 1))) {
      snprintf(error, error_size, "out of memory");
      return -1;
    }
    memcpy(copy, data, size);
    blob = copy;
  }
  FT_Face first;
  FT_Error err = FT_New_Memory_Face(nb_ft, blob, (FT_Long)size, 0, &first);
  if (err) {
    free(copy);
    snprintf(error, error_size, "not a font file this system can read (FreeType error 0x%02x)", err);
    return -1;
  }
  int count = (int)first->num_faces, added = 0;
  FT_Done_Face(first);
  for (int index = 0; index < count && registry_count < MAX_REGISTERED; index++) {
    int file = add_file(NULL, blob, size, index);
    if (file < 0) continue;
    font_file *f = &files[file];
    const char *name = family ? family : f->probe->family_name ? f->probe->family_name : "Unnamed";
    registry_entry r = {.file = file, .italic = italic >= 0 ? italic : (f->probe->style_flags & FT_STYLE_FLAG_ITALIC) != 0};
    if (weight_min > 0) {
      r.weight_min = weight_min;
      r.weight_max = weight_max >= weight_min ? weight_max : weight_min;
    } else if (f->wght) {
      r.weight_min = f->wght_min, r.weight_max = f->wght_max;
    } else {
      r.weight_min = r.weight_max = file_weight(f->probe);
    }
    bool known = false;
    for (int i = 0; i < registry_count && !known; i++) {
      registry_entry *o = &registry[i];
      known = o->file == file && o->italic == r.italic && o->weight_min == r.weight_min && o->weight_max == r.weight_max &&
              strcmp(o->family, name) == 0;
    }
    if (!known) {
      r.family = strdup(name);
      registry[registry_count++] = r;
    }
    if (added < max) {
      nb_font_info *info = &out[added];
      snprintf(info->family, sizeof info->family, "%s", name);
      info->weight_min = r.weight_min, info->weight_max = r.weight_max;
      info->italic = r.italic, info->variable = f->wght;
    }
    added++;
  }
  if (!added) {
    bool used = false;
    for (int i = 0; i < file_count; i++) used |= files[i].data == copy;
    if (!used) free(copy);
    snprintf(error, error_size, "no face in the file could be opened");
    return -1;
  }
  reset_styles();  // families may resolve differently now
  return added;
}

void nb_fonts_families(void (*fn)(const char *family, void *ud), void *ud) {
  for (int i = 0; i < registry_count; i++) fn(registry[i].family, ud);
  nb_platform_font_families(fn, ud);
}

void nb_fonts_stats(nb_font_stats *out) {
  *out = (nb_font_stats){.faces = live_faces, .variations = live_vsets, .specs = spec_count, .styles = style_count,
                         .sizes = nb_text_size_count()};
}

// ---- diagnostics ----------------------------------------------------------------------

// Both work before nb_fonts_init (which fails on a machine without fonts, the case the
// doctor has to describe): they borrow a FreeType instance when there is none yet.
static FT_Library diagnostics_library(void) {
  if (nb_ft) return nb_ft;
  FT_Library lib = NULL;
  return FT_Init_FreeType(&lib) ? NULL : lib;
}

void nb_fonts_versions(char *freetype, size_t size, const char **harfbuzz) {
  *harfbuzz = hb_version_string();
  FT_Library lib = diagnostics_library();
  FT_Int major = 0, minor = 0, patch = 0;
  if (lib) FT_Library_Version(lib, &major, &minor, &patch);
  snprintf(freetype, size, "%d.%d.%d", major, minor, patch);
  if (lib && lib != nb_ft) FT_Done_FreeType(lib);
}

bool nb_fonts_file_family(const char *path, int index, char *out, size_t size) {
  FT_Library lib = diagnostics_library();
  FT_Face face = NULL;
  bool ok = lib && !FT_New_Face(lib, path, index, &face) && face->family_name;
  if (ok) snprintf(out, size, "%s", face->family_name);
  if (face) FT_Done_Face(face);
  if (lib && lib != nb_ft) FT_Done_FreeType(lib);
  return ok;
}
