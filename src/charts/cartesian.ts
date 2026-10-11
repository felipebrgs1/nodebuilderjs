// Line, area and bar charts: one <Canvas> with a y scale from the data (always including
// zero, like Recharts), categories along x, then grid, series, axes, legend and tooltip.

import type { Child, ElementDesc } from "../jsx-runtime.js";
import { edges } from "../render/layout.js";
import { type MaybeAccessor, createSignal, read } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { Canvas, type DrawContext } from "../widgets/canvas.js";
import type { StyleProps } from "../widgets/props.js";
import {
  Area, type AreaProps, Bar, type BarProps, CartesianGrid, type CartesianGridProps, type Curve, Legend, Line, type LineProps, type Row,
  Tooltip, type TooltipProps, XAxis, type XAxisProps, YAxis, type YAxisProps,
} from "./components.js";
import { niceScale } from "./scale.js";
import {
  LEGEND_HEIGHT, configs, dashArray, formatValue, number, numberFormat, palette, seriesName, tooltipBox, value, withOpacity,
} from "./shared.js";

export type CartesianChartProps = StyleProps & { data: MaybeAccessor<readonly Row[]>; children?: Child };

type Series =
  | { kind: "line"; props: LineProps; color: string }
  | { kind: "area"; props: AreaProps; color: string }
  | { kind: "bar"; props: BarProps; color: string };

interface Config {
  series: Series[];
  x?: XAxisProps;
  y?: YAxisProps;
  grid?: CartesianGridProps;
  tooltip?: TooltipProps;
  legend: boolean;
}

/** Where the last drawing put things, for hit testing the pointer. */
interface Plot {
  left: number;
  right: number;
  top: number;
  bottom: number;
  xs: number[];
}

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
  const config: Config = {
    series,
    x: find<XAxisProps>(XAxis),
    y: find<YAxisProps>(YAxis),
    grid: find<CartesianGridProps>(CartesianGrid),
    tooltip: find<TooltipProps>(Tooltip),
    legend: parts.some((p: ElementDesc) => p.type === Legend),
  };

  const [hover, setHover] = createSignal(-1); // hovered category, for the tooltip
  let plot: Plot | null = null;
  const node = Canvas({
    height: 240,
    ...style,
    draw: (g) => {
      plot = drawCartesian(g, read(data) ?? [], config, config.tooltip ? hover() : -1);
    },
  });
  if (config.tooltip) {
    node.handlers.onPointerMove = (e) => {
      const [pt, , , pl] = edges(node.style.padding);
      const x = e.localX - pl, y = e.localY - pt;
      if (!plot || !plot.xs.length || y < plot.top || y > plot.bottom || x < plot.left - 4 || x > plot.right + 4) return setHover(-1);
      let best = 0;
      plot.xs.forEach((px, i) => Math.abs(px - x) < Math.abs(plot!.xs[best]! - x) && (best = i));
      setHover(best);
    };
    node.handlers.onPointerLeave = () => setHover(-1);
  }
  return node;
}

