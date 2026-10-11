# Builds the native addon against an old glibc (2.35) so packaged apps run on
# Ubuntu 22.04+, Debian 12+, Fedora 36+, RHEL 9+. Used by cli/package.ts (--native docker).
FROM ubuntu:22.04
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    gcc libc6-dev pkg-config libwayland-dev libwayland-bin libegl-dev libgles-dev libxkbcommon-dev \
    libfreetype-dev libharfbuzz-dev libfontconfig-dev libx11-dev libxcursor-dev libxrandr-dev \
 && rm -rf /var/lib/apt/lists/*
