// Line, area and bar charts: one <Canvas> with a y scale from the data (always including
// zero, like Recharts), categories along x, then grid, series, axes and legend.

import { Canvas, type DrawContext, type MaybeAccessor, type StyleProps, read, theme } from "@nodebuilderjs/core";
import type { Child, ElementDesc } from "@nodebuilderjs/core/jsx-runtime";
import {
  Area, type AreaProps, Bar, type BarProps, CartesianGrid, type CartesianGridProps, type Curve, Legend, Line, type LineProps, type Row,
  XAxis, type XAxisProps, YAxis, type YAxisProps,
} from "./components.js";
import { niceScale } from "./scale.js";
import { LEGEND_HEIGHT, configs, number, numberFormat, palette, seriesName, value, withOpacity } from "./shared.js";

export type CartesianChartProps = StyleProps & { data: MaybeAccessor<readonly Row[]>; children?: Child };

type Series =
  | { kind: "line"; props: LineProps; color: string }
  | { kind: "area"; props: AreaProps; color: string }
  | { kind: "bar"; props: BarProps; color: string };

const TICK_FONT = 11;

function cartesian(props: CartesianChartProps) {
  const { data, children, ...style } = props;
  const parts = configs(children);
  const find = <P,>(type: unknown) => parts.find((p) => p.type === type)?.props as P | undefined;
  const colors = palette();
  const series: Series[] = [];
  for (const p of parts) {
    const color = (c: string | undefined) => c ?? colors[series.length % colors.length]!;
    if (p.type === Line) {
      const props = p.props as unknown as LineProps;
      series.push({ kind: "line", props, color: color(props.stroke) });
    } else if (p.type === Area) {
      const props = p.props as unknown as AreaProps;
      series.push({ kind: "area", props, color: color(props.stroke ?? props.fill) });
    } else if (p.type === Bar) {
      const props = p.props as unknown as BarProps;
      series.push({ kind: "bar", props, color: color(props.fill) });
    }
  }
  const config = {
    series,
    x: find<XAxisProps>(XAxis),
    y: find<YAxisProps>(YAxis),
    grid: find<CartesianGridProps>(CartesianGrid),
    legend: parts.some((p: ElementDesc) => p.type === Legend),
  };
  return Canvas({ height: 240, ...style, draw: (g) => drawCartesian(g, read(data) ?? [], config) });
}

function drawCartesian(g: DrawContext, rows: readonly Row[], c: { series: Series[]; x?: XAxisProps; y?: YAxisProps; grid?: CartesianGridProps; legend: boolean }) {
  const muted = theme.text.secondary;
  const n = rows.length;
  const values = c.series.map((s) => rows.map((r) => number(value(r, s.props.dataKey))));

  // y scale
  let lo = 0, hi = 0;
  for (const vs of values) for (const v of vs) if (!Number.isNaN(v)) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
  const scale = c.y?.domain ? niceScale(c.y.domain[0], c.y.domain[1], c.y.tickCount) : niceScale(lo, hi, c.y?.tickCount);
  const [min, max] = c.y?.domain ?? [scale.min, scale.max];
  const ticks = scale.ticks.filter((t) => t >= min - 1e-9 && t <= max + 1e-9);
  const yFormat = c.y?.tickFormatter ?? numberFormat(scale.step);
  const yLabels = c.y && !c.y.hide ? ticks.map((t, i) => yFormat(t, i)) : [];
  const xLabels = c.x && !c.x.hide ? rows.map((r, i) => {
    const v = value(r, c.x!.dataKey);
    return c.x!.tickFormatter ? c.x!.tickFormatter(v, i) : v === undefined ? "" : String(v);
  }) : [];

  // plot area
  const lineHeight = g.measureText("0", TICK_FONT).height;
  const left = yLabels.length ? Math.max(...yLabels.map((l) => g.measureText(l, TICK_FONT).width)) + 10 : 8;
  const top = lineHeight / 2 + 2;
  const bottom = g.height - (xLabels.length ? lineHeight + 8 : 8) - (c.legend ? LEGEND_HEIGHT : 0);
  const right = g.width - 12;
  if (right <= left || bottom <= top) return;
  const band = c.series.some((s) => s.kind === "bar");
  const step = n ? (right - left) / n : 0;
  const xAt = (i: number) => (band ? left + step * (i + 0.5) : n <= 1 ? (left + right) / 2 : left + ((right - left) * i) / (n - 1));
  const yAt = (v: number) => top + ((max - v) / (max - min || 1)) * (bottom - top);
  const zero = yAt(Math.min(max, Math.max(min, 0)));

  // grid
  if (c.grid) {
    const stroke = c.grid.stroke ?? theme.divider;
    if (c.grid.horizontal !== false) for (const t of ticks) g.line(left, yAt(t), right, yAt(t), stroke, 1, "butt");
    if (c.grid.vertical !== false) for (let i = 0; i < n; i++) g.line(xAt(i), top, xAt(i), bottom, stroke, 1, "butt");
  }

  // series: areas, then bars, then lines (and their dots) on top
  const points = (vs: number[], curve: Curve | undefined) => {
    const pts: number[] = [];
    vs.forEach((v, i) => !Number.isNaN(v) && pts.push(xAt(i), yAt(v)));
    return curve === "monotone" ? monotone(pts) : pts;
  };
  c.series.forEach((s, k) => {
    if (s.kind !== "area") return;
    const pts = points(values[k]!, s.props.type);
    if (pts.length < 4) return;
    g.polygon([pts[0]!, zero, ...pts, pts[pts.length - 2]!, zero], withOpacity(s.props.fill ?? s.color, s.props.fillOpacity ?? 0.25));
    g.polyline(pts, s.color, s.props.strokeWidth ?? 2);
  });
  const bars = c.series.filter((s) => s.kind === "bar");
  const group = step * 0.8, barWidth = bars.length ? group / bars.length : 0;
  c.series.forEach((s, k) => {
    if (s.kind !== "bar") return;
    const slot = bars.indexOf(s);
    values[k]!.forEach((v, i) => {
      if (Number.isNaN(v)) return;
      const y = yAt(v);
      g.rect(xAt(i) - group / 2 + slot * barWidth + 1, Math.min(y, zero), Math.max(0, barWidth - 2), Math.abs(zero - y), s.color, s.props.radius ?? 0);
    });
  });
  c.series.forEach((s, k) => {
    if (s.kind !== "line") return;
    const pts = points(values[k]!, s.props.type);
    if (pts.length >= 4) g.polyline(pts, s.color, s.props.strokeWidth ?? 2);
    if (s.props.dot !== false) values[k]!.forEach((v, i) => !Number.isNaN(v) && g.circle(xAt(i), yAt(v), 3, s.color));
  });

  // axes
  ticks.forEach((t, i) => {
    const label = yLabels[i];
    if (label === undefined) return;
    const m = g.measureText(label, TICK_FONT);
    g.text(label, left - 6 - m.width, yAt(t) - m.height / 2, muted, TICK_FONT);
  });
  xLabels.forEach((label, i) => {
    const m = g.measureText(label, TICK_FONT);
    g.text(label, xAt(i) - m.width / 2, bottom + 6, muted, TICK_FONT);
  });

  if (c.legend) legend(g, c.series.map((s, i) => ({ name: seriesName(s.props.name, s.props.dataKey, i), color: s.color })));
}

