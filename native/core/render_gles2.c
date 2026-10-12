// GLES2 renderer: executes the command buffer produced by src/render/paint.ts.
// Everything (rounded rects, borders, shadows, glyphs, color emoji) goes through one shader
// and one vertex format, so draw order is preserved with a single batch that is
// only flushed when the clip changes. Clips are a scissor rectangle plus an
// optional rounded mask (the innermost rounded clip) evaluated per fragment.
// Colors are premultiplied in the vertex shader, so whatever varies per vertex (gradients,
// antialiasing coverage) is interpolated in premultiplied space, like CSS.
#include "nb.h"

#include <GLES2/gl2.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { MODE_RECT = 0, MODE_GLYPH = 1, MODE_SHADOW = 2, MODE_IMAGE = 3, MODE_LINE = 4, MODE_SOLID = 5, MODE_ARC = 6,
       MODE_COLOR_GLYPH = 7 };

// pos(2) local(2) half(2) color(4) border_color(4) params(3: radius, border|blur, mode) uv(2)
#define VERTEX_FLOATS 19
#define MAX_CLIP_DEPTH 64

static const char *vertex_src =
    "attribute vec2 a_pos; attribute vec2 a_local; attribute vec2 a_half;\n"
    "attribute vec4 a_color; attribute vec4 a_bcolor; attribute vec3 a_params; attribute vec2 a_uv;\n"
    "uniform vec2 u_viewport;\n"
    "varying vec2 v_local; varying vec2 v_half; varying vec4 v_color; varying vec4 v_bcolor;\n"
    "varying vec3 v_params; varying vec2 v_uv;\n"
    "void main() {\n"
    "  vec2 ndc = a_pos / u_viewport * 2.0 - 1.0;\n"
    "  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);\n"
    "  v_local = a_local; v_half = a_half; v_color = vec4(a_color.rgb * a_color.a, a_color.a); v_bcolor = a_bcolor;\n"
    "  v_params = a_params; v_uv = a_uv;\n"
    "}\n";

