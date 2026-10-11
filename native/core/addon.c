// N-API surface of the native core. Portable: everything OS-specific goes
// through nb_platform.h. The platform's event pump wakes us (from any thread)
// via a threadsafe function; events are then processed and delivered to JS on
// the JS thread. No libuv, so the addon loads in Bun and Node alike.
#define NAPI_VERSION 8
#include <node_api.h>
#include <stdlib.h>
#include <string.h>

#include "nb.h"

#define CHECK(call)                                    \
  do {                                                 \
    if ((call) != napi_ok) {                           \
      napi_throw_error(env, NULL, "N-API call failed: " #call); \
      return NULL;                                     \
    }                                                  \
  } while (0)

static napi_threadsafe_function g_tsfn;
static bool g_open;

// Payloads for the threadsafe function: a pump wake-up, or a plain "deliver
// queued events" request made from the JS thread itself.
#define CALL_PUMP ((void *)1)
#define CALL_DELIVER ((void *)2)

static nb_event *queue;
static size_t queue_len, queue_cap;

void nb_push_event(const nb_event *e) {
  if (queue_len == queue_cap) {
    queue_cap = queue_cap ? queue_cap * 2 : 64;
    queue = realloc(queue, queue_cap * sizeof *queue);
  }
  queue[queue_len++] = *e;
}

static void clear_queue(void) {
  for (size_t i = 0; i < queue_len; i++) free(queue[i].data);
  queue_len = 0;
}

static const char *type_name(int t) {
  switch (t) {
    case NB_EV_CONFIGURE: return "configure";
    case NB_EV_CLOSE: return "close";
    case NB_EV_FRAME: return "frame";
    case NB_EV_POINTER_MOVE: return "pointermove";
    case NB_EV_POINTER_DOWN: return "pointerdown";
    case NB_EV_POINTER_UP: return "pointerup";
    case NB_EV_POINTER_LEAVE: return "pointerleave";
    case NB_EV_SCROLL: return "scroll";
    case NB_EV_KEY_DOWN: return "keydown";
    case NB_EV_KEY_UP: return "keyup";
    case NB_EV_FOCUS: return "focus";
    case NB_EV_CLIPBOARD: return "clipboard";
  }
  return "unknown";
}

static void set_num(napi_env env, napi_value obj, const char *k, double v) {
  napi_value n;
  napi_create_double(env, v, &n);
  napi_set_named_property(env, obj, k, n);
}

static void set_bool(napi_env env, napi_value obj, const char *k, bool v) {
  napi_value b;
  napi_get_boolean(env, v, &b);
  napi_set_named_property(env, obj, k, b);
}

static void set_str(napi_env env, napi_value obj, const char *k, const char *v) {
  napi_value s;
  napi_create_string_utf8(env, v, NAPI_AUTO_LENGTH, &s);
  napi_set_named_property(env, obj, k, s);
}

static napi_value event_to_js(napi_env env, const nb_event *e) {
  napi_value o;
  napi_create_object(env, &o);
  set_str(env, o, "type", type_name(e->type));
  switch (e->type) {
    case NB_EV_CONFIGURE:
      set_num(env, o, "width", e->width);
      set_num(env, o, "height", e->height);
      set_num(env, o, "scale", e->scale);
      set_bool(env, o, "maximized", e->maximized);
      set_bool(env, o, "activated", e->activated);
      set_bool(env, o, "transparent", e->transparent);
      break;
    case NB_EV_POINTER_MOVE:
    case NB_EV_POINTER_DOWN:
    case NB_EV_POINTER_UP:
      set_num(env, o, "x", e->x);
      set_num(env, o, "y", e->y);
      set_num(env, o, "button", e->button);
      break;
    case NB_EV_SCROLL:
      set_num(env, o, "x", e->x);
      set_num(env, o, "y", e->y);
      set_num(env, o, "dx", e->dx);
      set_num(env, o, "dy", e->dy);
      break;
    case NB_EV_KEY_DOWN:
    case NB_EV_KEY_UP:
      set_str(env, o, "key", e->key);
      set_str(env, o, "text", e->text);
      set_bool(env, o, "repeat", e->repeat);
      set_bool(env, o, "ctrl", e->mods & NB_MOD_CTRL);
      set_bool(env, o, "shift", e->mods & NB_MOD_SHIFT);
      set_bool(env, o, "alt", e->mods & NB_MOD_ALT);
      set_bool(env, o, "super", e->mods & NB_MOD_SUPER);
      break;
    case NB_EV_FOCUS:
      set_bool(env, o, "focused", e->focused);
      break;
    case NB_EV_CLIPBOARD:
      set_str(env, o, "text", e->data ? e->data : "");
      break;
  }
  return o;
}

static void deliver(napi_env env, napi_value callback) {
  if (!queue_len) return;
  napi_value arr, global, result;
  napi_create_array_with_length(env, queue_len, &arr);
  for (size_t i = 0; i < queue_len; i++) napi_set_element(env, arr, i, event_to_js(env, &queue[i]));
  clear_queue();
  napi_get_global(env, &global);
  napi_call_function(env, global, callback, 1, &arr, &result);
}

// Runs on the JS thread.
static void call_js(napi_env env, napi_value callback, void *ctx, void *data) {
  if (!env || !g_open) return;
  if (data == CALL_PUMP) nb_platform_pump_process();
  else nb_platform_flush();
  deliver(env, callback);
}

// Called by the platform pump, possibly from another thread.
static void wake_js(void) { napi_call_threadsafe_function(g_tsfn, CALL_PUMP, napi_tsfn_nonblocking); }

/** Asks the JS thread to deliver events queued outside a pump wake-up. */
static void request_delivery(void) {
  if (queue_len && g_open) napi_call_threadsafe_function(g_tsfn, CALL_DELIVER, napi_tsfn_nonblocking);
}

static char *get_string(napi_env env, napi_value v) {
  size_t len;
  if (napi_get_value_string_utf8(env, v, NULL, 0, &len) != napi_ok) return NULL;
  char *s = malloc(len + 1);
  napi_get_value_string_utf8(env, v, s, len + 1, &len);
  return s;
}

// open({ title, appId, width, height }, onEvents)
static napi_value js_open(napi_env env, napi_callback_info info) {
  if (g_open) {
    napi_throw_error(env, NULL, "window already open");
    return NULL;
  }
  size_t argc = 2;
  napi_value argv[2];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));

  napi_value v;
  CHECK(napi_get_named_property(env, argv[0], "title", &v));
  char *title = get_string(env, v);
  CHECK(napi_get_named_property(env, argv[0], "appId", &v));
  char *app_id = get_string(env, v);
  int32_t w, h;
  CHECK(napi_get_named_property(env, argv[0], "width", &v));
  CHECK(napi_get_value_int32(env, v, &w));
  CHECK(napi_get_named_property(env, argv[0], "height", &v));
  CHECK(napi_get_value_int32(env, v, &h));

  if (!nb_text_init()) {
    napi_throw_error(env, NULL, "text engine initialisation failed");
    return NULL;
  }
  nb_window_options options = {.title = title ? title : "nodebuilder", .app_id = app_id ? app_id : "nodebuilder",
                               .width = w, .height = h};
  bool ok = nb_platform_open(&options);
  free(title);
  free(app_id);
  if (!ok || !nb_render_init()) {
    nb_platform_close();
    napi_throw_error(env, NULL, "could not open window");
    return NULL;
  }

  napi_value name;
  napi_create_string_utf8(env, "nodebuilder:wayland", NAPI_AUTO_LENGTH, &name);
  CHECK(napi_create_threadsafe_function(env, argv[1], NULL, name, 0, 1, NULL, NULL, NULL, call_js, &g_tsfn));
  g_open = true;
  if (!nb_platform_pump_start(wake_js)) {
    g_open = false;
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_abort);
    nb_platform_close();
    napi_throw_error(env, NULL, "could not start the event pump");
    return NULL;
  }
  request_delivery();  // the initial configure arrived while opening
  return NULL;
}

