// Image formats too big to decode in TypeScript (AVIF, HEIC) go through the system's
// libheif, loaded with dlopen on first use: it is optional at runtime (only these formats
// fail without it) and not needed to build. libheif's API is handles and functions, so
// the few declarations below are stable across its versions (soname libheif.so.1).
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "nb_platform.h"

typedef struct {
  int code;  // heif_error_Ok = 0
  int subcode;
  const char *message;
} heif_error;

enum { HEIF_COLORSPACE_RGB = 1, HEIF_CHROMA_RGB = 10, HEIF_CHROMA_RGBA = 11, HEIF_CHANNEL_INTERLEAVED = 10 };

static struct {
  bool tried, ok;
  heif_error (*init)(void *);
  void *(*context_alloc)(void);
  void (*context_free)(void *);
  heif_error (*read_from_memory)(void *ctx, const void *data, size_t size, const void *options);
  heif_error (*primary_handle)(void *ctx, void **handle);
  void (*handle_release)(void *);
  int (*has_alpha)(void *);
  heif_error (*decode)(void *handle, void **image, int colorspace, int chroma, const void *options);
  int (*image_width)(void *, int channel);
  int (*image_height)(void *, int channel);
  const uint8_t *(*plane)(void *, int channel, int *stride);
  void (*image_release)(void *);
} heif;

static bool load_heif(void) {
  if (heif.tried) return heif.ok;
  heif.tried = true;
  void *lib = dlopen("libheif.so.1", RTLD_NOW | RTLD_LOCAL);
  if (!lib) return false;
#define SYM(field, name) \
  if (!(*(void **)&heif.field = dlsym(lib, name))) return false;
  SYM(context_alloc, "heif_context_alloc");
  SYM(context_free, "heif_context_free");
  SYM(read_from_memory, "heif_context_read_from_memory_without_copy");
  SYM(primary_handle, "heif_context_get_primary_image_handle");
  SYM(handle_release, "heif_image_handle_release");
  SYM(has_alpha, "heif_image_handle_has_alpha_channel");
  SYM(decode, "heif_decode_image");
  SYM(image_width, "heif_image_get_width");
  SYM(image_height, "heif_image_get_height");
  SYM(plane, "heif_image_get_plane_readonly");
  SYM(image_release, "heif_image_release");
#undef SYM
  // Since 1.13 plugins (the AV1/HEVC decoders) are only registered by heif_init.
  *(void **)&heif.init = dlsym(lib, "heif_init");
  if (heif.init && heif.init(NULL).code != 0) return false;
  heif.ok = true;
  return true;
}

bool nb_platform_decode_image(const uint8_t *data, size_t size, int *width, int *height, uint8_t **rgba, char *error,
                              size_t error_size) {
  *rgba = NULL;
  if (!load_heif()) {
    snprintf(error, error_size, "AVIF/HEIC images need libheif (package libheif1 or libheif)");
    return false;
  }
  void *ctx = heif.context_alloc(), *handle = NULL, *image = NULL;
  heif_error err = heif.read_from_memory(ctx, data, size, NULL);
  if (!err.code) err = heif.primary_handle(ctx, &handle);
  bool alpha = handle && heif.has_alpha(handle);
  // Decoding applies the file's rotation/mirroring, like browsers do.
  if (!err.code) err = heif.decode(handle, &image, HEIF_COLORSPACE_RGB, alpha ? HEIF_CHROMA_RGBA : HEIF_CHROMA_RGB, NULL);
  bool ok = !err.code;
  if (ok) {
    int stride = 0;
    const uint8_t *src = heif.plane(image, HEIF_CHANNEL_INTERLEAVED, &stride);
    int w = heif.image_width(image, HEIF_CHANNEL_INTERLEAVED), h = heif.image_height(image, HEIF_CHANNEL_INTERLEAVED);
    uint8_t *out = src && w > 0 && h > 0 ? malloc((size_t)w * h * 4) : NULL;
    if (out) {
      for (int y = 0; y < h; y++) {
        const uint8_t *row = src + (size_t)y * stride;
        uint8_t *dst = out + (size_t)y * w * 4;
        if (alpha) memcpy(dst, row, (size_t)w * 4);
        else
          for (int x = 0; x < w; x++) {
            dst[x * 4] = row[x * 3];
            dst[x * 4 + 1] = row[x * 3 + 1];
            dst[x * 4 + 2] = row[x * 3 + 2];
            dst[x * 4 + 3] = 255;
          }
      }
      *width = w;
      *height = h;
      *rgba = out;
    } else {
      ok = false;
      snprintf(error, error_size, "libheif returned no pixels");
    }
  } else {
    snprintf(error, error_size, "%s", err.message ? err.message : "libheif could not decode the image");
  }
  if (image) heif.image_release(image);
  if (handle) heif.handle_release(handle);
  heif.context_free(ctx);
  return ok;
}