static const char *fragment_src =
    "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n"
    "varying vec2 v_local; varying vec2 v_half; varying vec4 v_color; varying vec4 v_bcolor;\n"
    "varying vec3 v_params; varying vec2 v_uv;\n"
    "uniform sampler2D u_atlas; uniform sampler2D u_image; uniform sampler2D u_color_atlas;\n"
    "uniform vec4 u_clip; uniform float u_clip_radius; uniform float u_fb_height;\n"
    "float sd_round_box(vec2 p, vec2 b, float r) {\n"
    "  vec2 q = abs(p) - b + vec2(r);\n"
    "  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;\n"
    "}\n"
    "void main() {\n"
    "  vec4 c;\n"
    "  vec4 pm = v_color;\n"
    "  if (v_params.z > 6.5) {\n"  // color glyph (premultiplied texels): only the alpha applies
    "    c = texture2D(u_color_atlas, v_uv) * v_color.a;\n"
    "  } else if (v_params.z > 5.5) {\n"  // ring sector, centered on +y: half aperture (sin, cos) in v_half
    "    vec2 q = vec2(abs(v_local.x), v_local.y);\n"
    "    float d = length(q) - v_params.x;\n"
    "    if (v_half.y > -0.9999) {\n"
    "      float m = length(q - v_half * clamp(dot(q, v_half), 0.0, v_params.x));\n"
    "      d = max(d, m * sign(v_half.y * q.x - v_half.x * q.y));\n"
    "    }\n"
    "    d = max(d, v_params.y - length(v_local));\n"
    "    c = pm * clamp(0.5 - d, 0.0, 1.0);\n"
    "  } else if (v_params.z > 4.5) {\n"  // triangles: coverage is already in the alpha
    "    c = pm;\n"
    "  } else if (v_params.z > 3.5) {\n"  // segment along +x from 0 to length; caps in v_half
    "    float hw = v_params.x, len = v_params.y, d;\n"
    "    if (v_local.x < 0.0) d = v_half.x > 0.5 ? length(v_local) - hw : max(-v_local.x, abs(v_local.y) - hw);\n"
    "    else if (v_local.x > len) d = v_half.y > 0.5 ? length(v_local - vec2(len, 0.0)) - hw : max(v_local.x - len, abs(v_local.y) - hw);\n"
    "    else d = abs(v_local.y) - hw;\n"
    "    c = pm * clamp(0.5 - d, 0.0, 1.0);\n"
    "  } else if (v_params.z > 2.5) {\n"  // image (premultiplied texels), rounded like a rect
    "    float d = sd_round_box(v_local, v_half, v_params.x);\n"
    "    c = texture2D(u_image, v_uv) * pm * clamp(0.5 - d, 0.0, 1.0);\n"
    "  } else if (v_params.z > 1.5) {\n"  // shadow
    "    float d = sd_round_box(v_local, v_half, v_params.x);\n"
    "    c = pm * (1.0 - smoothstep(-v_params.y, v_params.y, d));\n"
    "  } else if (v_params.z > 0.5) {\n"  // glyph
    "    c = pm * texture2D(u_atlas, v_uv).a;\n"
    "  } else {\n"  // rounded rect; the border is composited over the fill (premultiplied)
    "    float d = sd_round_box(v_local, v_half, v_params.x);\n"
    "    c = pm;\n"
    "    if (v_params.y > 0.0) {\n"
    "      float ring = 1.0 - clamp(0.5 - (d + v_params.y), 0.0, 1.0);\n"
    "      vec4 b = vec4(v_bcolor.rgb * v_bcolor.a, v_bcolor.a) * ring;\n"
    "      c = b + c * (1.0 - b.a);\n"
    "    }\n"
    "    c *= clamp(0.5 - d, 0.0, 1.0);\n"
    "  }\n"
    "  if (u_clip_radius > 0.0) {\n"
    "    vec2 p = vec2(gl_FragCoord.x, u_fb_height - gl_FragCoord.y);\n"
    "    vec2 half_size = (u_clip.zw - u_clip.xy) * 0.5;\n"
    "    c *= clamp(0.5 - sd_round_box(p - u_clip.xy - half_size, half_size, u_clip_radius), 0.0, 1.0);\n"
    "  }\n"
    "  gl_FragColor = c;\n"
    "}\n";

static GLuint program, vbo, atlas_tex, color_atlas_tex;
static GLint u_viewport, u_atlas, u_image, u_color_atlas, u_clip, u_clip_radius, u_fb_height;
static float *verts;
static size_t vert_count, vert_cap;
static int fb_w, fb_h;

static GLuint compile(GLenum type, const char *src) {
  GLuint s = glCreateShader(type);
  glShaderSource(s, 1, &src, NULL);
  glCompileShader(s);
  GLint ok;
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char log[1024];
    glGetShaderInfoLog(s, sizeof log, NULL, log);
    fprintf(stderr, "nodebuilder: shader error: %s\n", log);
  }
  return s;
}

static const char *attr_names[] = {"a_pos", "a_local", "a_half", "a_color", "a_bcolor", "a_params", "a_uv"};
static const int attr_sizes[] = {2, 2, 2, 4, 4, 3, 2};

bool nb_render_init(void) {
  if (program) return true;
  program = glCreateProgram();
  glAttachShader(program, compile(GL_VERTEX_SHADER, vertex_src));
  glAttachShader(program, compile(GL_FRAGMENT_SHADER, fragment_src));
  for (int i = 0; i < 7; i++) glBindAttribLocation(program, i, attr_names[i]);
  glLinkProgram(program);
  GLint ok;
  if (getenv("NB_DEBUG")) fprintf(stderr, "nodebuilder: GL renderer %s (%s)\n", glGetString(GL_RENDERER), glGetString(GL_VERSION));
  glGetProgramiv(program, GL_LINK_STATUS, &ok);
  if (!ok) return false;
  u_viewport = glGetUniformLocation(program, "u_viewport");
  u_atlas = glGetUniformLocation(program, "u_atlas");
  u_image = glGetUniformLocation(program, "u_image");
  u_color_atlas = glGetUniformLocation(program, "u_color_atlas");
  u_clip = glGetUniformLocation(program, "u_clip");
  u_clip_radius = glGetUniformLocation(program, "u_clip_radius");
  u_fb_height = glGetUniformLocation(program, "u_fb_height");

  glGenBuffers(1, &vbo);
  glGenTextures(1, &atlas_tex);
  glBindTexture(GL_TEXTURE_2D, atlas_tex);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  // Color glyphs are resampled to their final size when rasterised, so NEAREST would do; LINEAR
  // keeps them smooth if a quad ever lands between pixels.
  glGenTextures(1, &color_atlas_tex);
  glBindTexture(GL_TEXTURE_2D, color_atlas_tex);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  return true;
}

