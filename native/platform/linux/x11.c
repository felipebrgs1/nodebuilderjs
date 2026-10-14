// X11 backend: Xlib window with EWMH hints (we draw our own decorations), EGL on
// the X11 platform, XIM keyboard input (dead keys / compose), Xcursor themes.
// X11 has no frame callbacks, so frames are paced by a timerfd at the monitor's
// refresh rate (XRandR). Exposed as nb_x11_backend.
#define _GNU_SOURCE
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <X11/XKBlib.h>
#include <X11/Xatom.h>
#include <X11/Xcursor/Xcursor.h>
#include <X11/Xlib.h>
#include <X11/Xresource.h>
#include <X11/Xutil.h>
#include <X11/extensions/Xrandr.h>
#include <limits.h>
#include <locale.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/timerfd.h>
#include <unistd.h>

#include "linux.h"

// _NET_WM_MOVERESIZE directions
enum { MR_TOPLEFT, MR_TOP, MR_TOPRIGHT, MR_RIGHT, MR_BOTTOMRIGHT, MR_BOTTOM, MR_BOTTOMLEFT, MR_LEFT, MR_MOVE };

static struct {
  Display *dpy;
  int screen;
  Window root, win;
  Colormap colormap;
  XIM im;
  XIC ic;
  Cursor cursor;
  char cursor_name[64];

  Atom wm_protocols, wm_delete, net_wm_name, utf8_string, net_wm_state, net_wm_state_max_v,
      net_wm_state_max_h, net_wm_moveresize, net_wm_icon, motif_hints, clipboard, targets, incr_atom, text_atom, paste_prop;

  EGLDisplay egl_display;
  EGLContext egl_context;
  EGLSurface egl_surface;

  int phys_w, phys_h;  // window size in physical px
  int scale;
  bool maximized, activated, transparent;

  int frame_fd;
  bool frame_armed;
  int refresh_hz;

  int root_x, root_y, last_button;  // last press, for _NET_WM_MOVERESIZE
  uint8_t keys_down[32];            // keycode bitset: X auto-repeat detection
  Time last_time;                   // of the last input event, for selection requests

  char *clip_text;  // our CLIPBOARD content while we own it
  bool pasting, incr;
  char *paste;
  size_t paste_len;
} X;

// ---- helpers ----------------------------------------------------------------

static void emit_configure(void) {
  nb_event e = {.type = NB_EV_CONFIGURE,
                .width = X.phys_w / X.scale,
                .height = X.phys_h / X.scale,
                .scale = X.scale,
                .maximized = X.maximized,
                .activated = X.activated,
                .transparent = X.transparent};
  nb_push_event(&e);
}

/** Integer UI scale from Xft.dpi (96 dpi = 1x), like most X11 toolkits. */
static int detect_scale(void) {
  const char *env = getenv("NB_SCALE");
  if (env && atoi(env) > 0) return atoi(env);
  char *resources = XResourceManagerString(X.dpy);
  int scale = 1;
  if (resources) {
    XrmInitialize();
    XrmDatabase db = XrmGetStringDatabase(resources);
    char *type;
    XrmValue value;
    if (db && XrmGetResource(db, "Xft.dpi", "Xft.Dpi", &type, &value) && value.addr) {
      double dpi = atof(value.addr);
      if (dpi > 0) scale = (int)lround(dpi / 96.0);
    }
    if (db) XrmDestroyDatabase(db);
  }
  return scale < 1 ? 1 : scale;
}

/** Highest refresh rate among active outputs (frames are capped in JS anyway). */
static int detect_refresh(void) {
  int best = 0;
  XRRScreenResources *res = XRRGetScreenResourcesCurrent(X.dpy, X.root);
  if (res) {
    for (int c = 0; c < res->ncrtc; c++) {
      XRRCrtcInfo *crtc = XRRGetCrtcInfo(X.dpy, res, res->crtcs[c]);
      if (!crtc) continue;
      for (int m = 0; crtc->mode && m < res->nmode; m++) {
        XRRModeInfo *mode = &res->modes[m];
        if (mode->id != crtc->mode || !mode->hTotal || !mode->vTotal) continue;
        int hz = (int)lround((double)mode->dotClock / ((double)mode->hTotal * mode->vTotal));
        if (hz > best) best = hz;
      }
      XRRFreeCrtcInfo(crtc);
    }
    XRRFreeScreenResources(res);
  }
  if (best <= 0) best = 60;
  return best > 240 ? 240 : best;
}

