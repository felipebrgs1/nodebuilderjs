// Internal API of the Linux platform. Linux has two windowing backends
// (Wayland, X11) behind one vtable; linux.c picks one at runtime and implements
// nb_platform.h by forwarding to it. pump.c polls whatever fds it exposes.
#pragma once

#include <poll.h>

#include "nb.h"

#define NB_LINUX_MAX_FDS 8

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
  void (*clipboard_write)(const char *utf8);
  void (*clipboard_read)(void);
  /**
   * JS thread: the fds the pump thread must watch next, with the events to wait for. Asked
   * again every time the pump resumes; call nb_linux_pump_refresh() when the set changes
   * outside nb_platform_pump_process().
   */
  int (*fds)(struct pollfd *out, int max);
  /**
   * JS thread: handle the fds with revents set, without blocking; -1 on a fatal connection
   * error. A ready fd may have been closed and its number reused since it was polled, so
   * reads and writes must be non-blocking.
   */
  int (*process)(const struct pollfd *ready, int count);
  /** JS thread: dispatch already-received events and flush outgoing requests. */
  void (*flush)(void);
} nb_linux_backend;

extern const nb_linux_backend nb_wayland_backend;
extern const nb_linux_backend nb_x11_backend;

/** The backend chosen by nb_platform_open (NULL before). */
const nb_linux_backend *nb_linux_active(void);

/** JS thread: the backend's fds changed; the pump asks for them again. */
void nb_linux_pump_refresh(void);

/** Pushes an NB_EV_CLIPBOARD with a copy of `len` bytes of `text` (NULL = empty). */
void nb_linux_clipboard_answer(const char *text, size_t len);
