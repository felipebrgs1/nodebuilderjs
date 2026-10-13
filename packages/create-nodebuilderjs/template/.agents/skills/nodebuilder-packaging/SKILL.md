---
name: nodebuilder-packaging
description: Build and distribute the nodebuilder app (AppImage, .deb, .rpm, .tar.gz) with nodebuilder package, bundle files (images, data) into the executable and configure name, icon and app id. Use when preparing a release to install, when changing the app's name/icon, or when the packaged app behaves differently from bun run dev.
---

# Packaging

```sh
bun run package        # = nodebuilder package src/main.tsx --title "..." --app-id ...
bunx nodebuilder package src/main.tsx --targets deb,rpm --icon assets/icon.svg --version 1.2.0
bunx nodebuilder package --help
```

Produces in `dist/` a single executable (Bun + app + native core, ~31 MB compressed) inside
an AppImage, `.deb`, `.rpm` and `.tar.gz`, with a menu entry and icon. Runs on distros with glibc
2.34+ (Ubuntu 22.04+, Debian 12+, Fedora, RHEL 9+).

## Rules

- **App files** (images, fonts, JSON, sounds) are bundled into the executable only if imported with
  `with { type: "file" }` (the import becomes the path). `readFileSync("./data.json")` with a
  loose path works in dev and **fails in the package**. For JSON, `import data from
  "./data.json"` also bundles it.
- The `<Window>`'s `appId` must match `--app-id` (the template already does this); otherwise the
  icon and taskbar grouping do not work.
- `--icon`: `.svg` or a 256x256 PNG. `--name` is the executable/package name (lowercase).
- System libraries (Wayland, X11, EGL, FreeType, HarfBuzz, fontconfig) are declared
  dependencies of the packages, never bundled. `libheif` (only for AVIF/HEIC) is
  only suggested.
- User data: save it in `~/.local/share/<app>` (`process.env.XDG_DATA_HOME`), never
  next to the executable (`/usr/bin` is not writable).

## Verify

- Run the generated executable outside the project folder (`cd / && path/to/app`) to catch
  files that only existed on the development disk.
- AppImage: `chmod +x dist/*.AppImage && ./dist/*.AppImage`.