static napi_value js_close(napi_env env, napi_callback_info info) {
  if (!g_open) return NULL;
  g_open = false;
  nb_platform_pump_stop();
  napi_release_threadsafe_function(g_tsfn, napi_tsfn_abort);
  nb_platform_close();
  clear_queue();
  return NULL;
}

// render(commands: Float32Array, texts: string[])
static napi_value js_render(napi_env env, napi_callback_info info) {
  if (!g_open) return NULL;
  size_t argc = 2;
  napi_value argv[2];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));

  napi_typedarray_type type;
  size_t length;
  void *data;
  CHECK(napi_get_typedarray_info(env, argv[0], &type, &length, &data, NULL, NULL));
  if (type != napi_float32_array) {
    napi_throw_type_error(env, NULL, "commands must be a Float32Array");
    return NULL;
  }

  uint32_t text_count;
  CHECK(napi_get_array_length(env, argv[1], &text_count));
  char **texts = calloc(text_count ? text_count : 1, sizeof(char *));
  for (uint32_t i = 0; i < text_count; i++) {
    napi_value s;
    napi_get_element(env, argv[1], i, &s);
    texts[i] = get_string(env, s);
  }

  int bw, bh, scale;
  nb_platform_begin_frame(&bw, &bh, &scale);
  nb_render_frame(bw, bh, (float)scale, data, length, (const char **)texts, text_count);
  nb_platform_end_frame();
  nb_platform_flush();  // presenting may have received events (e.g. EGL reading the socket)
  request_delivery();

  for (uint32_t i = 0; i < text_count; i++) free(texts[i]);
  free(texts);
  return NULL;
}

