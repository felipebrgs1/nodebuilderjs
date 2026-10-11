// Pie and donut charts: slices clockwise from the top, sized by value.

import { Canvas, type StyleProps } from "@nodebuilderjs/core";
import type { Child } from "@nodebuilderjs/core/jsx-runtime";
import { Cell, type CellProps, Legend, Pie, type PieProps } from "./components.js";
import { legend } from "./cartesian.js";
import { LEGEND_HEIGHT, configs, number, palette, radius, value } from "./shared.js";

export type PieChartProps = StyleProps & { children?: Child };

export function PieChart(props: PieChartProps) {
  const { children, ...style } = props;
  const parts = configs(children);
  const pie = parts.find((p) => p.type === Pie)?.props as PieProps | undefined;
  const showLegend = parts.some((p) => p.type === Legend);
  const cells = configs(pie?.children).filter((c) => c.type === Cell).map((c) => (c.props as unknown as CellProps).fill);
  return Canvas({
    height: 240,
    ...style,
    draw: (g) => {
      if (!pie) return;
      const rows = pie.data ?? [];
      const values = rows.map((r) => Math.max(0, number(value(r, pie.dataKey)) || 0));
      const total = values.reduce((a, v) => a + v, 0);
      if (!total) return;
      const colors = palette();
      const half = Math.min(g.width, g.height) / 2;
      const outer = radius(pie.outerRadius, half, half * 0.8);
      const inner = radius(pie.innerRadius, half, 0);
      const cx = g.width / 2, cy = (g.height - (showLegend ? LEGEND_HEIGHT : 0)) / 2;
      const pad = values.length > 1 ? ((pie.paddingAngle ?? 0) * Math.PI) / 180 : 0;
      const available = 2 * Math.PI - pad * values.length;
      let start = 0;
      values.forEach((v, i) => {
        const sweep = (v / total) * available;
        g.arc(cx, cy, outer, inner, start, sweep, cells[i] ?? colors[i % colors.length]!);
        start += sweep + pad;
      });
      if (showLegend) {
        legend(g, rows.map((r, i) => ({ name: String(value(r, pie.nameKey) ?? i + 1), color: cells[i] ?? colors[i % colors.length]! })));
      }
    },
  });
}
