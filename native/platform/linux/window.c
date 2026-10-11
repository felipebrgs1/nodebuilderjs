// Linux backend: Wayland window (xdg-shell), EGL surface and input
// (pointer + keyboard with xkb/compose). Implements the window part of nb_platform.h.
#define _GNU_SOURCE
#include "linux.h"

#include <EGL/egl.h>
#include <linux/input-event-codes.h>
#include <locale.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>
#include <poll.h>
#include <sys/timerfd.h>
#include <wayland-client.h>
#include <wayland-cursor.h>
#include <wayland-egl.h>
#include <xkbcommon/xkbcommon-compose.h>
#include <xkbcommon/xkbcommon.h>

#include "xdg-shell-client-protocol.h"

#ifndef MIN
#define MIN(a, b) ((a) < (b) ? (a) : (b))
#endif

static struct {
  struct wl_display *display;
  struct wl_registry *registry;
  struct wl_compositor *compositor;
  uint32_t compositor_version;
  struct xdg_wm_base *wm_base;
  struct wl_seat *seat;
  struct wl_shm *shm;
  struct wl_pointer *pointer;
  struct wl_keyboard *keyboard;

  struct wl_cursor_theme *cursor_theme;
  int cursor_theme_scale;
  struct wl_surface *cursor_surface;
  uint32_t pointer_serial;
  char cursor_name[64];
  double px, py;
  uint32_t last_serial;

  struct xkb_context *xkb;
  struct xkb_keymap *keymap;
  struct xkb_state *xkb_state;
  struct xkb_compose_table *compose_table;
  struct xkb_compose_state *compose;
  int32_t repeat_rate, repeat_delay;
  int repeat_fd;  // timerfd driving key repeat, polled next to the display fd
  uint32_t repeat_key;

  struct wl_surface *surface;
  struct xdg_surface *xdg_surface;
  struct xdg_toplevel *toplevel;
  struct wl_callback *frame_cb;
  struct wl_egl_window *egl_window;
  EGLDisplay egl_display;
  EGLContext egl_context;
  EGLSurface egl_surface;

  int width, height, pending_w, pending_h;
  int buffer_w, buffer_h;
  int scale;
  bool configured, maximized, activated;
} S;

static void emit_configure(void) {
  nb_event e = {.type = NB_EV_CONFIGURE,
                .width = S.width,
                .height = S.height,
                .scale = S.scale,
                .maximized = S.maximized,
                .activated = S.activated};
  nb_push_event(&e);
}

// ---- cursor -----------------------------------------------------------------

static void apply_cursor(void) {
  if (!S.pointer || !S.shm) return;
  if (!S.cursor_theme || S.cursor_theme_scale != S.scale) {
    if (S.cursor_theme) wl_cursor_theme_destroy(S.cursor_theme);
    const char *size_env = getenv("XCURSOR_SIZE");
    int size = size_env ? atoi(size_env) : 24;
    if (size <= 0) size = 24;
    S.cursor_theme = wl_cursor_theme_load(getenv("XCURSOR_THEME"), size * S.scale, S.shm);
    S.cursor_theme_scale = S.scale;
  }
  if (!S.cursor_theme) return;

  // Freedesktop cursor names first, legacy X11 names as fallback.
  static const char *aliases[][3] = {
      {"default", "left_ptr", NULL},     {"pointer", "hand2", NULL},
      {"text", "xterm", NULL},           {"n-resize", "top_side", NULL},
      {"s-resize", "bottom_side", NULL}, {"e-resize", "right_side", NULL},
      {"w-resize", "left_side", NULL},   {"ne-resize", "top_right_corner", NULL},
      {"nw-resize", "top_left_corner", NULL}, {"se-resize", "bottom_right_corner", NULL},
      {"sw-resize", "bottom_left_corner", NULL},
  };
  struct wl_cursor *cursor = wl_cursor_theme_get_cursor(S.cursor_theme, S.cursor_name);
  for (size_t i = 0; !cursor && i < sizeof aliases / sizeof aliases[0]; i++)
    if (!strcmp(aliases[i][0], S.cursor_name))
      cursor = wl_cursor_theme_get_cursor(S.cursor_theme, aliases[i][1]);
  if (!cursor) cursor = wl_cursor_theme_get_cursor(S.cursor_theme, "left_ptr");
  if (!cursor || !cursor->image_count) return;

  struct wl_cursor_image *img = cursor->images[0];
  if (!S.cursor_surface) S.cursor_surface = wl_compositor_create_surface(S.compositor);
  wl_pointer_set_cursor(S.pointer, S.pointer_serial, S.cursor_surface,
                        img->hotspot_x / S.scale, img->hotspot_y / S.scale);
  wl_surface_attach(S.cursor_surface, wl_cursor_image_get_buffer(img), 0, 0);
  if (S.compositor_version >= 3) wl_surface_set_buffer_scale(S.cursor_surface, S.scale);
  wl_surface_damage(S.cursor_surface, 0, 0, INT32_MAX, INT32_MAX);
  wl_surface_commit(S.cursor_surface);
}