static void arm_frame_timer(void) {
  if (X.frame_armed) return;
  long ns = 1000000000L / X.refresh_hz;
  struct itimerspec spec = {.it_value = {ns / 1000000000L, ns % 1000000000L}};
  timerfd_settime(X.frame_fd, 0, &spec, NULL);
  X.frame_armed = true;
}

static void send_wm_message(Atom type, long a, long b, long c, long d, long e) {
  XEvent ev = {0};
  ev.xclient.type = ClientMessage;
  ev.xclient.window = X.win;
  ev.xclient.message_type = type;
  ev.xclient.format = 32;
  ev.xclient.data.l[0] = a;
  ev.xclient.data.l[1] = b;
  ev.xclient.data.l[2] = c;
  ev.xclient.data.l[3] = d;
  ev.xclient.data.l[4] = e;
  XSendEvent(X.dpy, X.root, False, SubstructureRedirectMask | SubstructureNotifyMask, &ev);
  XFlush(X.dpy);
}

static bool read_maximized(void) {
  Atom type;
  int format;
  unsigned long count, after;
  Atom *atoms = NULL;
  bool v = false, h = false;
  if (XGetWindowProperty(X.dpy, X.win, X.net_wm_state, 0, 64, False, XA_ATOM, &type, &format, &count, &after,
                         (unsigned char **)&atoms) == Success && atoms) {
    for (unsigned long i = 0; i < count; i++) {
      if (atoms[i] == X.net_wm_state_max_v) v = true;
      if (atoms[i] == X.net_wm_state_max_h) h = true;
    }
    XFree(atoms);
  }
  return v && h;
}

static int mods_of(unsigned int state) {
  int m = 0;
  if (state & ControlMask) m |= NB_MOD_CTRL;
  if (state & ShiftMask) m |= NB_MOD_SHIFT;
  if (state & Mod1Mask) m |= NB_MOD_ALT;
  if (state & Mod4Mask) m |= NB_MOD_SUPER;
  return m;
}

// ---- clipboard --------------------------------------------------------------
// The CLIPBOARD selection: owning it means answering SelectionRequests from other
// clients; pasting means XConvertSelection and waiting for SelectionNotify (and, for
// big transfers, INCR chunks through PropertyNotify). Everything rides on the
// display connection, so no extra fds.

static int ignore_x_error(Display *dpy, XErrorEvent *e) { return 0; }

static void answer_request(XSelectionRequestEvent *r) {
  XSelectionEvent reply = {.type = SelectionNotify, .requestor = r->requestor, .selection = r->selection,
                           .target = r->target, .property = None, .time = r->time};
  Atom property = r->property != None ? r->property : r->target;  // obsolete clients pass None
  long max = XExtendedMaxRequestSize(X.dpy) ? XExtendedMaxRequestSize(X.dpy) : XMaxRequestSize(X.dpy);
  size_t len = X.clip_text ? strlen(X.clip_text) : 0;
  // The requestor may vanish meanwhile; Xlib's default error handler would exit the process.
  XSync(X.dpy, False);
  XErrorHandler previous = XSetErrorHandler(ignore_x_error);
  if (X.clip_text && r->selection == X.clipboard) {
    if (r->target == X.targets) {
      Atom list[] = {X.targets, X.utf8_string, X.text_atom, XA_STRING};
      XChangeProperty(X.dpy, r->requestor, property, XA_ATOM, 32, PropModeReplace, (unsigned char *)list, 4);
      reply.property = property;
    } else if ((r->target == X.utf8_string || r->target == X.text_atom || r->target == XA_STRING) &&
               len < (size_t)max * 4 - 1024) {  // no INCR when sending: bigger texts are refused
      Atom type = r->target == XA_STRING ? XA_STRING : X.utf8_string;
      XChangeProperty(X.dpy, r->requestor, property, type, 8, PropModeReplace, (unsigned char *)X.clip_text, (int)len);
      reply.property = property;
    }
  }
  XSendEvent(X.dpy, r->requestor, False, 0, (XEvent *)&reply);
  XSync(X.dpy, False);
  XSetErrorHandler(previous);
}

