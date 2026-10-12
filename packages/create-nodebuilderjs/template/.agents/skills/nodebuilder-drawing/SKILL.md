---
name: nodebuilder-drawing
description: Freeform drawing in nodebuilder with the Canvas widget (lines, dashed lines, gradient fills, polygons, arcs, gauges, sparklines, annotations, labels cut to a width with an ellipsis, custom visualizations); the draw function is reactive. Use for non-rectangular shapes and charts that @nodebuilderjs/core/charts does not cover, instead of the browser <canvas> or D3. For regular line, area, bar and pie charts, use the nodebuilder-charts skill.
---

# Drawing with `<Canvas>`

```tsx
import { Canvas, createSignal, theme } from "@nodebuilderjs/core";

const [data, setData] = createSignal([12, 40, 33, 70, 55, 90]);

<Canvas height={160} draw={(g) => {
  const v = data();                                       // signals read here redraw the canvas
  const x = (i: number) => (i / (v.length - 1)) * g.width;
  const y = (n: number) => g.height - (n / 100) * g.height;
  for (let n = 0; n <= 100; n += 25) g.line(0, y(n), g.width, y(n), "#0000001a", 1, "butt");  // grid
  const pts = v.flatMap((n, i) => [x(i), y(n)]);
  g.polygon([0, g.height, ...pts, g.width, g.height], "#3584e433");   // area
  g.polyline(pts, theme.accent.base, 2);                              // line
  g.circle(x(v.length - 1), y(v[v.length - 1]!), 4, theme.accent.base);
  g.text("max 100", 4, 0, theme.text.secondary, 11);
}} />
```

## API (`g`)

| Method | What |
|---|---|
| `g.width`, `g.height` | canvas size (inside the `padding`) |
| `rect(x, y, w, h, color, radius?)` | rectangle (bars) |
| `line(x0, y0, x1, y1, color, width = 1, cap = "round", dash?)` | segment; cap `round`, `butt` (flat) or `square`; `dash` like `[4, 3]` (dash, gap...) |
| `polyline(points, color, width = 1, { cap, closed, dash })` | line through several points `[x0, y0, x1, y1, ...]`, round joins |
| `polygon(points, color)` | filled polygon (concave is fine; self-intersecting is not drawn) |
| `circle(cx, cy, radius, color)` | disc |
| `arc(cx, cy, outerRadius, innerRadius, start, sweep, color)` | slice (inner 0) or ring; radians, 0 = top, clockwise |
| `text(text, x, y, color, size?, bold?, { maxWidth, ellipsis })` | one line of text; `y` is the top of the line. With `maxWidth`, text that does not fit is cut and ends in "…" (`ellipsis: false` just cuts; nothing is drawn if not even "…" fits). No wrapping |
| `measureText(text, size?, bold?)` | `{ width, height }` of that text, to align it |
| `linearGradient(x0, y0, x1, y1, stops)` | a gradient usable in place of `color` in `rect`, `line`, `polyline`, `polygon`, `circle`, `arc` (not `text`): offset 0 at `(x0, y0)`, 1 at `(x1, y1)`, end colors beyond; stops are colors or `[color, offset]` |

Gradient area under a line (fades out toward the bottom):

```tsx
import { Canvas, createSignal, mixColor, theme } from "@nodebuilderjs/core";

const [points] = createSignal([0, 120, 80, 40, 160, 90, 240, 20]);
<Canvas height={160} draw={(g) => {
  const pts = points();
  const fade = g.linearGradient(0, 0, 0, g.height, [mixColor(theme.accent.base, "transparent", 0.6), "transparent"]);
  g.polygon([pts[0]!, g.height, ...pts, pts[pts.length - 2]!, g.height], fade);
  g.polyline(pts, theme.accent.base, 2);
}} />;
```

Sizes default to the theme's font size (14). Text that must fit a width:

```tsx
import { Canvas, createSignal, theme } from "@nodebuilderjs/core";

const [title] = createSignal("A very long track title that does not fit");
<Canvas width={180} height={40} draw={(g) => {
  const { height } = g.measureText(title(), 13);
  g.text(title(), 4, (g.height - height) / 2, theme.text.primary, 13, false, { maxWidth: g.width - 8 }); // "A very long track…", centered vertically
  g.line(0, g.height - 1, g.width, g.height - 1, theme.divider, 1, "butt", [4, 3]); // dashed
}} />;
```

For wrapping paragraphs, a `<Text>` next to the canvas (or over it: an absolute sibling in a
`Box`, declared after the `Canvas`) is simpler than drawing text.

## Rules

- Give the canvas a size: `width`/`height` or `grow`. Without a size, `draw` does not run.
- Local coordinates, with `y` pointing down. Flip it for charts: `g.height - value * scale`.
- `draw` must only draw: do not create signals or effects or call `set` inside it.
- `draw` is **reactive**: it runs inside an effect, so every signal it reads (the data, a
  hovered index, `theme.*` colors) is tracked, and changing one redraws the canvas, once per
  change. It also redraws when its size changes. Do not wrap it in `createEffect` and do not
  read the data outside `draw` (that reads it once). The geometry is recorded, so other parts
  of the window redrawing cost nothing here.
- Live data: update the signal with `requestAnimationFrame`; thousands of points
  work (5000 line + area points at ~120 fps).
- Pie/donut: accumulate the slices in radians (`fraction * 2 * Math.PI`); a small gap
  (`- 0.03` on the sweep) separates the slices visually.
- Translucent colors on `polyline` darken at the joins: prefer opaque colors for lines
  and translucent ones for areas.
- Interaction (tooltip, clicking a point, dragging): use `onPointerMove`/`onClick` on the
  `Canvas` itself; `e.localX`/`e.localY` are in the same coordinates as the drawing (the `padding`
  offsets them: subtract it).