void nb_platform_set_cursor(const char *name) {
  if (!strcmp(name, S.cursor_name)) return;
  snprintf(S.cursor_name, sizeof S.cursor_name, "%s", name);
  apply_cursor();
}

// ---- pointer ----------------------------------------------------------------

static void pointer_enter(void *d, struct wl_pointer *p, uint32_t serial, struct wl_surface *s,
                          wl_fixed_t x, wl_fixed_t y) {
  S.pointer_serial = serial;
  S.px = wl_fixed_to_double(x);
  S.py = wl_fixed_to_double(y);
  apply_cursor();
  nb_event e = {.type = NB_EV_POINTER_MOVE, .x = S.px, .y = S.py};
  nb_push_event(&e);
}

static void pointer_leave(void *d, struct wl_pointer *p, uint32_t serial, struct wl_surface *s) {
  nb_event e = {.type = NB_EV_POINTER_LEAVE};
  nb_push_event(&e);
}

static void pointer_motion(void *d, struct wl_pointer *p, uint32_t time, wl_fixed_t x, wl_fixed_t y) {
  S.px = wl_fixed_to_double(x);
  S.py = wl_fixed_to_double(y);
  nb_event e = {.type = NB_EV_POINTER_MOVE, .x = S.px, .y = S.py};
  nb_push_event(&e);
}

static void pointer_button(void *d, struct wl_pointer *p, uint32_t serial, uint32_t time,
                           uint32_t button, uint32_t state) {
  S.last_serial = serial;
  int b = button == BTN_LEFT ? 0 : button == BTN_MIDDLE ? 1 : button == BTN_RIGHT ? 2 : 3;
  nb_event e = {.type = state == WL_POINTER_BUTTON_STATE_PRESSED ? NB_EV_POINTER_DOWN : NB_EV_POINTER_UP,
                .x = S.px, .y = S.py, .button = b};
  nb_push_event(&e);
}

static void pointer_axis(void *d, struct wl_pointer *p, uint32_t time, uint32_t axis, wl_fixed_t value) {
  nb_event e = {.type = NB_EV_SCROLL, .x = S.px, .y = S.py};
  if (axis == WL_POINTER_AXIS_VERTICAL_SCROLL) e.dy = wl_fixed_to_double(value);
  else e.dx = wl_fixed_to_double(value);
  nb_push_event(&e);
}

static void pointer_frame(void *d, struct wl_pointer *p) {}
static void pointer_axis_source(void *d, struct wl_pointer *p, uint32_t source) {}
static void pointer_axis_stop(void *d, struct wl_pointer *p, uint32_t time, uint32_t axis) {}
static void pointer_axis_discrete(void *d, struct wl_pointer *p, uint32_t axis, int32_t discrete) {}