static void end_paste(bool answer) {
  if (answer) nb_linux_clipboard_answer(X.paste, X.paste_len);
  free(X.paste);
  X.paste = NULL;
  X.paste_len = 0;
  X.pasting = X.incr = false;
}

/** Reads (and deletes) our paste property; false when it was empty. */
static bool take_paste_property(Atom *type) {
  int format;
  unsigned long count, after;
  unsigned char *data = NULL;
  if (XGetWindowProperty(X.dpy, X.win, X.paste_prop, 0, LONG_MAX / 4, True, AnyPropertyType, type, &format, &count,
                         &after, &data) != Success)
    return false;
  size_t bytes = count * (format / 8);
  if (data && bytes && *type != X.incr_atom) {
    X.paste = realloc(X.paste, X.paste_len + bytes);
    memcpy(X.paste + X.paste_len, data, bytes);
    X.paste_len += bytes;
  }
  if (data) XFree(data);
  return *type == X.incr_atom || bytes > 0;
}

static void selection_notify(XSelectionEvent *e) {
  if (!X.pasting || e->selection != X.clipboard) return;
  Atom type = None;
  if (e->property != None && take_paste_property(&type) && type == X.incr_atom)
    X.incr = true;  // deleting the property asked for the first chunk
  else
    end_paste(true);
}

static void incr_chunk(void) {
  Atom type;
  if (!take_paste_property(&type)) end_paste(true);  // an empty chunk ends the transfer
}

static void x_clipboard_write(const char *utf8) {
  if (!X.dpy) return;
  free(X.clip_text);
  X.clip_text = strdup(utf8);
  XSetSelectionOwner(X.dpy, X.clipboard, X.win, X.last_time ? X.last_time : CurrentTime);
  if (XGetSelectionOwner(X.dpy, X.clipboard) != X.win) {
    free(X.clip_text);
    X.clip_text = NULL;
  }
}

static void x_clipboard_read(void) {
  if (!X.dpy) return;
  end_paste(false);
  if (X.clip_text) {  // ours
    nb_linux_clipboard_answer(X.clip_text, strlen(X.clip_text));
    return;
  }
  if (XGetSelectionOwner(X.dpy, X.clipboard) == None) {
    nb_linux_clipboard_answer(NULL, 0);
    return;
  }
  XDeleteProperty(X.dpy, X.win, X.paste_prop);
  XConvertSelection(X.dpy, X.clipboard, X.utf8_string, X.paste_prop, X.win, X.last_time ? X.last_time : CurrentTime);
  X.pasting = true;
  XFlush(X.dpy);
}

// ---- events -----------------------------------------------------------------

static void handle_key(XKeyEvent *k, bool pressed) {
  nb_event e = {.type = pressed ? NB_EV_KEY_DOWN : NB_EV_KEY_UP, .mods = mods_of(k->state)};
  uint8_t bit = 1u << (k->keycode & 7);
  uint8_t *slot = &X.keys_down[(k->keycode >> 3) & 31];
  KeySym sym = NoSymbol;

  if (pressed) {
    e.repeat = k->keycode && (*slot & bit);
    if (k->keycode) *slot |= bit;
    int n;
    if (X.ic) {
      Status status;
      n = Xutf8LookupString(X.ic, k, e.text, sizeof e.text - 1, &sym, &status);
      if (status != XLookupChars && status != XLookupBoth) n = 0;
      if (status == XLookupChars) sym = NoSymbol;  // committed text from the IM (e.g. "ã")
    } else {
      n = XLookupString(k, e.text, sizeof e.text - 1, &sym, NULL);
    }
    e.text[n > 0 ? n : 0] = 0;
  } else {
    *slot &= (uint8_t)~bit;
    sym = XLookupKeysym(k, 0);
  }
  const char *name = sym != NoSymbol ? XKeysymToString(sym) : NULL;
  snprintf(e.key, sizeof e.key, "%s", name ? name : "");
  nb_push_event(&e);
}