static float *alloc_vertex(void) {
  if (vert_count + 1 > vert_cap) {
    vert_cap = vert_cap ? vert_cap * 2 : 4096;
    verts = realloc(verts, vert_cap * VERTEX_FLOATS * sizeof(float));
  }
  return verts + vert_count++ * VERTEX_FLOATS;
}

// ---- gradients ------------------------------------------------------------------
// A GRADIENT op fills the next drawing op: each of its triangles is cut at the stop lines,
// so between two cuts the color is affine in position and per-vertex colors are exact. The
// shape keeps its own vertices otherwise (rounded-rect SDF, borders, AA coverage).

#define MAX_STOPS 32
static struct {
  bool active;
  float x0, y0, dx, dy;           // line start and direction / length^2 (t = dot(p - p0, d))
  int n;
  float offset[MAX_STOPS];
  float color[MAX_STOPS][4];      // premultiplied
} grad;
static float tri[3][VERTEX_FLOATS];
static int tri_n;

static float grad_t(const float *v) { return (v[0] - grad.x0) * grad.dx + (v[1] - grad.y0) * grad.dy; }

// Color of band `b` (0 = before the first stop, n = after the last) at t, premultiplied.
static void band_color(int b, float t, float *out) {
  int lo = b - 1 < 0 ? 0 : b - 1, hi = b < grad.n ? b : grad.n - 1;
  float span = grad.offset[hi] - grad.offset[lo];
  float k = span > 0 ? (t - grad.offset[lo]) / span : 0;
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  for (int c = 0; c < 4; c++) out[c] = grad.color[lo][c] + (grad.color[hi][c] - grad.color[lo][c]) * k;
}

// Emits vertex `v` colored by band `b`: gradient (straight, the shader premultiplies) times its own color.
static void emit_band_vertex(const float *v, int b) {
  float pm[4];
  band_color(b, grad_t(v), pm);
  float *p = alloc_vertex();
  memcpy(p, v, VERTEX_FLOATS * sizeof(float));
  float a = pm[3];
  for (int c = 0; c < 3; c++) p[6 + c] = (a > 0 ? pm[c] / a : 0) * v[6 + c];
  p[9] = a * v[9];
}

// Clips `poly` (n vertices) to t >= lo (sign 1) or t <= hi (sign -1); returns the new count.
static int clip_poly(float (*in)[VERTEX_FLOATS], int n, float (*out)[VERTEX_FLOATS], float edge, float sign) {
  int m = 0;
  for (int i = 0; i < n; i++) {
    const float *a = in[i], *b = in[(i + 1) % n];
    float da = (grad_t(a) - edge) * sign, db = (grad_t(b) - edge) * sign;
    if (da >= 0) memcpy(out[m++], a, sizeof in[0]);
    if ((da >= 0) != (db >= 0)) {
      float k = da / (da - db);
      for (int f = 0; f < VERTEX_FLOATS; f++) out[m][f] = a[f] + (b[f] - a[f]) * k;
      m++;
    }
  }
  return m;
}

