---
name: nodebuilder-drawing
description: Freeform drawing in nodebuilder with the Canvas widget (lines, polygons, arcs, gauges, sparklines, annotations, custom visualizations). Use for non-rectangular shapes and charts that @nodebuilderjs/core/charts does not cover, instead of the browser <canvas> or D3. For regular line, area, bar and pie charts, use the nodebuilder-charts skill.
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
| `line(x0, y0, x1, y1, color, width = 1, cap = "round")` | segment; cap `round`, `butt` (flat) or `square` |
| `polyline(points, color, width = 1, { cap, closed })` | line through several points `[x0, y0, x1, y1, ...]`, round joins |
| `polygon(points, color)` | filled polygon (concave is fine; self-intersecting is not drawn) |
| `circle(cx, cy, radius, color)` | disc |
| `arc(cx, cy, outerRadius, innerRadius, start, sweep, color)` | slice (inner 0) or ring; radians, 0 = top, clockwise |
| `text(text, x, y, color, size?, bold?)`, `measureText(text, size?)` | labels; `y` is the top of the line |

## Rules

- Give the canvas a size: `width`/`height` or `grow`. Without a size, `draw` does not run.
- Local coordinates, with `y` pointing down. Flip it for charts: `g.height - value * scale`.
- `draw` must only draw: do not create signals or effects or call `set` inside it.
- The canvas redraws when a signal read in `draw` changes or its size changes; the geometry
  is recorded, so other parts of the window redrawing cost nothing here.
- Live data: update the signal with `requestAnimationFrame`; thousands of points
  work (5000 line + area points at ~120 fps).
- Pie/donut: accumulate the slices in radians (`fraction * 2 * Math.PI`); a small gap
  (`- 0.03` on the sweep) separates the slices visually.
- Translucent colors on `polyline` darken at the joins: prefer opaque colors for lines
  and translucent ones for areas.
- Interaction (tooltip, clicking a point, dragging): use `onPointerMove`/`onClick` on the
  `Canvas` itself; `e.localX`/`e.localY` are in the same coordinates as the drawing (the `padding`
  offsets them: subtract it).