static void handle_event(XEvent *ev) {
  if (XFilterEvent(ev, None)) return;  // consumed by the input method (dead keys...)
  switch (ev->type) {
    case ConfigureNotify:
      if (ev->xconfigure.width != X.phys_w || ev->xconfigure.height != X.phys_h) {
        X.phys_w = ev->xconfigure.width;
        X.phys_h = ev->xconfigure.height;
        emit_configure();
      }
      break;
    case Expose:
      if (ev->xexpose.count == 0) emit_configure();  // ask JS for a fresh frame
      break;
    case MapNotify:
      emit_configure();
      break;
    case ClientMessage:
      if ((Atom)ev->xclient.data.l[0] == X.wm_delete) {
        nb_event e = {.type = NB_EV_CLOSE};
        nb_push_event(&e);
      }
      break;
    case SelectionRequest:
      answer_request(&ev->xselectionrequest);
      break;
    case SelectionClear:
      if (ev->xselectionclear.selection == X.clipboard) {
        free(X.clip_text);
        X.clip_text = NULL;
      }
      break;
    case SelectionNotify:
      selection_notify(&ev->xselection);
      break;
    case PropertyNotify:
      if (X.incr && ev->xproperty.atom == X.paste_prop && ev->xproperty.state == PropertyNewValue) incr_chunk();
      if (ev->xproperty.atom == X.net_wm_state) {
        bool max = read_maximized();
        if (max != X.maximized) {
          X.maximized = max;
          emit_configure();
        }
      }
      break;
    case FocusIn:
    case FocusOut: {
      if (ev->xfocus.mode == NotifyGrab || ev->xfocus.mode == NotifyUngrab) break;
      bool in = ev->type == FocusIn;
      if (X.ic) in ? XSetICFocus(X.ic) : XUnsetICFocus(X.ic);
      if (!in) memset(X.keys_down, 0, sizeof X.keys_down);
      nb_event e = {.type = NB_EV_FOCUS, .focused = in};
      nb_push_event(&e);
      if (in != X.activated) {
        X.activated = in;
        emit_configure();
      }
      break;
    }
    case EnterNotify:
    case MotionNotify: {
      int x = ev->type == MotionNotify ? ev->xmotion.x : ev->xcrossing.x;
      int y = ev->type == MotionNotify ? ev->xmotion.y : ev->xcrossing.y;
      nb_event e = {.type = NB_EV_POINTER_MOVE, .x = (double)x / X.scale, .y = (double)y / X.scale};
      nb_push_event(&e);
      break;
    }
    case LeaveNotify:
      if (ev->xcrossing.mode == NotifyNormal) {
        nb_event e = {.type = NB_EV_POINTER_LEAVE};
        nb_push_event(&e);
      }
      break;
    case ButtonPress:
    case ButtonRelease: {
      XButtonEvent *b = &ev->xbutton;
      if (b->button >= 4 && b->button <= 7) {  // wheel: one notch ~ 15 px, like libinput on Wayland
        if (ev->type == ButtonRelease) break;
        nb_event e = {.type = NB_EV_SCROLL, .x = (double)b->x / X.scale, .y = (double)b->y / X.scale, .mods = mods_of(b->state)};
        if (b->button == 4) e.dy = -15;
        if (b->button == 5) e.dy = 15;
        if (b->button == 6) e.dx = -15;
        if (b->button == 7) e.dx = 15;
        nb_push_event(&e);
        break;
      }
      if (ev->type == ButtonPress) {
        X.last_time = b->time;
        X.root_x = b->x_root;
        X.root_y = b->y_root;
        X.last_button = b->button;
      }
      int button = b->button == Button1 ? 0 : b->button == Button2 ? 1 : b->button == Button3 ? 2 : 3;
      nb_event e = {.type = ev->type == ButtonPress ? NB_EV_POINTER_DOWN : NB_EV_POINTER_UP,
                    .x = (double)b->x / X.scale, .y = (double)b->y / X.scale, .button = button};
      nb_push_event(&e);
      break;
    }
    case KeyPress:
    case KeyRelease:
      if (ev->type == KeyPress) X.last_time = ev->xkey.time;
      handle_key(&ev->xkey, ev->type == KeyPress);
      break;
  }
}

