// nb_platform.h for Linux: picks Wayland or X11 at runtime and forwards to it.
//   NB_BACKEND=wayland|x11 forces one; otherwise Wayland when a Wayland session
//   is available, falling back to X11 (DISPLAY).
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "linux.h"

static const nb_linux_backend *active;

const nb_linux_backend *nb_linux_active(void) { return active; }

static bool try_open(const nb_linux_backend *b, const nb_window_options *options) {
  if (b->open(options)) {
    active = b;
    if (getenv("NB_DEBUG")) fprintf(stderr, "nodebuilder: using the %s backend\n", b->name);
    return true;
  }
  b->close();
  return false;
}

bool nb_platform_open(const nb_window_options *options) {
  const char *forced = getenv("NB_BACKEND");
  if (forced && *forced) {
    if (!strcmp(forced, "wayland")) return try_open(&nb_wayland_backend, options);
    if (!strcmp(forced, "x11")) return try_open(&nb_x11_backend, options);
    fprintf(stderr, "nodebuilder: unknown NB_BACKEND '%s' (use wayland or x11)\n", forced);
    return false;
  }
  const char *wl = getenv("WAYLAND_DISPLAY");
  if (wl && *wl && try_open(&nb_wayland_backend, options)) return true;
  const char *x = getenv("DISPLAY");
  if (x && *x && try_open(&nb_x11_backend, options)) return true;
  // Last resort: Wayland's default socket even without WAYLAND_DISPLAY.
  if (!(wl && *wl) && try_open(&nb_wayland_backend, options)) return true;
  fprintf(stderr, "nodebuilder: no usable display (tried Wayland and X11)\n");
  return false;
}

void nb_platform_probe_display(nb_display_probe *out) {
  memset(out, 0, sizeof *out);
  const nb_linux_backend *tried[3];
  int n = 0;
  const char *forced = getenv("NB_BACKEND");
  if (forced && *forced) {
    if (!strcmp(forced, "wayland")) tried[n++] = &nb_wayland_backend;
    else if (!strcmp(forced, "x11")) tried[n++] = &nb_x11_backend;
    else {
      snprintf(out->error, sizeof out->error, "unknown NB_BACKEND '%s' (use wayland or x11)", forced);
      return;
    }
  } else {
    // The order of nb_platform_open: Wayland with WAYLAND_DISPLAY, X11 with DISPLAY, then
    // Wayland's default socket.
    const char *wl = getenv("WAYLAND_DISPLAY"), *x = getenv("DISPLAY");
    if (wl && *wl) tried[n++] = &nb_wayland_backend;
    if (x && *x) tried[n++] = &nb_x11_backend;
    if (!(wl && *wl)) tried[n++] = &nb_wayland_backend;
  }
  char errors[sizeof out->error] = "";
  for (int i = 0; i < n; i++) {
    out->error[0] = 0;
    if (tried[i]->probe(out)) {
      out->backend = tried[i]->name;
      out->error[0] = 0;
      return;
    }
    size_t len = strlen(errors);
    if (snprintf(errors + len, sizeof errors - len, "%s%s", len ? "; " : "", out->error) < 0) break;  // truncation is fine
  }
  snprintf(out->error, sizeof out->error, "%s", errors);
}

const char *nb_linux_locale(void) {
  const char *names[] = {"LC_ALL", "LC_CTYPE", "LANG"};
  for (int i = 0; i < 3; i++) {
    const char *v = getenv(names[i]);
    if (v && *v) return v;
  }
  return "C";
}

void nb_platform_close(void) {
  if (active) active->close();
  active = NULL;
}

#define FORWARD(call) \
  do {                \
    if (active) call; \
  } while (0)

void nb_platform_begin_frame(int *bw, int *bh, int *scale) { FORWARD(active->begin_frame(bw, bh, scale)); }
void nb_platform_end_frame(void) { FORWARD(active->end_frame()); }
void nb_platform_request_frame(void) { FORWARD(active->request_frame()); }
int nb_platform_scale(void) { return active ? active->scale() : 1; }
void nb_platform_set_cursor(const char *name) { FORWARD(active->set_cursor(name)); }
void nb_platform_set_title(const char *title) { FORWARD(active->set_title(title)); }
void nb_platform_move(void) { FORWARD(active->move()); }
void nb_platform_resize(uint32_t edges) { FORWARD(active->resize(edges)); }
void nb_platform_set_maximized(bool maximized) { FORWARD(active->set_maximized(maximized)); }
void nb_platform_minimize(void) { FORWARD(active->minimize()); }
void nb_platform_flush(void) { FORWARD(active->flush()); }
void nb_platform_clipboard_write(const char *utf8) { FORWARD(active->clipboard_write(utf8)); }
void nb_platform_clipboard_read(void) { FORWARD(active->clipboard_read()); }

void nb_linux_clipboard_answer(const char *text, size_t len) {
  nb_event e = {.type = NB_EV_CLIPBOARD};
  if (text && len) {
    e.data = malloc(len + 1);
    memcpy(e.data, text, len);
    e.data[len] = 0;
  }
  nb_push_event(&e);
}