/** Swatches and names, centered along the bottom edge. */
export function legend(g: DrawContext, items: { name: string; color: string }[]) {
  const widths = items.map((it) => 14 + g.measureText(it.name, 12).width);
  const total = widths.reduce((a, w) => a + w, 0) + Math.max(0, items.length - 1) * 16;
  let x = (g.width - total) / 2;
  const y = g.height - LEGEND_HEIGHT / 2;
  items.forEach((it, i) => {
    g.rect(x, y - 5, 10, 10, it.color, 2);
    const m = g.measureText(it.name, 12);
    g.text(it.name, x + 14, y - m.height / 2, theme.text.secondary, 12);
    x += widths[i]! + 16;
  });
}

/** Monotone cubic interpolation in x (d3's curveMonotoneX), flattened to points. */
function monotone(pts: number[]): number[] {
  const n = pts.length / 2;
  if (n < 3) return pts;
  const x = (i: number) => pts[i * 2]!, y = (i: number) => pts[i * 2 + 1]!;
  const t = new Array<number>(n);
  for (let i = 1; i < n - 1; i++) {
    const h0 = x(i) - x(i - 1), h1 = x(i + 1) - x(i);
    const s0 = (y(i) - y(i - 1)) / h0, s1 = (y(i + 1) - y(i)) / h1, p = (s0 * h1 + s1 * h0) / (h0 + h1);
    t[i] = (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  const end = (i: number, j: number, tj: number) => {
    const h = x(j) - x(i);
    return h ? ((3 * (y(j) - y(i))) / h - tj) / 2 : tj;
  };
  t[0] = end(0, 1, t[1]!);
  t[n - 1] = end(n - 2, n - 1, t[n - 2]!);
  const out = [x(0), y(0)];
  for (let i = 0; i < n - 1; i++) {
    const dx = (x(i + 1) - x(i)) / 3;
    const [x0, y0, x1, y1, x2, y2, x3, y3] = [x(i), y(i), x(i) + dx, y(i) + dx * t[i]!, x(i + 1) - dx, y(i + 1) - dx * t[i + 1]!, x(i + 1), y(i + 1)];
    const steps = Math.min(32, Math.max(4, Math.ceil((x3 - x0) / 3)));
    for (let k = 1; k <= steps; k++) {
      const u = k / steps, v = 1 - u;
      out.push(v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3, v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3);
    }
  }
  return out;
}

export const LineChart = cartesian;
export const AreaChart = cartesian;
export const BarChart = cartesian;
/** Lines, areas and bars together. */
export const ComposedChart = cartesian;