static void x_flush(void) {
  if (!X.dpy) return;
  while (XPending(X.dpy)) {
    XEvent ev;
    XNextEvent(X.dpy, &ev);
    handle_event(&ev);
  }
  XFlush(X.dpy);
}

// ---- setup ------------------------------------------------------------------

/** Picks an EGL config; prefers one backed by a 32-bit ARGB visual when a compositor runs. */
static bool choose_config(EGLConfig *out, XVisualInfo *visual) {
  EGLint attrs[] = {EGL_SURFACE_TYPE, EGL_WINDOW_BIT, EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8,
                    EGL_ALPHA_SIZE, 8, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT, EGL_NONE};
  EGLConfig configs[64];
  EGLint n = 0;
  if (!eglChooseConfig(X.egl_display, attrs, configs, 64, &n) || n < 1) return false;

  char cm_name[32];
  snprintf(cm_name, sizeof cm_name, "_NET_WM_CM_S%d", X.screen);
  bool composited = XGetSelectionOwner(X.dpy, XInternAtom(X.dpy, cm_name, False)) != None;

  int fallback = -1;
  for (int i = 0; i < n; i++) {
    EGLint id;
    eglGetConfigAttrib(X.egl_display, configs[i], EGL_NATIVE_VISUAL_ID, &id);
    XVisualInfo tmpl = {.visualid = (VisualID)id};
    int count;
    XVisualInfo *vi = XGetVisualInfo(X.dpy, VisualIDMask, &tmpl, &count);
    if (!vi) continue;
    if (composited && vi->depth == 32) {
      *out = configs[i];
      *visual = *vi;
      X.transparent = true;
      XFree(vi);
      return true;
    }
    if (fallback < 0 && vi->depth == DefaultDepth(X.dpy, X.screen)) {
      fallback = i;
      *visual = *vi;
    }
    XFree(vi);
  }
  if (fallback < 0) return false;
  *out = configs[fallback];
  X.transparent = false;
  return true;
}