static void emit_gradient_triangle(void) {
  float t[3] = {grad_t(tri[0]), grad_t(tri[1]), grad_t(tri[2])};
  float tmin = fminf(t[0], fminf(t[1], t[2])), tmax = fmaxf(t[0], fmaxf(t[1], t[2]));
  for (int b = 0; b <= grad.n; b++) {
    float lo = b == 0 ? -INFINITY : grad.offset[b - 1], hi = b == grad.n ? INFINITY : grad.offset[b];
    if (tmin >= lo && tmax <= hi) {  // the whole triangle is in this band
      for (int i = 0; i < 3; i++) emit_band_vertex(tri[i], b);
      return;
    }
    if (hi <= lo || tmax <= lo || tmin >= hi) continue;
    float a[5][VERTEX_FLOATS], c[5][VERTEX_FLOATS];
    memcpy(a, tri, sizeof tri);
    int n = 3;
    if (b > 0) n = clip_poly(a, n, c, lo, 1), memcpy(a, c, sizeof a);
    if (b < grad.n) n = clip_poly(a, n, c, hi, -1), memcpy(a, c, sizeof a);
    for (int i = 1; i + 1 < n; i++) {
      emit_band_vertex(a[0], b);
      emit_band_vertex(a[i], b);
      emit_band_vertex(a[i + 1], b);
    }
  }
}

// Reads a GRADIENT op (`a` after the opcode); returns the floats it used, or 0 if truncated.
static size_t read_gradient(const float *a, size_t left, float scale) {
  if (left < 5) return 0;
  size_t n = (size_t)a[4];
  if (left < 5 + n * 5) return 0;
  float x0 = a[0] * scale, y0 = a[1] * scale, dx = a[2] * scale - x0, dy = a[3] * scale - y0;
  float len2 = dx * dx + dy * dy;
  grad.x0 = x0;
  grad.y0 = y0;
  grad.dx = len2 > 0 ? dx / len2 : 0;
  grad.dy = len2 > 0 ? dy / len2 : 0;
  grad.n = n > MAX_STOPS ? MAX_STOPS : (int)n;
  for (int k = 0; k < grad.n; k++) {
    const float *s = a + 5 + k * 5;
    grad.offset[k] = k > 0 && s[0] < grad.offset[k - 1] ? grad.offset[k - 1] : s[0];
    grad.color[k][0] = s[1] * s[4];
    grad.color[k][1] = s[2] * s[4];
    grad.color[k][2] = s[3] * s[4];
    grad.color[k][3] = s[4];
  }
  grad.active = grad.n > 0;
  tri_n = 0;
  return 5 + n * 5;
}

static void push_vertex(float x, float y, float lx, float ly, float hw, float hh, const float *color,
                        const float *bcolor, float radius, float extra, float mode, float u, float v) {
  float *p = grad.active ? tri[tri_n] : alloc_vertex();
  p[0] = x; p[1] = y; p[2] = lx; p[3] = ly; p[4] = hw; p[5] = hh;
  p[6] = color[0]; p[7] = color[1]; p[8] = color[2]; p[9] = color[3];
  p[10] = bcolor[0]; p[11] = bcolor[1]; p[12] = bcolor[2]; p[13] = bcolor[3];
  p[14] = radius; p[15] = extra; p[16] = mode; p[17] = u; p[18] = v;
  if (grad.active && ++tri_n == 3) {
    tri_n = 0;
    emit_gradient_triangle();
  }
}

// Quad covering [x0,x1]x[y0,y1]; local coords are relative to (cx,cy).
static void push_quad(float x0, float y0, float x1, float y1, float cx, float cy, float hw, float hh,
                      const float *color, const float *bcolor, float radius, float extra, float mode,
                      float u0, float v0, float u1, float v1) {
#define V(X, Y, U, VV) push_vertex(X, Y, X - cx, Y - cy, hw, hh, color, bcolor, radius, extra, mode, U, VV)
  V(x0, y0, u0, v0); V(x1, y0, u1, v0); V(x1, y1, u1, v1);
  V(x0, y0, u0, v0); V(x1, y1, u1, v1); V(x0, y1, u0, v1);
#undef V
}