// measureText(text, size, font) -> [width, ascent, descent] in logical px
static napi_value js_measure_text(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (!nb_text_init()) {
    napi_throw_error(env, NULL, "text engine initialisation failed");
    return NULL;
  }
  char *text = get_string(env, argv[0]);
  double size;
  int32_t font;
  CHECK(napi_get_value_double(env, argv[1], &size));
  CHECK(napi_get_value_int32(env, argv[2], &font));

  float scale = (float)nb_platform_scale(), ascent, descent;
  int px = (int)(size * scale + 0.5);
  float w = nb_text_measure(font, text ? text : "", px, &ascent, &descent);
  free(text);

  napi_value out, n;
  napi_create_array_with_length(env, 3, &out);
  napi_create_double(env, w / scale, &n);
  napi_set_element(env, out, 0, n);
  napi_create_double(env, ascent / scale, &n);
  napi_set_element(env, out, 1, n);
  napi_create_double(env, descent / scale, &n);
  napi_set_element(env, out, 2, n);
  return out;
}

// createImage(width, height, rgba: Uint8Array) -> id (> 0). Works before the window opens.
static napi_value js_create_image(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  int32_t w, h;
  CHECK(napi_get_value_int32(env, argv[0], &w));
  CHECK(napi_get_value_int32(env, argv[1], &h));
  napi_typedarray_type type;
  size_t length;
  void *data;
  CHECK(napi_get_typedarray_info(env, argv[2], &type, &length, &data, NULL, NULL));
  if (type != napi_uint8_array || w <= 0 || h <= 0 || length < (size_t)w * h * 4) {
    napi_throw_type_error(env, NULL, "createImage expects width, height and a Uint8Array of width*height*4 bytes");
    return NULL;
  }
  napi_value out;
  napi_create_int32(env, nb_image_create(w, h, data), &out);
  return out;
}

// decodeImage(bytes: Uint8Array) -> { width, height, data: Uint8Array (RGBA) }, for the
// formats only the OS can decode (AVIF, HEIC). Throws with the platform's message.
static napi_value js_decode_image(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  napi_typedarray_type type;
  size_t length;
  void *data;
  CHECK(napi_get_typedarray_info(env, argv[0], &type, &length, &data, NULL, NULL));
  if (type != napi_uint8_array) {
    napi_throw_type_error(env, NULL, "decodeImage expects a Uint8Array");
    return NULL;
  }
  int w = 0, h = 0;
  uint8_t *rgba = NULL;
  char error[256] = "";
  if (!nb_platform_decode_image(data, length, &w, &h, &rgba, error, sizeof error)) {
    napi_throw_error(env, NULL, error);
    return NULL;
  }
  size_t size = (size_t)w * h * 4;
  void *dst;
  napi_value buffer, pixels, out;
  napi_status status = napi_create_arraybuffer(env, size, &dst, &buffer);
  if (status == napi_ok) memcpy(dst, rgba, size);
  free(rgba);
  CHECK(status);
  CHECK(napi_create_typedarray(env, napi_uint8_array, size, buffer, 0, &pixels));
  CHECK(napi_create_object(env, &out));
  set_num(env, out, "width", w);
  set_num(env, out, "height", h);
  CHECK(napi_set_named_property(env, out, "data", pixels));
  return out;
}

