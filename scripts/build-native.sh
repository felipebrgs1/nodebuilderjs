#!/usr/bin/env sh
# Builds native/build/nodebuilder.node with the system C compiler.
# Needs: wayland-client/egl/cursor, EGL, GLESv2, xkbcommon, freetype2, harfbuzz, fontconfig.
set -eu
cd "$(dirname "$0")/.."

# Node-API headers come from the `node-api-headers` dev dependency, so neither
# Node nor node-gyp is needed to build (the addon loads in Bun and Node).
NAPI_INCLUDE=${NAPI_INCLUDE:-node_modules/node-api-headers/include}
if [ ! -f "$NAPI_INCLUDE/node_api.h" ]; then
  echo "Node-API headers not found in $NAPI_INCLUDE; run 'bun install' first." >&2
  exit 1
fi

PKGS="wayland-client wayland-egl wayland-cursor egl glesv2 xkbcommon freetype2 harfbuzz fontconfig"
GEN=native/build/gen
mkdir -p "$GEN"
wayland-scanner client-header native/protocols/xdg-shell.xml "$GEN/xdg-shell-client-protocol.h"
wayland-scanner private-code native/protocols/xdg-shell.xml "$GEN/xdg-shell-protocol.c"

${CC:-cc} -O2 -g -std=gnu11 -fPIC -shared -pthread -Wall -Wno-unused-parameter \
  -I"$NAPI_INCLUDE" -I"$GEN" $(pkg-config --cflags $PKGS) \
  native/src/addon.c native/src/window.c native/src/render.c native/src/text.c "$GEN/xdg-shell-protocol.c" \
  $(pkg-config --libs $PKGS) -lm \
  -o native/build/nodebuilder.node

echo "built native/build/nodebuilder.node"