// Glyphs are rasterised while the batch is built, so upload right before drawing.
static void upload_atlas(void) {
  int size;
  bool dirty;
  const uint8_t *pixels = nb_text_atlas(&size, &dirty);
  if (!dirty) return;
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_ALPHA, size, size, 0, GL_ALPHA, GL_UNSIGNED_BYTE, pixels);
  nb_text_atlas_uploaded();
}

static void upload_color_atlas(void) {
  int size;
  bool dirty;
  const uint8_t *pixels = nb_text_color_atlas(&size, &dirty);
  if (!dirty) return;
  glActiveTexture(GL_TEXTURE2);
  glBindTexture(GL_TEXTURE_2D, color_atlas_tex);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, size, size, 0, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
  glActiveTexture(GL_TEXTURE0);
  nb_text_color_atlas_uploaded();
}

static void flush(void) {
  if (!vert_count) return;
  upload_atlas();
  upload_color_atlas();
  glBindBuffer(GL_ARRAY_BUFFER, vbo);
  glBufferData(GL_ARRAY_BUFFER, vert_count * VERTEX_FLOATS * sizeof(float), verts, GL_STREAM_DRAW);
  size_t offset = 0;
  for (int i = 0; i < 7; i++) {
    glEnableVertexAttribArray(i);
    glVertexAttribPointer(i, attr_sizes[i], GL_FLOAT, GL_FALSE, VERTEX_FLOATS * sizeof(float),
                          (void *)(offset * sizeof(float)));
    offset += attr_sizes[i];
  }
  glDrawArrays(GL_TRIANGLES, 0, vert_count);
  vert_count = 0;
}

typedef struct { int x0, y0, x1, y1; } irect;
typedef struct {
  irect scissor;               // intersection of every clip on the stack
  float mask[4], mask_radius;  // innermost rounded clip (radius 0 = none)
} clip_state;
static clip_state clips[MAX_CLIP_DEPTH];
static int clip_depth;

static void apply_clip(void) {
  if (clip_depth == 0) {
    glDisable(GL_SCISSOR_TEST);
    glUniform1f(u_clip_radius, 0);
    return;
  }
  const clip_state *c = &clips[clip_depth - 1];
  irect r = c->scissor;
  glEnable(GL_SCISSOR_TEST);
  glScissor(r.x0, fb_h - r.y1, r.x1 - r.x0 > 0 ? r.x1 - r.x0 : 0, r.y1 - r.y0 > 0 ? r.y1 - r.y0 : 0);
  glUniform4f(u_clip, c->mask[0], c->mask[1], c->mask[2], c->mask[3]);
  glUniform1f(u_clip_radius, c->mask_radius);
}

// ---- images ------------------------------------------------------------------

typedef struct {
  int w, h;
  uint8_t *pixels;  // premultiplied RGBA until uploaded, then freed
  GLuint tex;
  bool live, dead;  // dead: destroyed, texture still to be deleted (needs the context)
} image;
static image *images;
static int image_count;
static GLuint bound_image;  // texture on unit 1 for the current batch

int nb_image_create(int w, int h, const uint8_t *rgba) {
  if (w <= 0 || h <= 0) return 0;
  int slot = 0;
  while (slot < image_count && (images[slot].live || images[slot].dead)) slot++;
  if (slot == image_count) {
    image *grown = realloc(images, (image_count + 1) * sizeof *images);
    if (!grown) return 0;
    images = grown;
    image_count++;
  }
  size_t n = (size_t)w * h;
  uint8_t *px = malloc(n * 4);
  if (!px) return 0;
  // Premultiply now so linear filtering doesn't bleed the color of transparent texels.
  for (size_t i = 0; i < n; i++) {
    unsigned a = rgba[i * 4 + 3];
    px[i * 4 + 0] = (uint8_t)((rgba[i * 4 + 0] * a + 127) / 255);
    px[i * 4 + 1] = (uint8_t)((rgba[i * 4 + 1] * a + 127) / 255);
    px[i * 4 + 2] = (uint8_t)((rgba[i * 4 + 2] * a + 127) / 255);
    px[i * 4 + 3] = (uint8_t)a;
  }
  images[slot] = (image){.w = w, .h = h, .pixels = px, .live = true};
  return slot + 1;
}