static napi_value js_destroy_image(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  int32_t id;
  CHECK(napi_get_value_int32(env, argv[0], &id));
  nb_image_destroy(id);
  return NULL;
}

static napi_value js_set_cursor(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  char *name = get_string(env, argv[0]);
  if (g_open && name) nb_platform_set_cursor(name);
  free(name);
  return NULL;
}

static napi_value js_set_title(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  char *title = get_string(env, argv[0]);
  if (g_open && title) nb_platform_set_title(title);
  free(title);
  return NULL;
}

static napi_value js_move(napi_env env, napi_callback_info info) {
  if (g_open) nb_platform_move();
  return NULL;
}

static napi_value js_resize(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  uint32_t edges;
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_uint32(env, argv[0], &edges));
  if (g_open) nb_platform_resize(edges);
  return NULL;
}

static napi_value js_set_maximized(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  bool max;
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  CHECK(napi_get_value_bool(env, argv[0], &max));
  if (g_open) nb_platform_set_maximized(max);
  return NULL;
}

static napi_value js_request_frame(napi_env env, napi_callback_info info) {
  if (g_open) nb_platform_request_frame();
  return NULL;
}

static napi_value js_minimize(napi_env env, napi_callback_info info) {
  if (g_open) nb_platform_minimize();
  return NULL;
}

// writeClipboard(text)
static napi_value js_write_clipboard(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  char *text = get_string(env, argv[0]);
  if (g_open && text) {
    nb_platform_clipboard_write(text);
    nb_platform_flush();
  }
  free(text);
  return NULL;
}

// readClipboard(): the text arrives as a "clipboard" event.
static napi_value js_read_clipboard(napi_env env, napi_callback_info info) {
  if (!g_open) return NULL;
  nb_platform_clipboard_read();
  nb_platform_flush();
  request_delivery();  // answered right away when the clipboard is ours
  return NULL;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor props[] = {
      {"open", NULL, js_open, NULL, NULL, NULL, napi_default, NULL},
      {"close", NULL, js_close, NULL, NULL, NULL, napi_default, NULL},
      {"render", NULL, js_render, NULL, NULL, NULL, napi_default, NULL},
      {"measureText", NULL, js_measure_text, NULL, NULL, NULL, napi_default, NULL},
      {"createImage", NULL, js_create_image, NULL, NULL, NULL, napi_default, NULL},
      {"destroyImage", NULL, js_destroy_image, NULL, NULL, NULL, napi_default, NULL},
      {"decodeImage", NULL, js_decode_image, NULL, NULL, NULL, napi_default, NULL},
      {"setCursor", NULL, js_set_cursor, NULL, NULL, NULL, napi_default, NULL},
      {"setTitle", NULL, js_set_title, NULL, NULL, NULL, napi_default, NULL},
      {"move", NULL, js_move, NULL, NULL, NULL, napi_default, NULL},
      {"resize", NULL, js_resize, NULL, NULL, NULL, napi_default, NULL},
      {"setMaximized", NULL, js_set_maximized, NULL, NULL, NULL, napi_default, NULL},
      {"minimize", NULL, js_minimize, NULL, NULL, NULL, napi_default, NULL},
      {"requestFrame", NULL, js_request_frame, NULL, NULL, NULL, napi_default, NULL},
      {"writeClipboard", NULL, js_write_clipboard, NULL, NULL, NULL, napi_default, NULL},
      {"readClipboard", NULL, js_read_clipboard, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof props / sizeof props[0], props);
  return exports;
}
