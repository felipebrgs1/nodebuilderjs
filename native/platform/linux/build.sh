#!/usr/bin/env sh
# Linux platform build (Wayland + X11 backends, chosen at runtime) (called by scripts/build-native.sh with OUT_DIR, CORE_SOURCES,
# CORE_INCLUDE and NAPI_INCLUDE set). System libs only, found through pkg-config.
set -eu
HERE=native/platform/linux
PKGS="wayland-client wayland-egl wayland-cursor x11 xcursor xrandr egl glesv2 xkbcommon freetype2 harfbuzz fontconfig"
GEN="$OUT_DIR/gen"
mkdir -p "$GEN"
wayland-scanner client-header "$HERE/protocols/xdg-shell.xml" "$GEN/xdg-shell-client-protocol.h"
wayland-scanner private-code "$HERE/protocols/xdg-shell.xml" "$GEN/xdg-shell-protocol.c"

${CC:-cc} -O2 -g -std=gnu11 -fPIC -shared -pthread -Wall -Wno-unused-parameter \
  -I"$NAPI_INCLUDE" -I"$CORE_INCLUDE" -I"$HERE" -I"$GEN" $(pkg-config --cflags $PKGS) \
  $CORE_SOURCES "$HERE/linux.c" "$HERE/wayland.c" "$HERE/x11.c" "$HERE/pump.c" "$HERE/fonts.c" "$HERE/codecs.c" "$HERE/offscreen.c" "$GEN/xdg-shell-protocol.c" \
  $(pkg-config --libs $PKGS) -lm -ldl \
  -o "$OUT_DIR/nodebuilder.node"