function drawCartesian(g: DrawContext, rows: readonly Row[], c: Config, hovered: number): Plot | null {
  const muted = theme.text.secondary;
  const n = rows.length;
  const values = c.series.map((s) => rows.map((r) => number(value(r, s.props.dataKey))));

  // Stacks: series with the same stackId add up; base[k][i] is where series k starts.
  const stackKey = (s: Series) => (s.kind !== "line" && s.props.stackId !== undefined ? `${s.kind}:${s.props.stackId}` : null);
  const sums = new Map<string, number[]>();
  const bases = c.series.map((s, k) => {
    const key = stackKey(s);
    if (!key) return rows.map(() => 0);
    const acc = sums.get(key) ?? rows.map(() => 0);
    const base = [...acc];
    values[k]!.forEach((v, i) => !Number.isNaN(v) && (acc[i] = acc[i]! + v));
    sums.set(key, acc);
    return base;
  });
  const tops = values.map((vs, k) => vs.map((v, i) => (Number.isNaN(v) ? NaN : bases[k]![i]! + v)));

  // y scale
  let lo = 0, hi = 0;
  for (const vs of tops) for (const v of vs) if (!Number.isNaN(v)) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
  const scale = c.y?.domain ? niceScale(c.y.domain[0], c.y.domain[1], c.y.tickCount) : niceScale(lo, hi, c.y?.tickCount);
  const [min, max] = c.y?.domain ?? [scale.min, scale.max];
  const ticks = scale.ticks.filter((t) => t >= min - 1e-9 && t <= max + 1e-9);
  const yFormat = c.y?.tickFormatter ?? numberFormat(scale.step);
  const yLabels = c.y && !c.y.hide ? ticks.map((t, i) => yFormat(t, i)) : [];
  const rawX = rows.map((r) => value(r, c.x?.dataKey));
  const xLabels = c.x && !c.x.hide ? rawX.map((v, i) => (c.x!.tickFormatter ? c.x!.tickFormatter(v, i) : v === undefined ? "" : String(v))) : [];

  // plot area
  const lineHeight = g.measureText("0", TICK_FONT).height;
  const left = yLabels.length ? Math.max(...yLabels.map((l) => g.measureText(l, TICK_FONT).width)) + 10 : 8;
  const top = lineHeight / 2 + 2;
  const bottom = g.height - (xLabels.length ? lineHeight + 8 : 8) - (c.legend ? LEGEND_HEIGHT : 0);
  const right = g.width - 12;
  if (right <= left || bottom <= top) return null;
  const band = c.series.some((s) => s.kind === "bar");
  const step = n ? (right - left) / n : 0;
  const xAt = (i: number) => (band ? left + step * (i + 0.5) : n <= 1 ? (left + right) / 2 : left + ((right - left) * i) / (n - 1));
  const yAt = (v: number) => top + ((max - v) / (max - min || 1)) * (bottom - top);
  const zero = yAt(Math.min(max, Math.max(min, 0)));

  // grid
  if (c.grid) {
    const stroke = c.grid.stroke ?? theme.divider;
    const dash = dashArray(c.grid.strokeDasharray);
    if (c.grid.horizontal !== false) for (const t of ticks) g.line(left, yAt(t), right, yAt(t), stroke, 1, "butt", dash);
    if (c.grid.vertical !== false) for (let i = 0; i < n; i++) g.line(xAt(i), top, xAt(i), bottom, stroke, 1, "butt", dash);
  }

  // series: areas, then bars, then lines (and their dots) on top
  const points = (vs: number[], curve: Curve | undefined) => {
    const pts: number[] = [];
    vs.forEach((v, i) => !Number.isNaN(v) && pts.push(xAt(i), yAt(v)));
    return curve === "monotone" ? monotone(pts) : pts;
  };
  c.series.forEach((s, k) => {
    if (s.kind !== "area") return;
    const upper = points(tops[k]!, s.props.type);
    if (upper.length < 4) return;
    const stacked = stackKey(s) !== null;
    // Down along the base: the previous area's top when stacked, the zero line otherwise.
    const lower = stacked ? points(bases[k]!.map((b, i) => (Number.isNaN(tops[k]![i]!) ? NaN : b)), s.props.type) : [upper[upper.length - 2]!, zero, upper[0]!, zero];
    const back: number[] = [];
    if (stacked) for (let i = lower.length - 2; i >= 0; i -= 2) back.push(lower[i]!, lower[i + 1]!);
    else back.push(lower[0]!, lower[1]!, lower[2]!, lower[3]!);
    g.polygon([...upper, ...back], withOpacity(s.props.fill ?? s.color, s.props.fillOpacity ?? 0.25));
    g.polyline(upper, s.color, s.props.strokeWidth ?? 2);
  });
  // One slot per stack (or per unstacked bar) inside each category.
  const slots: string[] = [];
  c.series.forEach((s, k) => s.kind === "bar" && !slots.includes(stackKey(s) ?? `bar#${k}`) && slots.push(stackKey(s) ?? `bar#${k}`));
  const group = step * 0.8, slotWidth = slots.length ? group / slots.length : 0;
  c.series.forEach((s, k) => {
    if (s.kind !== "bar") return;
    const slot = slots.indexOf(stackKey(s) ?? `bar#${k}`);
    values[k]!.forEach((v, i) => {
      if (Number.isNaN(v)) return;
      const y0 = yAt(bases[k]![i]!), y1 = yAt(tops[k]![i]!);
      const x = xAt(i) - group / 2 + slot * slotWidth + 1, w = Math.max(0, slotWidth - 2);
      g.rect(x, Math.min(y0, y1), w, Math.abs(y0 - y1), s.color, s.props.radius ?? 0);
      if (s.props.label) {
        const text = typeof s.props.label === "function" ? s.props.label(v) : formatValue(v);
        const m = g.measureText(text, TICK_FONT);
        g.text(text, x + w / 2 - m.width / 2, Math.min(y0, y1) - 4 - m.height, muted, TICK_FONT);
      }
    });
  });
  c.series.forEach((s, k) => {
    if (s.kind !== "line") return;
    const pts = points(values[k]!, s.props.type);
    if (pts.length >= 4) g.polyline(pts, s.color, s.props.strokeWidth ?? 2, { dash: dashArray(s.props.strokeDasharray) });
    if (s.props.dot !== false) values[k]!.forEach((v, i) => !Number.isNaN(v) && g.circle(xAt(i), yAt(v), 3, s.color));
  });

  // axes: y labels, then x labels, skipping those that would overlap (keeping the last)
  ticks.forEach((t, i) => {
    const label = yLabels[i];
    if (label === undefined) return;
    const m = g.measureText(label, TICK_FONT);
    g.text(label, left - 6 - m.width, yAt(t) - m.height / 2, muted, TICK_FONT);
  });
  if (xLabels.length) {
    const widest = Math.max(...xLabels.map((l) => g.measureText(l, TICK_FONT).width));
    const spacing = n > 1 ? Math.abs(xAt(1) - xAt(0)) : Infinity;
    const every = Math.max(1, Math.ceil((widest + 8) / spacing));
    xLabels.forEach((label, i) => {
      if ((n - 1 - i) % every) return;
      const m = g.measureText(label, TICK_FONT);
      g.text(label, xAt(i) - m.width / 2, bottom + 6, muted, TICK_FONT);
    });
  }

  if (c.legend) legend(g, c.series.map((s, i) => ({ name: seriesName(s.props.name, s.props.dataKey, i), color: s.color })));

  // tooltip: guide line at the hovered category and a box with every series' value there
  if (c.tooltip && hovered >= 0 && hovered < n) {
    const x = xAt(hovered);
    g.line(x, top, x, bottom, "#00000040", 1, "butt");
    c.series.forEach((s, k) => {
      if (s.kind === "line" && !Number.isNaN(values[k]![hovered]!)) g.circle(x, yAt(values[k]![hovered]!), 5, s.color);
    });
    const raw = rawX[hovered];
    const title = c.tooltip.labelFormatter ? c.tooltip.labelFormatter(raw) : raw === undefined ? null : xLabels[hovered] ?? String(raw);
    const items = c.series.flatMap((s, k) => {
      const v = values[k]![hovered]!;
      if (Number.isNaN(v)) return [];
      const name = seriesName(s.props.name, s.props.dataKey, k);
      return [{ text: `${name}: ${c.tooltip!.formatter ? c.tooltip!.formatter(v, name) : formatValue(v)}`, color: s.color }];
    });
    tooltipBox(g, x, top, title, items);
  }

  return { left, right, top, bottom, xs: Array.from({ length: n }, (_, i) => xAt(i)) };
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
