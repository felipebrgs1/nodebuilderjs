#!/usr/bin/env sh
# Builds the native addon for the current OS into native/build/<platform>-<arch>/.
# <platform>/<arch> use Node/Bun names (process.platform / process.arch) so the
# loader in src/runtime/native.ts can find the right binary. Each OS has its own
# native/platform/<os>/build.sh; this script only picks it and sets common vars.
set -eu
cd "$(dirname "$0")/.."

case "$(uname -s)" in
  Linux) PLATFORM=linux ;;
  *) echo "nodebuilder: $(uname -s) is not supported yet (see native/platform/)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) ARCH=$(uname -m) ;;
esac

# Node-API headers come from the `node-api-headers` dev dependency.
NAPI_INCLUDE=${NAPI_INCLUDE:-node_modules/node-api-headers/include}
if [ ! -f "$NAPI_INCLUDE/node_api.h" ]; then
  echo "Node-API headers not found in $NAPI_INCLUDE; run 'bun install' first." >&2
  exit 1
fi

export NAPI_INCLUDE
export OUT_DIR="native/build/$PLATFORM-$ARCH"
export CORE_SOURCES="native/core/addon.c native/core/text.c native/core/faces.c native/core/render_gles2.c"
export CORE_INCLUDE="native/include"
mkdir -p "$OUT_DIR"
sh "native/platform/$PLATFORM/build.sh"
echo "built $OUT_DIR/nodebuilder.node"
