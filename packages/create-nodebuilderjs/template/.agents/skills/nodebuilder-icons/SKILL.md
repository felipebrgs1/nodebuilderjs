---
name: nodebuilder-icons
description: Icons and SVG in nodebuilder with the Icon widget, using Lucide (lucide-static or lucide) and Phosphor (@phosphor-icons/core). Use when adding icons to buttons, menus, sidebars or lists, when choosing an icon library, or when showing any .svg file.
---

# Icons

```sh
bun add lucide-static              # Lucide .svg files
bun add lucide                     # or: the same icons as data (import { Camera } from "lucide")
bun add @phosphor-icons/core       # Phosphor: assets/<weight>/<name>.svg
```

```tsx
import { Button, Column, Icon, Row, Text, createSignal, theme } from "@nodebuilderjs/core";
import camera from "lucide-static/icons/camera.svg" with { type: "text" };
import heart from "@phosphor-icons/core/assets/duotone/heart-duotone.svg" with { type: "text" };
import { Heart, Play, Star } from "lucide";
import starFill from "@phosphor-icons/core/assets/fill/star-fill.svg" with { type: "text" };

const [active] = createSignal(false);
const [liked, setLiked] = createSignal(false);

<Column gap={8}>
  <Icon svg={camera} />                                {/* 20 px, color of the surrounding text */}
  <Icon svg={heart} size={32} color="#e01b24" />
  <Icon svg={Star} size={16} strokeWidth={1.5} />      {/* stroke width (outline icons) */}
  <Button variant="primary"><Icon svg={Star} size={16} /><Text>Favorite</Text></Button>
  <Icon svg={Play} fill />                             {/* solid Lucide icon (icon color) */}
  <Icon svg={Heart} fill={() => liked() && "#e01b24"} onClick={() => setLiked(!liked())} />
  <Icon svg={starFill} />                              {/* Phosphor ships solid icons as "fill" */}
  <Row color={() => (active() ? theme.accent.base : theme.text.secondary)}>
    <Icon svg={camera} /><Text>Camera</Text>            {/* icon and text change color together */}
  </Row>
</Column>
```

## Rules

- **Never** use `lucide-react`, `lucide-solid`, `@phosphor-icons/react`, `react-icons` or
  `@heroicons/react`: they require React/DOM. Use the packages above.
- Import `.svg` files with `with { type: "text" }` (the import becomes the SVG text and
  `nodebuilder package` embeds it). `with { type: "file" }` (path) also works.
- `svg` accepts: SVG text, a path to a `.svg`, or data from the `lucide` package. It can be
  a function (`svg={() => (open() ? chevronUp : chevronDown)}`).
- `size` is the height in logical px (default 20, `theme.icon.size`); the width follows the
  `viewBox`. The color comes from `color` on the `Icon` itself or is inherited from a parent, as with `Text`.
- Solid icons: Lucide is outline only; `fill` (`true` = the icon's color, or a color) makes
  it solid, like Lucide's own `fill` prop: it replaces the root `<svg>`'s `fill="none"`, so the
  shapes get filled and keep their stroke. A fill a shape or group sets itself (`none`
  included) still wins. It can be a function. **Never** patch the SVG text
  (`svg.replace('fill="none"', ...)`). Phosphor has ready-made solid icons in the `fill` weight.
- Changing the color is free (single-color icons are tinted on the GPU); changing the size
  rasterizes again (~0.5 ms). They stay sharp on HiDPI screens.
- Phosphor weights: `thin`, `light`, `regular`, `bold`, `fill`, `duotone` (folders in
  `assets/`; names carry the weight suffix, except `regular`: `heart.svg`, `heart-fill.svg`).

## SVG limits

Supported: `path` (with arcs and curves), `rect`, `circle`, `ellipse`, `line`, `polyline`,
`polygon`, `g`, `transform`, `fill`/`stroke` (colors, `currentColor`), stroke width, caps,
joins, `fill-rule`, opacities and inline `style=""`.
Not supported (the rest of the drawing still shows): gradients, patterns, text, filters, masks,
clip paths, `<use>`, dashes and `<style>`. For logos and illustrations like that: export a 2x PNG and
use `Image`.