static const struct wl_pointer_listener pointer_listener = {
    .enter = pointer_enter,
    .leave = pointer_leave,
    .motion = pointer_motion,
    .button = pointer_button,
    .axis = pointer_axis,
    .frame = pointer_frame,
    .axis_source = pointer_axis_source,
    .axis_stop = pointer_axis_stop,
    .axis_discrete = pointer_axis_discrete,
};

// ---- keyboard ---------------------------------------------------------------

static int current_mods(void) {
  if (!S.xkb_state) return 0;
  int m = 0;
  if (xkb_state_mod_name_is_active(S.xkb_state, XKB_MOD_NAME_CTRL, XKB_STATE_MODS_EFFECTIVE) > 0) m |= NB_MOD_CTRL;
  if (xkb_state_mod_name_is_active(S.xkb_state, XKB_MOD_NAME_SHIFT, XKB_STATE_MODS_EFFECTIVE) > 0) m |= NB_MOD_SHIFT;
  if (xkb_state_mod_name_is_active(S.xkb_state, XKB_MOD_NAME_ALT, XKB_STATE_MODS_EFFECTIVE) > 0) m |= NB_MOD_ALT;
  if (xkb_state_mod_name_is_active(S.xkb_state, XKB_MOD_NAME_LOGO, XKB_STATE_MODS_EFFECTIVE) > 0) m |= NB_MOD_SUPER;
  return m;
}

static void emit_key(uint32_t key, bool pressed, bool repeat) {
  if (!S.xkb_state) return;
  xkb_keycode_t code = key + 8;
  xkb_keysym_t sym = xkb_state_key_get_one_sym(S.xkb_state, code);
  nb_event e = {.type = pressed ? NB_EV_KEY_DOWN : NB_EV_KEY_UP, .repeat = repeat, .mods = current_mods()};

  if (pressed) {
    enum xkb_compose_status status = XKB_COMPOSE_NOTHING;
    if (S.compose && !repeat) {
      xkb_compose_state_feed(S.compose, sym);
      status = xkb_compose_state_get_status(S.compose);
    }
    switch (status) {
      case XKB_COMPOSE_COMPOSING:  // dead key pressed, waiting for the next one
        break;
      case XKB_COMPOSE_COMPOSED:
        xkb_compose_state_get_utf8(S.compose, e.text, sizeof e.text);
        sym = xkb_compose_state_get_one_sym(S.compose);
        xkb_compose_state_reset(S.compose);
        break;
      case XKB_COMPOSE_CANCELLED:
        xkb_compose_state_reset(S.compose);
        break;
      default:
        xkb_state_key_get_utf8(S.xkb_state, code, e.text, sizeof e.text);
    }
  }
  xkb_keysym_get_name(sym, e.key, sizeof e.key);
  nb_push_event(&e);
}

static void arm_repeat(int delay_ms, int interval_ms) {
  if (S.repeat_fd <= 0) return;
  struct itimerspec spec = {
      .it_value = {delay_ms / 1000, (delay_ms % 1000) * 1000000L},
      .it_interval = {interval_ms / 1000, (interval_ms % 1000) * 1000000L},
  };
  timerfd_settime(S.repeat_fd, 0, &spec, NULL);
}

static void stop_repeat(void) {
  arm_repeat(0, 0);
  S.repeat_key = 0;
}

int nb_wl_repeat_fd(void) { return S.repeat_fd; }

void nb_wl_repeat_tick(void) {
  uint64_t expirations;
  if (read(S.repeat_fd, &expirations, sizeof expirations) != sizeof expirations) return;
  if (S.repeat_key) emit_key(S.repeat_key, true, true);
}