void nb_image_destroy(int id) {
  if (id <= 0 || id > image_count || !images[id - 1].live) return;
  image *im = &images[id - 1];
  free(im->pixels);
  im->pixels = NULL;
  im->live = false;
  im->dead = im->tex != 0;
}

static void collect_images(void) {
  for (int i = 0; i < image_count; i++) {
    if (!images[i].dead) continue;
    if (images[i].tex == bound_image) bound_image = 0;
    glDeleteTextures(1, &images[i].tex);
    images[i] = (image){0};
  }
}

// Binds the image for the following quads; false if it can't be drawn.
static bool use_image(int id) {
  if (id <= 0 || id > image_count || !images[id - 1].live) return false;
  image *im = &images[id - 1];
  if (!im->tex) {
    GLint max = 0;
    glGetIntegerv(GL_MAX_TEXTURE_SIZE, &max);
    if (im->w > max || im->h > max) {
      fprintf(stderr, "nodebuilder: image %dx%d is larger than the GPU limit (%d)\n", im->w, im->h, max);
      nb_image_destroy(id);
      return false;
    }
    glGenTextures(1, &im->tex);
  }
  if (im->tex != bound_image) flush();  // the pending quads use the previous image
  glActiveTexture(GL_TEXTURE1);
  glBindTexture(GL_TEXTURE_2D, im->tex);
  if (im->pixels) {
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, im->w, im->h, 0, GL_RGBA, GL_UNSIGNED_BYTE, im->pixels);
    free(im->pixels);
    im->pixels = NULL;
  }
  glActiveTexture(GL_TEXTURE0);
  bound_image = im->tex;
  return true;
}

// Quad whose corners are given in a local frame (origin o, axes ux/uy, in pixels): the
// shader receives the local coordinates, so lines and arcs are evaluated along their axis.
static void push_local_quad(float ox, float oy, float uxx, float uxy, float uyx, float uyy, float u0, float v0,
                            float u1, float v1, float hx, float hy, const float *color, float p0, float p1,
                            float mode) {
  static const float none[4] = {0, 0, 0, 0};
#define LV(U, V) push_vertex(ox + uxx * (U) + uyx * (V), oy + uxy * (U) + uyy * (V), U, V, hx, hy, color, none, p0, p1, mode, 0, 0)
  LV(u0, v0); LV(u1, v0); LV(u1, v1);
  LV(u0, v0); LV(u1, v1); LV(u0, v1);
#undef LV
}

typedef struct { const float *color; } glyph_ctx;

static void emit_glyph(void *ud, float x0, float y0, float x1, float y1, float u0, float v0, float u1, float v1,
                       bool color) {
  static const float none[4] = {0, 0, 0, 0};
  glyph_ctx *ctx = ud;
  push_quad(x0, y0, x1, y1, 0, 0, 0, 0, ctx->color, none, 0, 0, color ? MODE_COLOR_GLYPH : MODE_GLYPH, u0, v0, u1, v1);
}

