// The contract every OS backend implements (native/platform/<os>/).
// The portable core (native/core/) only talks to the OS through these calls.
//
// Threading model: every function here runs on the JS thread, except the
// `wake` callback passed to nb_platform_pump_start, which the backend may call
// from any thread to say "there is work, call nb_platform_pump_process()".
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// ---- window -----------------------------------------------------------------

typedef struct {
  const char *title;
  const char *app_id;
  int width, height;  // logical px
} nb_window_options;

// Resize edges (bitmask), matching what src/runtime/app.ts sends.
enum { NB_EDGE_TOP = 1, NB_EDGE_BOTTOM = 2, NB_EDGE_LEFT = 4, NB_EDGE_RIGHT = 8 };

/** Creates the window and a current GLES2-compatible context. Queues the first NB_EV_CONFIGURE. */
bool nb_platform_open(const nb_window_options *options);
void nb_platform_close(void);

/** Makes the context current and sizes the backbuffer; returns its physical size and integer scale. */
void nb_platform_begin_frame(int *buffer_w, int *buffer_h, int *scale);
/** Presents the frame and arranges for an NB_EV_FRAME when the next one may be drawn. */
void nb_platform_end_frame(void);
/** Asks for an NB_EV_FRAME at the next vblank without presenting anything. */
void nb_platform_request_frame(void);
int nb_platform_scale(void);

void nb_platform_set_cursor(const char *name);  // freedesktop cursor names ("default", "pointer", "text", "n-resize"...)
void nb_platform_set_title(const char *title);
void nb_platform_move(void);                    // interactive move, started from the last pointer press
void nb_platform_resize(uint32_t edges);        // interactive resize (NB_EDGE_* bitmask)
void nb_platform_set_maximized(bool maximized);
void nb_platform_minimize(void);

// ---- offscreen rendering (screenshots) ---------------------------------------

/**
 * JS thread. Makes a GLES2 context current with no window, no display server and no event
 * pump, with a `buffer_w` x `buffer_h` RGBA8 framebuffer bound: what the renderer draws then
 * lands there, to be read back with glReadPixels. The context is created on the first call and
 * kept (the next call only resizes the target). The core never calls it while a window is open
 * (both would share the renderer's GL objects). On failure: false and the reason in `error`.
 */
bool nb_platform_offscreen_begin(int buffer_w, int buffer_h, char *error, size_t error_size);
/** JS thread: releases the offscreen context, if any. */
void nb_platform_offscreen_close(void);

// ---- clipboard (plain text) ------------------------------------------------

/** Offers `utf8` (copied) as the clipboard's content until another client takes it over. */
void nb_platform_clipboard_write(const char *utf8);
/**
 * Asks for the clipboard's text. The answer is an NB_EV_CLIPBOARD, possibly pushed before
 * this returns (when we own the clipboard); empty when there is no text. A new request
 * replaces one still in flight.
 */
void nb_platform_clipboard_read(void);

// ---- event loop -------------------------------------------------------------

typedef void (*nb_wake_fn)(void);

/** Starts watching OS event sources; calls `wake` (any thread) whenever there is work. */
bool nb_platform_pump_start(nb_wake_fn wake);
void nb_platform_pump_stop(void);
/** JS thread, after a wake: handle ready sources (pushing nb_events) and resume watching. */
void nb_platform_pump_process(void);
/** JS thread: dispatch anything already received and flush outgoing requests. */
void nb_platform_flush(void);

// ---- fonts ------------------------------------------------------------------

/** Path of the system UI font file for NB_FONT_REGULAR / NB_FONT_BOLD (malloc'd), or NULL. */
char *nb_platform_font_path(int font);
/**
 * JS thread. A font file with a glyph for `codepoint`, to draw what the UI font lacks: the
 * system's fallback order for `font` (NB_FONT_REGULAR / NB_FONT_BOLD), or, when `emoji`, only
 * color fonts (emoji presentation). Returns the path (malloc'd) and the face index inside it
 * (font collections) in *face_index, or NULL when no font has it. May be slow (the core
 * caches the answer per codepoint); the first call may build the fallback list.
 */
char *nb_platform_font_fallback(uint32_t codepoint, int font, bool emoji, int *face_index);

// ---- image codecs -----------------------------------------------------------

/**
 * Decodes formats the TypeScript side can't (AVIF, HEIC) with the OS's codecs. Works
 * without a window. On success: true and *rgba = malloc'd RGBA8 with straight alpha
 * (the caller frees it). On failure: false and a message in `error`.
 */
bool nb_platform_decode_image(const uint8_t *data, size_t size, int *width, int *height, uint8_t **rgba,
                              char *error, size_t error_size);