static bool x_open(const nb_window_options *o) {
  memset(&X, 0, sizeof X);
  X.frame_fd = -1;
  setlocale(LC_CTYPE, "");
  XSetLocaleModifiers("");
  X.dpy = XOpenDisplay(NULL);
  if (!X.dpy) return false;
  X.screen = DefaultScreen(X.dpy);
  X.root = RootWindow(X.dpy, X.screen);
  X.scale = detect_scale();
  X.refresh_hz = detect_refresh();
  X.phys_w = o->width * X.scale;
  X.phys_h = o->height * X.scale;
  X.activated = true;

  X.wm_protocols = XInternAtom(X.dpy, "WM_PROTOCOLS", False);
  X.wm_delete = XInternAtom(X.dpy, "WM_DELETE_WINDOW", False);
  X.net_wm_name = XInternAtom(X.dpy, "_NET_WM_NAME", False);
  X.utf8_string = XInternAtom(X.dpy, "UTF8_STRING", False);
  X.net_wm_state = XInternAtom(X.dpy, "_NET_WM_STATE", False);
  X.net_wm_state_max_v = XInternAtom(X.dpy, "_NET_WM_STATE_MAXIMIZED_VERT", False);
  X.net_wm_state_max_h = XInternAtom(X.dpy, "_NET_WM_STATE_MAXIMIZED_HORZ", False);
  X.net_wm_moveresize = XInternAtom(X.dpy, "_NET_WM_MOVERESIZE", False);
  X.net_wm_icon = XInternAtom(X.dpy, "_NET_WM_ICON", False);
  X.motif_hints = XInternAtom(X.dpy, "_MOTIF_WM_HINTS", False);
  X.clipboard = XInternAtom(X.dpy, "CLIPBOARD", False);
  X.targets = XInternAtom(X.dpy, "TARGETS", False);
  X.incr_atom = XInternAtom(X.dpy, "INCR", False);
  X.text_atom = XInternAtom(X.dpy, "TEXT", False);
  X.paste_prop = XInternAtom(X.dpy, "NB_CLIPBOARD", False);

  X.egl_display = eglGetPlatformDisplay(EGL_PLATFORM_X11_KHR, X.dpy, NULL);
  if (X.egl_display == EGL_NO_DISPLAY || !eglInitialize(X.egl_display, NULL, NULL)) return false;
  eglBindAPI(EGL_OPENGL_ES_API);
  EGLConfig config;
  XVisualInfo visual;
  if (!choose_config(&config, &visual)) return false;

  X.colormap = XCreateColormap(X.dpy, X.root, visual.visual, AllocNone);
  long events = ExposureMask | StructureNotifyMask | PointerMotionMask | ButtonPressMask | ButtonReleaseMask |
                KeyPressMask | KeyReleaseMask | FocusChangeMask | EnterWindowMask | LeaveWindowMask |
                PropertyChangeMask;
  XSetWindowAttributes attrs = {.colormap = X.colormap, .border_pixel = 0, .background_pixel = 0, .event_mask = events};
  X.win = XCreateWindow(X.dpy, X.root, 0, 0, X.phys_w, X.phys_h, 0, visual.depth, InputOutput, visual.visual,
                        CWColormap | CWBorderPixel | CWBackPixel | CWEventMask, &attrs);
  if (!X.win) return false;

  XSetWMProtocols(X.dpy, X.win, &X.wm_delete, 1);
  XClassHint class_hint = {.res_name = (char *)o->app_id, .res_class = (char *)o->app_id};
  XSetClassHint(X.dpy, X.win, &class_hint);
  XSizeHints size_hints = {.flags = PMinSize, .min_width = 240 * X.scale, .min_height = 160 * X.scale};
  XSetWMNormalHints(X.dpy, X.win, &size_hints);
  long motif[5] = {2 /* MWM_HINTS_DECORATIONS */, 0, 0 /* no WM decorations: we draw our own */, 0, 0};
  XChangeProperty(X.dpy, X.win, X.motif_hints, X.motif_hints, 32, PropModeReplace, (unsigned char *)motif, 5);
  XStoreName(X.dpy, X.win, o->title);
  XChangeProperty(X.dpy, X.win, X.net_wm_name, X.utf8_string, 8, PropModeReplace, (const unsigned char *)o->title,
                  (int)strlen(o->title));

  // Input method: dead keys and compose sequences arrive as committed UTF-8.
  X.im = XOpenIM(X.dpy, NULL, NULL, NULL);
  if (X.im) {
    X.ic = XCreateIC(X.im, XNInputStyle, XIMPreeditNothing | XIMStatusNothing, XNClientWindow, X.win, XNFocusWindow,
                     X.win, NULL);
    long im_events = 0;
    if (X.ic && !XGetICValues(X.ic, XNFilterEvents, &im_events, NULL)) XSelectInput(X.dpy, X.win, events | im_events);
  }
  XkbSetDetectableAutoRepeat(X.dpy, True, NULL);

  EGLint ctx_attrs[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
  X.egl_context = eglCreateContext(X.egl_display, config, EGL_NO_CONTEXT, ctx_attrs);
  if (X.egl_context == EGL_NO_CONTEXT) return false;
  X.egl_surface = eglCreatePlatformWindowSurface(X.egl_display, config, &X.win, NULL);
  if (X.egl_surface == EGL_NO_SURFACE) return false;
  if (!eglMakeCurrent(X.egl_display, X.egl_surface, X.egl_surface, X.egl_context)) return false;
  eglSwapInterval(X.egl_display, 0);  // paced by our frame timer; never block the JS thread

  X.frame_fd = timerfd_create(CLOCK_MONOTONIC, TFD_NONBLOCK | TFD_CLOEXEC);
  snprintf(X.cursor_name, sizeof X.cursor_name, "default");
  XMapWindow(X.dpy, X.win);
  XFlush(X.dpy);
  emit_configure();
  if (getenv("NB_DEBUG"))
    fprintf(stderr, "nodebuilder: x11 scale %d, %d Hz, %s visual\n", X.scale, X.refresh_hz,
            X.transparent ? "ARGB" : "opaque");
  return true;
}

static void x_close(void) {
  end_paste(false);
  free(X.clip_text);
  if (X.egl_display) {
    eglMakeCurrent(X.egl_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    if (X.egl_surface) eglDestroySurface(X.egl_display, X.egl_surface);
    if (X.egl_context) eglDestroyContext(X.egl_display, X.egl_context);
    eglTerminate(X.egl_display);
  }
  if (X.ic) XDestroyIC(X.ic);
  if (X.im) XCloseIM(X.im);
  if (X.dpy) {
    if (X.cursor) XFreeCursor(X.dpy, X.cursor);
    if (X.win) XDestroyWindow(X.dpy, X.win);
    if (X.colormap) XFreeColormap(X.dpy, X.colormap);
    XCloseDisplay(X.dpy);
  }
  if (X.frame_fd >= 0) close(X.frame_fd);
  memset(&X, 0, sizeof X);
  X.frame_fd = -1;
}

// ---- frames / window ops ----------------------------------------------------

static void x_begin_frame(int *bw, int *bh, int *scale) {
  eglMakeCurrent(X.egl_display, X.egl_surface, X.egl_surface, X.egl_context);
  *bw = X.phys_w;
  *bh = X.phys_h;
  *scale = X.scale;
}

static void x_end_frame(void) {
  eglSwapBuffers(X.egl_display, X.egl_surface);
  arm_frame_timer();
}

static void x_request_frame(void) { arm_frame_timer(); }
static int x_scale(void) { return X.scale ? X.scale : 1; }

static void x_set_cursor(const char *name) {
  if (!X.dpy || !strcmp(name, X.cursor_name)) return;
  snprintf(X.cursor_name, sizeof X.cursor_name, "%s", name);
  static const char *aliases[][2] = {
      {"default", "left_ptr"}, {"pointer", "hand2"}, {"text", "xterm"},
      {"n-resize", "top_side"}, {"s-resize", "bottom_side"}, {"e-resize", "right_side"}, {"w-resize", "left_side"},
      {"ne-resize", "top_right_corner"}, {"nw-resize", "top_left_corner"},
      {"se-resize", "bottom_right_corner"}, {"sw-resize", "bottom_left_corner"},
  };
  Cursor c = XcursorLibraryLoadCursor(X.dpy, name);
  for (size_t i = 0; !c && i < sizeof aliases / sizeof aliases[0]; i++)
    if (!strcmp(aliases[i][0], name)) c = XcursorLibraryLoadCursor(X.dpy, aliases[i][1]);
  if (!c) c = XcursorLibraryLoadCursor(X.dpy, "left_ptr");
  XDefineCursor(X.dpy, X.win, c);
  if (X.cursor) XFreeCursor(X.dpy, X.cursor);
  X.cursor = c;
  XFlush(X.dpy);
}

static void x_set_title(const char *title) {
  if (!X.dpy) return;
  XStoreName(X.dpy, X.win, title);
  XChangeProperty(X.dpy, X.win, X.net_wm_name, X.utf8_string, 8, PropModeReplace, (const unsigned char *)title,
                  (int)strlen(title));
  XFlush(X.dpy);
}

// _NET_WM_ICON: width, height, then ARGB pixels (straight alpha), one entry per size. Format
// 32 properties are arrays of `long` in Xlib, whatever its width.
static void x_set_icon(const nb_icon_image *images, int count) {
  if (!X.dpy) return;
  size_t n = 0;
  for (int i = 0; i < count; i++) n += 2 + (size_t)images[i].size * images[i].size;
  unsigned long *data = malloc(n * sizeof *data);
  if (!data) return;
  unsigned long *p = data;
  for (int i = 0; i < count; i++) {
    int size = images[i].size;
    *p++ = size;
    *p++ = size;
    for (const uint8_t *px = images[i].rgba, *end = px + (size_t)size * size * 4; px < end; px += 4)
      *p++ = (unsigned long)px[3] << 24 | px[0] << 16 | px[1] << 8 | px[2];
  }
  XChangeProperty(X.dpy, X.win, X.net_wm_icon, XA_CARDINAL, 32, PropModeReplace, (const unsigned char *)data, (int)n);
  free(data);
  XFlush(X.dpy);
}

static void moveresize(int direction) {
  XUngrabPointer(X.dpy, CurrentTime);
  send_wm_message(X.net_wm_moveresize, X.root_x, X.root_y, direction, X.last_button ? X.last_button : 1, 1);
}

static void x_move(void) { if (X.dpy) moveresize(MR_MOVE); }

static void x_resize(uint32_t edges) {
  if (!X.dpy) return;
  int dir;
  switch (edges) {
    case NB_EDGE_TOP: dir = MR_TOP; break;
    case NB_EDGE_BOTTOM: dir = MR_BOTTOM; break;
    case NB_EDGE_LEFT: dir = MR_LEFT; break;
    case NB_EDGE_RIGHT: dir = MR_RIGHT; break;
    case NB_EDGE_TOP | NB_EDGE_LEFT: dir = MR_TOPLEFT; break;
    case NB_EDGE_TOP | NB_EDGE_RIGHT: dir = MR_TOPRIGHT; break;
    case NB_EDGE_BOTTOM | NB_EDGE_LEFT: dir = MR_BOTTOMLEFT; break;
    case NB_EDGE_BOTTOM | NB_EDGE_RIGHT: dir = MR_BOTTOMRIGHT; break;
    default: return;
  }
  moveresize(dir);
}

static void x_set_maximized(bool maximized) {
  if (X.dpy) send_wm_message(X.net_wm_state, maximized ? 1 : 0, X.net_wm_state_max_v, X.net_wm_state_max_h, 1, 0);
}

static void x_minimize(void) {
  if (!X.dpy) return;
  XIconifyWindow(X.dpy, X.win, X.screen);
  XFlush(X.dpy);
}

// ---- pump -------------------------------------------------------------------

static int x_fds(struct pollfd *out, int max) {
  out[0] = (struct pollfd){.fd = ConnectionNumber(X.dpy), .events = POLLIN};
  out[1] = (struct pollfd){.fd = X.frame_fd, .events = POLLIN};
  return 2;
}

static int x_process(const struct pollfd *ready, int count) {
  for (int i = 0; i < count; i++) {
    uint64_t expirations;
    if (ready[i].fd == X.frame_fd && read(X.frame_fd, &expirations, sizeof expirations) == sizeof expirations) {
      X.frame_armed = false;
      nb_event e = {.type = NB_EV_FRAME};
      nb_push_event(&e);
    }
  }
  x_flush();  // reads whatever the display socket has (never blocks)
  return 0;
}

// The window's path, without the window: dead keys go through XIM (x_open), which needs the
// locale's X11 data.
static bool x_probe(nb_display_probe *out) {
  setlocale(LC_CTYPE, "");
  XSetLocaleModifiers("");
  Display *dpy = XOpenDisplay(NULL);
  if (!dpy) {
    const char *name = getenv("DISPLAY");
    snprintf(out->error, sizeof out->error, "cannot open the X11 display (%s)", name && *name ? name : "DISPLAY unset");
    return false;
  }
  snprintf(out->locale, sizeof out->locale, "%s", nb_linux_locale());
  XIM im = XSupportsLocale() ? XOpenIM(dpy, NULL, NULL, NULL) : NULL;
  out->compose = im != NULL;
  if (im) XCloseIM(im);
  XCloseDisplay(dpy);
  return true;
}

const nb_linux_backend nb_x11_backend = {
    .name = "x11",
    .open = x_open,
    .close = x_close,
    .begin_frame = x_begin_frame,
    .end_frame = x_end_frame,
    .request_frame = x_request_frame,
    .scale = x_scale,
    .set_cursor = x_set_cursor,
    .set_title = x_set_title,
    .set_icon = x_set_icon,
    .move = x_move,
    .resize = x_resize,
    .set_maximized = x_set_maximized,
    .minimize = x_minimize,
    .clipboard_write = x_clipboard_write,
    .clipboard_read = x_clipboard_read,
    .fds = x_fds,
    .process = x_process,
    .flush = x_flush,
    .probe = x_probe,
};