static void kb_keymap(void *d, struct wl_keyboard *k, uint32_t format, int32_t fd, uint32_t size) {
  if (format != WL_KEYBOARD_KEYMAP_FORMAT_XKB_V1) { close(fd); return; }
  char *map = mmap(NULL, size, PROT_READ, MAP_PRIVATE, fd, 0);
  close(fd);
  if (map == MAP_FAILED) return;
  struct xkb_keymap *keymap =
      xkb_keymap_new_from_string(S.xkb, map, XKB_KEYMAP_FORMAT_TEXT_V1, XKB_KEYMAP_COMPILE_NO_FLAGS);
  munmap(map, size);
  if (!keymap) return;
  if (S.xkb_state) xkb_state_unref(S.xkb_state);
  if (S.keymap) xkb_keymap_unref(S.keymap);
  S.keymap = keymap;
  S.xkb_state = xkb_state_new(keymap);
}

static void kb_enter(void *d, struct wl_keyboard *k, uint32_t serial, struct wl_surface *s, struct wl_array *keys) {
  nb_event e = {.type = NB_EV_FOCUS, .focused = true};
  nb_push_event(&e);
}

static void kb_leave(void *d, struct wl_keyboard *k, uint32_t serial, struct wl_surface *s) {
  stop_repeat();
  nb_event e = {.type = NB_EV_FOCUS, .focused = false};
  nb_push_event(&e);
}

static void kb_key(void *d, struct wl_keyboard *k, uint32_t serial, uint32_t time, uint32_t key, uint32_t state) {
  bool pressed = state == WL_KEYBOARD_KEY_STATE_PRESSED;
  emit_key(key, pressed, false);
  if (pressed && S.repeat_rate > 0 && S.keymap && xkb_keymap_key_repeats(S.keymap, key + 8)) {
    S.repeat_key = key;
    arm_repeat(S.repeat_delay, 1000 / S.repeat_rate);
  } else if (!pressed && key == S.repeat_key) {
    stop_repeat();
  }
}

static void kb_modifiers(void *d, struct wl_keyboard *k, uint32_t serial, uint32_t depressed,
                         uint32_t latched, uint32_t locked, uint32_t group) {
  if (S.xkb_state) xkb_state_update_mask(S.xkb_state, depressed, latched, locked, 0, 0, group);
}

static void kb_repeat_info(void *d, struct wl_keyboard *k, int32_t rate, int32_t delay) {
  S.repeat_rate = rate;
  S.repeat_delay = delay;
}

static const struct wl_keyboard_listener keyboard_listener = {
    .keymap = kb_keymap,
    .enter = kb_enter,
    .leave = kb_leave,
    .key = kb_key,
    .modifiers = kb_modifiers,
    .repeat_info = kb_repeat_info,
};

// ---- seat / registry --------------------------------------------------------

static void seat_capabilities(void *d, struct wl_seat *seat, uint32_t caps) {
  if ((caps & WL_SEAT_CAPABILITY_POINTER) && !S.pointer) {
    S.pointer = wl_seat_get_pointer(seat);
    wl_pointer_add_listener(S.pointer, &pointer_listener, NULL);
  }
  if ((caps & WL_SEAT_CAPABILITY_KEYBOARD) && !S.keyboard) {
    S.keyboard = wl_seat_get_keyboard(seat);
    wl_keyboard_add_listener(S.keyboard, &keyboard_listener, NULL);
  }
}

static void seat_name(void *d, struct wl_seat *seat, const char *name) {}

static const struct wl_seat_listener seat_listener = {.capabilities = seat_capabilities, .name = seat_name};

static void wm_ping(void *d, struct xdg_wm_base *wm, uint32_t serial) { xdg_wm_base_pong(wm, serial); }
static const struct xdg_wm_base_listener wm_listener = {.ping = wm_ping};

static void reg_global(void *d, struct wl_registry *r, uint32_t name, const char *iface, uint32_t version) {
  if (!strcmp(iface, wl_compositor_interface.name)) {
    S.compositor_version = MIN(version, 6);
    S.compositor = wl_registry_bind(r, name, &wl_compositor_interface, S.compositor_version);
  } else if (!strcmp(iface, xdg_wm_base_interface.name)) {
    S.wm_base = wl_registry_bind(r, name, &xdg_wm_base_interface, MIN(version, 5));
    xdg_wm_base_add_listener(S.wm_base, &wm_listener, NULL);
  } else if (!strcmp(iface, wl_seat_interface.name) && !S.seat) {
    S.seat = wl_registry_bind(r, name, &wl_seat_interface, MIN(version, 5));
    wl_seat_add_listener(S.seat, &seat_listener, NULL);
  } else if (!strcmp(iface, wl_shm_interface.name)) {
    S.shm = wl_registry_bind(r, name, &wl_shm_interface, 1);
  }
}

