// GLES2 renderer: executes the command buffer produced by src/render/paint.ts.
// Everything (rounded rects, borders, shadows, glyphs) goes through one shader
// and one vertex format, so draw order is preserved with a single batch that is
// only flushed when the clip changes. Clips are a scissor rectangle plus an
// optional rounded mask (the innermost rounded clip) evaluated per fragment.
#include "nb.h"

#include <GLES2/gl2.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { MODE_RECT = 0, MODE_GLYPH = 1, MODE_SHADOW = 2, MODE_IMAGE = 3 };

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
    "  v_local = a_local; v_half = a_half; v_color = a_color; v_bcolor = a_bcolor;\n"
    "  v_params = a_params; v_uv = a_uv;\n"
    "}\n";

static const char *fragment_src =
    "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n"
    "varying vec2 v_local; varying vec2 v_half; varying vec4 v_color; varying vec4 v_bcolor;\n"
    "varying vec3 v_params; varying vec2 v_uv;\n"
    "uniform sampler2D u_atlas; uniform sampler2D u_image;\n"
    "uniform vec4 u_clip; uniform float u_clip_radius; uniform float u_fb_height;\n"
    "float sd_round_box(vec2 p, vec2 b, float r) {\n"
    "  vec2 q = abs(p) - b + vec2(r);\n"
    "  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;\n"
    "}\n"
    "void main() {\n"
    "  vec4 c;\n"
    "  if (v_params.z > 2.5) {\n"  // image (premultiplied texels), rounded like a rect
    "    float d = sd_round_box(v_local, v_half, v_params.x);\n"
    "    c = texture2D(u_image, v_uv) * vec4(v_color.rgb, 1.0) * v_color.a * clamp(0.5 - d, 0.0, 1.0);\n"
    "  } else if (v_params.z > 1.5) {\n"  // shadow
    "    float d = sd_round_box(v_local, v_half, v_params.x);\n"
    "    c = vec4(v_color.rgb, 1.0) * v_color.a * (1.0 - smoothstep(-v_params.y, v_params.y, d));\n"
    "  } else if (v_params.z > 0.5) {\n"  // glyph
    "    c = vec4(v_color.rgb, 1.0) * v_color.a * texture2D(u_atlas, v_uv).a;\n"
    "  } else {\n"  // rounded rect; the border is composited over the fill (premultiplied)
    "    float d = sd_round_box(v_local, v_half, v_params.x);\n"
    "    c = vec4(v_color.rgb * v_color.a, v_color.a);\n"
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

static GLuint program, vbo, atlas_tex;
static GLint u_viewport, u_atlas, u_image, u_clip, u_clip_radius, u_fb_height;
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
  return true;
}

static void push_vertex(float x, float y, float lx, float ly, float hw, float hh, const float *color,
                        const float *bcolor, float radius, float extra, float mode, float u, float v) {
  if (vert_count + 1 > vert_cap) {
    vert_cap = vert_cap ? vert_cap * 2 : 4096;
    verts = realloc(verts, vert_cap * VERTEX_FLOATS * sizeof(float));
  }
  float *p = verts + vert_count++ * VERTEX_FLOATS;
  p[0] = x; p[1] = y; p[2] = lx; p[3] = ly; p[4] = hw; p[5] = hh;
  p[6] = color[0]; p[7] = color[1]; p[8] = color[2]; p[9] = color[3];
  p[10] = bcolor[0]; p[11] = bcolor[1]; p[12] = bcolor[2]; p[13] = bcolor[3];
  p[14] = radius; p[15] = extra; p[16] = mode; p[17] = u; p[18] = v;
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

static void flush(void) {
  if (!vert_count) return;
  upload_atlas();
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

typedef struct { const float *color; } glyph_ctx;

static void emit_glyph(void *ud, float x0, float y0, float x1, float y1, float u0, float v0, float u1, float v1) {
  static const float none[4] = {0, 0, 0, 0};
  glyph_ctx *ctx = ud;
  push_quad(x0, y0, x1, y1, 0, 0, 0, 0, ctx->color, none, 0, 0, MODE_GLYPH, u0, v0, u1, v1);
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
  glUniform1f(u_fb_height, (float)bh);
  glUniform1f(u_clip_radius, 0);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, atlas_tex);

  size_t i = 0;
  while (i < count) {
    int op = (int)cmd[i++];
    switch (op) {
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
  }
  flush();
}