void nb_render_frame(int bw, int bh, float scale, const float *cmd, size_t count, const char **texts,
                     size_t text_count) {
  static const float none[4] = {0, 0, 0, 0};
  fb_w = bw;
  fb_h = bh;
  clip_depth = 0;
  bound_image = 0;
  collect_images();

  glViewport(0, 0, bw, bh);
  glDisable(GL_SCISSOR_TEST);
  glClearColor(0, 0, 0, 0);
  glClear(GL_COLOR_BUFFER_BIT);
  glEnable(GL_BLEND);
  glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);  // premultiplied alpha
  glUseProgram(program);
  glUniform2f(u_viewport, (float)bw, (float)bh);
  glUniform1i(u_atlas, 0);
  glUniform1i(u_image, 1);
  glUniform1i(u_color_atlas, 2);
  glUniform1f(u_fb_height, (float)bh);
  glUniform1f(u_clip_radius, 0);
  glActiveTexture(GL_TEXTURE2);
  glBindTexture(GL_TEXTURE_2D, color_atlas_tex);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, atlas_tex);

  size_t i = 0;
  grad.active = false;
  while (i < count) {
    int op = (int)cmd[i++];
    switch (op) {
      case NB_OP_GRADIENT: {  // x0 y0 x1 y1  n  then n x (offset r g b a)
        size_t used = read_gradient(cmd + i, count - i, scale);
        if (!used) {  // truncated buffer: stop drawing
          i = count;
          break;
        }
        i += used;
        continue;
      }
      case NB_OP_RECT: {  // x y w h  r g b a  radius border  br bg bb ba
        const float *a = cmd + i;
        i += 14;
        float x = a[0] * scale, y = a[1] * scale, w = a[2] * scale, h = a[3] * scale;
        float hw = w / 2, hh = h / 2, r = fminf(a[8] * scale, fminf(hw, hh));
        push_quad(x - 1, y - 1, x + w + 1, y + h + 1, x + hw, y + hh, hw, hh, a + 4, a + 10, r, a[9] * scale,
                  MODE_RECT, 0, 0, 0, 0);
        break;
      }
      case NB_OP_SHADOW: {  // x y w h  r g b a  radius blur
        const float *a = cmd + i;
        i += 10;
        float x = a[0] * scale, y = a[1] * scale, w = a[2] * scale, h = a[3] * scale;
        float hw = w / 2, hh = h / 2, r = fminf(a[8] * scale, fminf(hw, hh)), blur = fmaxf(a[9] * scale, 0.5f);
        push_quad(x - blur, y - blur, x + w + blur, y + h + blur, x + hw, y + hh, hw, hh, a + 4, none, r, blur,
                  MODE_SHADOW, 0, 0, 0, 0);
        break;
      }
      case NB_OP_TEXT: {  // x y size font  r g b a  text_index
        const float *a = cmd + i;
        i += 9;
        size_t idx = (size_t)a[8];
        if (idx >= text_count || !texts[idx]) break;
        glyph_ctx ctx = {.color = a + 4};
        nb_text_draw((int)a[3], texts[idx], (int)lroundf(a[2] * scale), roundf(a[0] * scale),
                     roundf(a[1] * scale), emit_glyph, &ctx);
        break;
      }
      case NB_OP_IMAGE: {  // x y w h  u0 v0 u1 v1  r g b a  radius id
        // The tint multiplies the texels: white for pictures, the color for white icon masks.
        const float *a = cmd + i;
        i += 14;
        if (!use_image((int)a[13])) break;
        float x = a[0] * scale, y = a[1] * scale, w = a[2] * scale, h = a[3] * scale;
        float hw = w / 2, hh = h / 2, r = fminf(a[12] * scale, fminf(hw, hh));
        push_quad(x, y, x + w, y + h, x + hw, y + hh, hw, hh, a + 8, none, r, 0, MODE_IMAGE, a[4], a[5], a[6],
                  a[7]);
        break;
      }
      case NB_OP_LINE: {  // x0 y0 x1 y1  width  r g b a  capStart capEnd
        const float *a = cmd + i;
        i += 11;
        float x0 = a[0] * scale, y0 = a[1] * scale, x1 = a[2] * scale, y1 = a[3] * scale;
        // sqrtf, not hypotf: glibc's current hypotf is 2.35 and the portable addon targets 2.34.
        float hw = a[4] * scale / 2, len = sqrtf((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
        float dx = len > 0 ? (x1 - x0) / len : 1, dy = len > 0 ? (y1 - y0) / len : 0;
        float pad = hw + 1;  // room for the antialiased edge
        push_local_quad(x0, y0, dx, dy, -dy, dx, -pad, -pad, len + pad, pad, a[9], a[10], a + 5, hw, len, MODE_LINE);
        break;
      }
      case NB_OP_TRIANGLES: {  // count  r g b a  then count x (x y coverage)
        size_t n = (size_t)cmd[i];
        const float *rgba = cmd + i + 1;
        const float *v = cmd + i + 5;
        if (i + 5 + n * 3 > count) {  // truncated buffer: stop drawing
          i = count;
          break;
        }
        i += 5 + n * 3;
        for (size_t k = 0; k < n; k++) {
          const float color[4] = {rgba[0], rgba[1], rgba[2], rgba[3] * v[k * 3 + 2]};
          push_vertex(v[k * 3] * scale, v[k * 3 + 1] * scale, 0, 0, 0, 0, color, none, 0, 0, MODE_SOLID, 0, 0);
        }
        break;
      }
      case NB_OP_ARC: {  // cx cy  outer inner  start sweep  r g b a
        const float *a = cmd + i;
        i += 10;
        float cx = a[0] * scale, cy = a[1] * scale, outer = a[2] * scale, inner = a[3] * scale;
        float h = fminf(fabsf(a[5]) / 2, (float)M_PI), mid = a[4] + a[5] / 2;
        // Local +y points at the middle of the sector (0 = up, clockwise on screen).
        float yx = sinf(mid), yy = -cosf(mid), xx = -yy, xy = yx;
        float r = outer + 1;
        push_local_quad(cx, cy, xx, xy, yx, yy, -r, -r, r, r, sinf(h), h >= (float)M_PI - 1e-4f ? -1.0f : cosf(h), a + 6,
                        outer, inner, MODE_ARC);
        break;
      }
      case NB_OP_CLIP: {  // x y w h radius
        const float *a = cmd + i;
        i += 5;
        float x0 = a[0] * scale, y0 = a[1] * scale, x1 = (a[0] + a[2]) * scale, y1 = (a[1] + a[3]) * scale;
        clip_state c = {.scissor = {(int)floorf(x0), (int)floorf(y0), (int)ceilf(x1), (int)ceilf(y1)}};
        if (clip_depth > 0) {
          const clip_state *p = &clips[clip_depth - 1];
          if (c.scissor.x0 < p->scissor.x0) c.scissor.x0 = p->scissor.x0;
          if (c.scissor.y0 < p->scissor.y0) c.scissor.y0 = p->scissor.y0;
          if (c.scissor.x1 > p->scissor.x1) c.scissor.x1 = p->scissor.x1;
          if (c.scissor.y1 > p->scissor.y1) c.scissor.y1 = p->scissor.y1;
          memcpy(c.mask, p->mask, sizeof c.mask);
          c.mask_radius = p->mask_radius;
        }
        if (a[4] > 0) {
          c.mask[0] = x0; c.mask[1] = y0; c.mask[2] = x1; c.mask[3] = y1;
          c.mask_radius = fminf(a[4] * scale, fminf(x1 - x0, y1 - y0) / 2);
        }
        flush();
        if (clip_depth < MAX_CLIP_DEPTH) clips[clip_depth++] = c;
        apply_clip();
        break;
      }
      case NB_OP_UNCLIP:
        flush();
        if (clip_depth > 0) clip_depth--;
        apply_clip();
        break;
      default:
        fprintf(stderr, "nodebuilder: unknown draw op %d\n", op);
        i = count;
    }
    grad.active = false;  // a gradient fills only the op right after it
  }
  flush();
}

void nb_render_read_pixels(int w, int h, uint8_t *out) {
  glPixelStorei(GL_PACK_ALIGNMENT, 4);
  glReadPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, out);
  // GL rows go bottom to top: flip, and un-premultiply (PNG and decodeImage use straight alpha).
  size_t stride = (size_t)w * 4;
  uint8_t *row = malloc(stride);
  for (int y = 0; row && y < h / 2; y++) {
    uint8_t *a = out + y * stride, *b = out + (size_t)(h - 1 - y) * stride;
    memcpy(row, a, stride);
    memcpy(a, b, stride);
    memcpy(b, row, stride);
  }
  free(row);
  for (size_t i = 0, n = (size_t)w * h * 4; i < n; i += 4) {
    unsigned a = out[i + 3];
    if (a == 0 || a == 255) continue;
    for (int c = 0; c < 3; c++) {
      unsigned v = (out[i + c] * 255 + a / 2) / a;
      out[i + c] = (uint8_t)(v > 255 ? 255 : v);
    }
  }
}