static void reg_global_remove(void *d, struct wl_registry *r, uint32_t name) {}

static const struct wl_registry_listener registry_listener = {.global = reg_global,
                                                              .global_remove = reg_global_remove};

// ---- surface / toplevel -----------------------------------------------------

static void surface_enter(void *d, struct wl_surface *s, struct wl_output *o) {}
static void surface_leave(void *d, struct wl_surface *s, struct wl_output *o) {}

static void surface_preferred_scale(void *d, struct wl_surface *s, int32_t scale) {
  if (scale < 1 || scale == S.scale) return;
  S.scale = scale;
  apply_cursor();
  if (S.configured) emit_configure();
}

static void surface_preferred_transform(void *d, struct wl_surface *s, uint32_t transform) {}

static const struct wl_surface_listener surface_listener = {
    .enter = surface_enter,
    .leave = surface_leave,
    .preferred_buffer_scale = surface_preferred_scale,
    .preferred_buffer_transform = surface_preferred_transform,
};

static void xdg_surface_configure(void *d, struct xdg_surface *xs, uint32_t serial) {
  xdg_surface_ack_configure(xs, serial);
  if (S.pending_w > 0 && S.pending_h > 0) {
    S.width = S.pending_w;
    S.height = S.pending_h;
  }
  S.configured = true;
  emit_configure();
}

static const struct xdg_surface_listener xdg_surface_listener = {.configure = xdg_surface_configure};

static void toplevel_configure(void *d, struct xdg_toplevel *t, int32_t w, int32_t h, struct wl_array *states) {
  S.pending_w = w;
  S.pending_h = h;
  S.maximized = false;
  S.activated = false;
  uint32_t *state;
  wl_array_for_each(state, states) {
    if (*state == XDG_TOPLEVEL_STATE_MAXIMIZED) S.maximized = true;
    if (*state == XDG_TOPLEVEL_STATE_ACTIVATED) S.activated = true;
  }
}

static void toplevel_close(void *d, struct xdg_toplevel *t) {
  nb_event e = {.type = NB_EV_CLOSE};
  nb_push_event(&e);
}

static void toplevel_bounds(void *d, struct xdg_toplevel *t, int32_t w, int32_t h) {}
static void toplevel_caps(void *d, struct xdg_toplevel *t, struct wl_array *caps) {}

static const struct xdg_toplevel_listener toplevel_listener = {
    .configure = toplevel_configure,
    .close = toplevel_close,
    .configure_bounds = toplevel_bounds,
    .wm_capabilities = toplevel_caps,
};

static void frame_done(void *d, struct wl_callback *cb, uint32_t time) {
  wl_callback_destroy(cb);
  S.frame_cb = NULL;
  nb_event e = {.type = NB_EV_FRAME};
  nb_push_event(&e);
}

static const struct wl_callback_listener frame_listener = {.done = frame_done};

// ---- public API -------------------------------------------------------------

