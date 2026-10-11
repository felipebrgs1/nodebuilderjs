// Internal API of the Linux platform. Linux has two windowing backends
// (Wayland, X11) behind one vtable; linux.c picks one at runtime and implements
// nb_platform.h by forwarding to it. pump.c polls whatever fds it exposes.
#pragma once

#include "nb.h"

#define NB_LINUX_MAX_FDS 4

typedef struct {
  const char *name;
  /** Returns false if this backend is unavailable (e.g. no display); must leave nothing open. */
  bool (*open)(const nb_window_options *options);
  void (*close)(void);
  void (*begin_frame)(int *buffer_w, int *buffer_h, int *scale);
  void (*end_frame)(void);
  void (*request_frame)(void);
  int (*scale)(void);
  void (*set_cursor)(const char *name);
  void (*set_title)(const char *title);
  void (*move)(void);
  void (*resize)(uint32_t edges);
  void (*set_maximized)(bool maximized);
  void (*minimize)(void);
  /** fds the pump thread must watch; fd i becomes bit (1 << i) of `ready`. */
  int (*fds)(int *out, int max);
  /** JS thread: handle ready fds without blocking; -1 on a fatal connection error. */
  int (*process)(int ready);
  /** JS thread: dispatch already-received events and flush outgoing requests. */
  void (*flush)(void);
} nb_linux_backend;

extern const nb_linux_backend nb_wayland_backend;
extern const nb_linux_backend nb_x11_backend;

/** The backend chosen by nb_platform_open (NULL before). */
const nb_linux_backend *nb_linux_active(void);
