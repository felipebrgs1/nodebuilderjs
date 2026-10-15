// Pie and donut charts: slices clockwise from the top, sized by value, with optional
// labels outside the slices and a tooltip for the slice under the pointer.

import type { Child } from "../jsx-runtime.js";
import { edges } from "../render/layout.js";
import { createSignal } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { Canvas } from "../widgets/media/canvas.js";
import type { StyleProps } from "../widgets/props.js";
import { Cell, type CellProps, Legend, Pie, type PieProps, Tooltip, type TooltipProps } from "./components.js";
import { legend } from "./cartesian.js";
import { LEGEND_HEIGHT, configs, formatValue, number, palette, radius, tooltipBox, value } from "./shared.js";

export type PieChartProps = StyleProps & { children?: Child };

interface Slice {
  start: number;
  sweep: number;
}

export function PieChart(props: PieChartProps) {
  const { children, ...style } = props;
  const parts = configs(children);
  const pie = parts.find((p) => p.type === Pie)?.props as PieProps | undefined;
  const tooltip = parts.find((p) => p.type === Tooltip)?.props as TooltipProps | undefined;
  const showLegend = parts.some((p) => p.type === Legend);
  const cells = configs(pie?.children).filter((c) => c.type === Cell).map((c) => (c.props as unknown as CellProps).fill);

  // The pointer, in canvas coordinates; draw finds the slice under it (the box follows it).
  const [pointer, setPointer] = createSignal<{ x: number; y: number } | null>(null, {
    equals: (a, b) => a?.x === b?.x && a?.y === b?.y,
  });

  const node = Canvas({
    height: 240,
    ...style,
    draw: (g) => {
      if (!pie) return;
      const rows = pie.data ?? [];
      const values = rows.map((r) => Math.max(0, number(value(r, pie.dataKey)) || 0));
      const total = values.reduce((a, v) => a + v, 0);
      if (!total) return;
      const colors = palette();
      const colorOf = (i: number) => cells[i] ?? colors[i % colors.length]!;
      const nameOf = (i: number) => String(value(rows[i]!, pie.nameKey) ?? i + 1);
      const half = Math.min(g.width, g.height) / 2;
      const outer = radius(pie.outerRadius, half, half * 0.8);
      const inner = radius(pie.innerRadius, half, 0);
      const cx = g.width / 2, cy = (g.height - (showLegend ? LEGEND_HEIGHT : 0)) / 2;
      const pad = values.length > 1 ? ((pie.paddingAngle ?? 0) * Math.PI) / 180 : 0;
      const available = 2 * Math.PI - pad * values.length;
      const slices: Slice[] = [];
      let start = 0;
      values.forEach((v, i) => {
        const sweep = (v / total) * available;
        slices.push({ start, sweep });
        g.arc(cx, cy, outer, inner, start, sweep, colorOf(i));
        start += sweep + pad;
      });

      if (pie.label) {
        slices.forEach((s, i) => {
          const text = typeof pie.label === "function"
            ? pie.label({ name: nameOf(i), value: values[i]!, percent: values[i]! / total })
            : formatValue(values[i]);
          const mid = s.start + s.sweep / 2, r = outer + 16;
          const m = g.measureText(text, 12);
          g.text(text, cx + Math.sin(mid) * r - m.width / 2, cy - Math.cos(mid) * r - m.height / 2, theme.text.secondary, 12);
        });
      }
      if (showLegend) legend(g, rows.map((_, i) => ({ name: nameOf(i), color: colorOf(i) })));

      const at = tooltip ? pointer() : null;
      const index = at ? sliceAt(at.x - cx, at.y - cy, outer, inner, slices) : -1;
      if (at && index >= 0) {
        const name = nameOf(index);
        const shown = tooltip!.formatter ? tooltip!.formatter(values[index], name) : formatValue(values[index]);
        tooltipBox(g, at.x, at.y, null, [{ text: `${name}: ${shown}`, color: colorOf(index) }]);
      }
    },
  });

  if (tooltip) {
    node.handlers.onPointerMove = (e) => {
      const [pt, , , pl] = edges(node.style.padding);
      setPointer({ x: e.localX - pl, y: e.localY - pt });
    };
    node.handlers.onPointerLeave = () => setPointer(null);
  }
  return node;
}

/** The slice at (dx, dy) from the center, or -1. Angles run clockwise from the top. */
function sliceAt(dx: number, dy: number, outer: number, inner: number, slices: Slice[]): number {
  const r = Math.hypot(dx, dy);
  if (r > outer || r < inner) return -1;
  const angle = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
  return slices.findIndex((s) => angle >= s.start && angle < s.start + s.sweep);
}