static bool init_egl(void) {
  S.egl_display = eglGetDisplay((EGLNativeDisplayType)S.display);
  if (S.egl_display == EGL_NO_DISPLAY || !eglInitialize(S.egl_display, NULL, NULL)) return false;
  eglBindAPI(EGL_OPENGL_ES_API);

  EGLint attrs[] = {EGL_SURFACE_TYPE, EGL_WINDOW_BIT, EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8,
                    EGL_ALPHA_SIZE, 8, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT, EGL_NONE};
  EGLConfig config;
  EGLint n = 0;
  if (!eglChooseConfig(S.egl_display, attrs, &config, 1, &n) || n < 1) return false;

  EGLint ctx_attrs[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
  S.egl_context = eglCreateContext(S.egl_display, config, EGL_NO_CONTEXT, ctx_attrs);
  if (S.egl_context == EGL_NO_CONTEXT) return false;

  S.buffer_w = S.width * S.scale;
  S.buffer_h = S.height * S.scale;
  S.egl_window = wl_egl_window_create(S.surface, S.buffer_w, S.buffer_h);
  S.egl_surface = eglCreateWindowSurface(S.egl_display, config, (EGLNativeWindowType)S.egl_window, NULL);
  if (S.egl_surface == EGL_NO_SURFACE) return false;
  if (!eglMakeCurrent(S.egl_display, S.egl_surface, S.egl_surface, S.egl_context)) return false;
  // We pace frames ourselves with wl_surface.frame; never block inside eglSwapBuffers.
  eglSwapInterval(S.egl_display, 0);
  return true;
}

bool nb_platform_open(const nb_window_options *options) {
  const char *title = options->title, *app_id = options->app_id;
  S.scale = 1;
  S.width = options->width;
  S.height = options->height;
  snprintf(S.cursor_name, sizeof S.cursor_name, "default");

  S.display = wl_display_connect(NULL);
  if (!S.display) {
    fprintf(stderr, "nodebuilder: could not connect to a Wayland display\n");
    return false;
  }

  setlocale(LC_CTYPE, "");
  S.xkb = xkb_context_new(XKB_CONTEXT_NO_FLAGS);
  const char *locale = getenv("LC_ALL");
  if (!locale || !*locale) locale = getenv("LC_CTYPE");
  if (!locale || !*locale) locale = getenv("LANG");
  if (!locale || !*locale) locale = "C";
  S.compose_table = xkb_compose_table_new_from_locale(S.xkb, locale, XKB_COMPOSE_COMPILE_NO_FLAGS);
  if (S.compose_table) S.compose = xkb_compose_state_new(S.compose_table, XKB_COMPOSE_STATE_NO_FLAGS);

  S.repeat_fd = timerfd_create(CLOCK_MONOTONIC, TFD_NONBLOCK | TFD_CLOEXEC);

  S.registry = wl_display_get_registry(S.display);
  wl_registry_add_listener(S.registry, &registry_listener, NULL);
  wl_display_roundtrip(S.display);
  wl_display_roundtrip(S.display);  // second roundtrip delivers seat capabilities
  if (!S.compositor || !S.wm_base) {
    fprintf(stderr, "nodebuilder: compositor lacks wl_compositor or xdg_wm_base\n");
    return false;
  }

  S.surface = wl_compositor_create_surface(S.compositor);
  wl_surface_add_listener(S.surface, &surface_listener, NULL);
  S.xdg_surface = xdg_wm_base_get_xdg_surface(S.wm_base, S.surface);
  xdg_surface_add_listener(S.xdg_surface, &xdg_surface_listener, NULL);
  S.toplevel = xdg_surface_get_toplevel(S.xdg_surface);
  xdg_toplevel_add_listener(S.toplevel, &toplevel_listener, NULL);
  xdg_toplevel_set_title(S.toplevel, title);
  xdg_toplevel_set_app_id(S.toplevel, app_id);
  xdg_toplevel_set_min_size(S.toplevel, 240, 160);
  wl_surface_commit(S.surface);

  while (!S.configured)
    if (wl_display_dispatch(S.display) < 0) return false;

  if (!init_egl()) {
    fprintf(stderr, "nodebuilder: EGL initialisation failed (0x%x)\n", eglGetError());
    return false;
  }
  return true;
}

void nb_platform_close(void) {
  stop_repeat();
  if (S.repeat_fd > 0) close(S.repeat_fd);
  if (S.egl_display) {
    eglMakeCurrent(S.egl_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    if (S.egl_surface) eglDestroySurface(S.egl_display, S.egl_surface);
    if (S.egl_context) eglDestroyContext(S.egl_display, S.egl_context);
    eglTerminate(S.egl_display);
  }
  if (S.egl_window) wl_egl_window_destroy(S.egl_window);
  if (S.frame_cb) wl_callback_destroy(S.frame_cb);
  if (S.toplevel) xdg_toplevel_destroy(S.toplevel);
  if (S.xdg_surface) xdg_surface_destroy(S.xdg_surface);
  if (S.surface) wl_surface_destroy(S.surface);
  if (S.cursor_surface) wl_surface_destroy(S.cursor_surface);
  if (S.cursor_theme) wl_cursor_theme_destroy(S.cursor_theme);
  if (S.display) {
    wl_display_flush(S.display);
    wl_display_disconnect(S.display);
  }
  memset(&S, 0, sizeof S);
}

int nb_wl_fd(void) { return wl_display_get_fd(S.display); }
// Never blocks: reads only what is already on the socket. Other readers (Mesa's
// EGL queue) may have consumed the data that woke the pump thread.
int nb_wl_dispatch(void) {
  while (wl_display_prepare_read(S.display) != 0)
    if (wl_display_dispatch_pending(S.display) < 0) return -1;
  wl_display_flush(S.display);
  struct pollfd pfd = {.fd = wl_display_get_fd(S.display), .events = POLLIN};
  if (poll(&pfd, 1, 0) > 0 && (pfd.revents & POLLIN)) {
    if (wl_display_read_events(S.display) < 0) return -1;
  } else {
    wl_display_cancel_read(S.display);
    if (pfd.revents & (POLLERR | POLLHUP)) return -1;
  }
  return wl_display_dispatch_pending(S.display);
}

void nb_platform_flush(void) {
  if (!S.display) return;
  wl_display_dispatch_pending(S.display);
  wl_display_flush(S.display);
}

int nb_platform_scale(void) { return S.scale ? S.scale : 1; }

void nb_platform_begin_frame(int *bw, int *bh, int *scale) {
  int w = S.width * S.scale, h = S.height * S.scale;
  if (w != S.buffer_w || h != S.buffer_h) {
    wl_egl_window_resize(S.egl_window, w, h, 0, 0);
    S.buffer_w = w;
    S.buffer_h = h;
  }
  if (S.compositor_version >= 3) wl_surface_set_buffer_scale(S.surface, S.scale);
  eglMakeCurrent(S.egl_display, S.egl_surface, S.egl_surface, S.egl_context);
  *bw = w;
  *bh = h;
  *scale = S.scale;
}

void nb_platform_end_frame(void) {
  if (!S.frame_cb) {
    S.frame_cb = wl_surface_frame(S.surface);
    wl_callback_add_listener(S.frame_cb, &frame_listener, NULL);
  }
  eglSwapBuffers(S.egl_display, S.egl_surface);
}

void nb_platform_request_frame(void) {
  if (S.frame_cb || !S.surface) return;
  S.frame_cb = wl_surface_frame(S.surface);
  wl_callback_add_listener(S.frame_cb, &frame_listener, NULL);
  wl_surface_commit(S.surface);
  wl_display_flush(S.display);
}

void nb_platform_set_title(const char *title) { if (S.toplevel) xdg_toplevel_set_title(S.toplevel, title); }
void nb_platform_move(void) { if (S.toplevel && S.seat) xdg_toplevel_move(S.toplevel, S.seat, S.last_serial); }
void nb_platform_resize(uint32_t edges) { if (S.toplevel && S.seat) xdg_toplevel_resize(S.toplevel, S.seat, S.last_serial, edges); }
void nb_platform_minimize(void) { if (S.toplevel) xdg_toplevel_set_minimized(S.toplevel); }

void nb_platform_set_maximized(bool maximized) {
  if (!S.toplevel) return;
  if (maximized) xdg_toplevel_set_maximized(S.toplevel);
  else xdg_toplevel_unset_maximized(S.toplevel);
}
