// Offscreen rendering for screenshots (nb_platform_offscreen_*): an EGL context that needs
// no display server, so it works with WAYLAND_DISPLAY and DISPLAY unset (CI, containers,
// agents). Mesa's surfaceless platform first, then the first EGL device (EGL_EXT_platform_device,
// e.g. NVIDIA). The target is a texture-backed framebuffer object: GLES2 guarantees RGBA8
// textures as color attachments, while RGBA8 renderbuffers need an extension.
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "nb.h"

static struct {
  EGLDisplay display;
  EGLContext context;
  EGLSurface pbuffer;  // only when EGL_KHR_surfaceless_context is missing
  GLuint fbo, texture;
  int w, h;
} O;

static bool has_extension(const char *list, const char *name) {
  size_t n = strlen(name);
  for (const char *p = list; p && (p = strstr(p, name)); p += n)
    if ((p == list || p[-1] == ' ') && (p[n] == ' ' || p[n] == 0)) return true;
  return false;
}

static EGLDisplay initialized(EGLDisplay d) {
  if (d != EGL_NO_DISPLAY && eglInitialize(d, NULL, NULL)) return d;
  return EGL_NO_DISPLAY;
}

static EGLDisplay open_display(void) {
  const char *client = eglQueryString(EGL_NO_DISPLAY, EGL_EXTENSIONS);
  EGLDisplay d = EGL_NO_DISPLAY;
  if (has_extension(client, "EGL_MESA_platform_surfaceless"))
    d = initialized(eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL));
  if (d == EGL_NO_DISPLAY && has_extension(client, "EGL_EXT_platform_device")) {
    PFNEGLQUERYDEVICESEXTPROC query_devices = (PFNEGLQUERYDEVICESEXTPROC)eglGetProcAddress("eglQueryDevicesEXT");
    EGLDeviceEXT devices[8];
    EGLint count = 0;
    if (query_devices && query_devices(8, devices, &count))
      for (EGLint i = 0; i < count && d == EGL_NO_DISPLAY; i++)
        d = initialized(eglGetPlatformDisplay(EGL_PLATFORM_DEVICE_EXT, devices[i], NULL));
  }
  return d;
}

void nb_platform_offscreen_close(void) {
  if (O.display != EGL_NO_DISPLAY && O.display) {
    if (O.context) {
      eglMakeCurrent(O.display, O.pbuffer ? O.pbuffer : EGL_NO_SURFACE, O.pbuffer ? O.pbuffer : EGL_NO_SURFACE, O.context);
      if (O.fbo) glDeleteFramebuffers(1, &O.fbo);
      if (O.texture) glDeleteTextures(1, &O.texture);
    }
    eglMakeCurrent(O.display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    if (O.pbuffer) eglDestroySurface(O.display, O.pbuffer);
    if (O.context) eglDestroyContext(O.display, O.context);
    eglTerminate(O.display);
  }
  memset(&O, 0, sizeof O);
}

static bool fail(char *error, size_t size, const char *what) {
  snprintf(error, size, "%s (EGL error 0x%x)", what, eglGetError());
  nb_platform_offscreen_close();
  return false;
}

static bool open_context(char *error, size_t size) {
  O.display = open_display();
  if (O.display == EGL_NO_DISPLAY) {
    O.display = NULL;
    return fail(error, size, "no EGL display without a window (needs Mesa's surfaceless platform or an EGL device)");
  }
  if (!eglBindAPI(EGL_OPENGL_ES_API)) return fail(error, size, "EGL has no OpenGL ES");
  bool surfaceless = has_extension(eglQueryString(O.display, EGL_EXTENSIONS), "EGL_KHR_surfaceless_context");
  EGLint attrs[] = {EGL_SURFACE_TYPE, surfaceless ? 0 : EGL_PBUFFER_BIT, EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8,
                    EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT, EGL_NONE};
  EGLConfig config;
  EGLint n = 0;
  if (!eglChooseConfig(O.display, attrs, &config, 1, &n) || n < 1) return fail(error, size, "no GLES2 EGL config");
  EGLint ctx_attrs[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
  O.context = eglCreateContext(O.display, config, EGL_NO_CONTEXT, ctx_attrs);
  if (O.context == EGL_NO_CONTEXT) {
    O.context = NULL;
    return fail(error, size, "could not create a GLES2 context");
  }
  if (!surfaceless) {
    EGLint pb_attrs[] = {EGL_WIDTH, 1, EGL_HEIGHT, 1, EGL_NONE};
    O.pbuffer = eglCreatePbufferSurface(O.display, config, pb_attrs);
    if (O.pbuffer == EGL_NO_SURFACE) {
      O.pbuffer = NULL;
      return fail(error, size, "could not create a pbuffer surface");
    }
  }
  EGLSurface s = O.pbuffer ? O.pbuffer : EGL_NO_SURFACE;
  if (!eglMakeCurrent(O.display, s, s, O.context)) return fail(error, size, "could not make the context current");
  if (getenv("NB_DEBUG"))
    fprintf(stderr, "nodebuilder: offscreen %s, GL renderer %s\n", surfaceless ? "surfaceless" : "pbuffer", glGetString(GL_RENDERER));
  glGenFramebuffers(1, &O.fbo);
  glGenTextures(1, &O.texture);
  return true;
}

bool nb_platform_offscreen_begin(int w, int h, char *error, size_t size) {
  if (!O.context && !open_context(error, size)) return false;
  EGLSurface s = O.pbuffer ? O.pbuffer : EGL_NO_SURFACE;
  if (!eglMakeCurrent(O.display, s, s, O.context)) return fail(error, size, "could not make the context current");
  if (w != O.w || h != O.h) {
    GLint max = 0;
    glGetIntegerv(GL_MAX_TEXTURE_SIZE, &max);
    if (w < 1 || h < 1 || w > max || h > max) {
      snprintf(error, size, "size %dx%d is outside the GPU limits (1..%d)", w, h, max);
      return false;
    }
    glBindTexture(GL_TEXTURE_2D, O.texture);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    glBindFramebuffer(GL_FRAMEBUFFER, O.fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, O.texture, 0);
    GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    if (status != GL_FRAMEBUFFER_COMPLETE) {
      O.w = O.h = 0;
      snprintf(error, size, "offscreen framebuffer incomplete (0x%x)", status);
      return false;
    }
    O.w = w;
    O.h = h;
  }
  glBindFramebuffer(GL_FRAMEBUFFER, O.fbo);
  return true;
}
