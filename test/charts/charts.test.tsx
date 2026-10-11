import { describe, expect, test } from "bun:test";
import { Column, UINode, createRoot, createSignal, layout, setTextMeasurer, theme } from "@nodebuilderjs/core";
import { insert } from "@nodebuilderjs/core/jsx-runtime";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis,
} from "@nodebuilderjs/core/charts";
import { parseColor } from "../../src/render/paint.js";
import { type DrawCommand, drawCommands } from "../helpers.js";

setTextMeasurer((text) => ({ width: text.length * 8, ascent: 15, descent: 5 }));

function mount(view: () => any) {
  const root = new UINode("root");
  root.isRoot = true;
  createRoot(() => insert(root, view));
  const node = root.children[0]!;
  layout(node, 600, 400);
  return node;
}

type Of<K extends DrawCommand["op"]> = Extract<DrawCommand, { op: K }>;
const of = <K extends DrawCommand["op"]>(cmds: DrawCommand[], op: K) => cmds.filter((c): c is Of<K> => c.op === op);
const texts = (cmds: DrawCommand[]) => of(cmds, "text").map((t) => t.text);
const color = (hex: string) => Array.from(parseColor(hex), (v) => Math.round(v * 1000) / 1000);
/** Center of a label with the fake metrics (8 px per character, 20 px lines). */
const center = (t: Of<"text">) => ({ x: t.x + t.text.length * 4, y: t.y + 10 });
/** Points of the polyline drawn in `hex` (segments chained). */
const linePoints = (cmds: DrawCommand[], hex: string) => {
  const segs = of(cmds, "line").filter((l) => l.color.join() === color(hex).join() && l.width === 2);
  return segs.length ? [[segs[0]!.x0, segs[0]!.y0], ...segs.map((s) => [s.x1, s.y1])] : [];
};

const SALES = [
  { mes: "jan", total: 0, meta: 40 },
  { mes: "fev", total: 50, meta: 60 },
  { mes: "mar", total: 100, meta: 80 },
];
const PALETTE_0 = theme.accent.base;

describe("LineChart", () => {
  const chart = () =>
    drawCommands(mount(() => (
      <Column>
        <LineChart data={SALES} width={500} height={300}>
          <XAxis dataKey="mes" />
          <YAxis />
          <Line dataKey="total" />
          <Line dataKey="meta" stroke="#e01b24" />
        </LineChart>
      </Column>
    )));

  test("axes: round y ticks and the category labels", () => {
    const t = texts(chart());
    for (const label of ["0", "20", "40", "60", "80", "100", "jan", "fev", "mar"]) expect(t).toContain(label);
  });

  test("points sit on their category and value", () => {
    const cmds = chart();
    const label = (s: string) => center(of(cmds, "text").find((t) => t.text === s)!);
    const points = linePoints(cmds, PALETTE_0);
    expect(points).toHaveLength(3);
    expect(points.map((p) => p[0])).toEqual(["jan", "fev", "mar"].map((m) => label(m).x));
    expect(points[0]![1]).toBeCloseTo(label("0").y, 3);
    expect(points[2]![1]).toBeCloseTo(label("100").y, 3);
    expect(points[1]![1]).toBeCloseTo((label("0").y + label("100").y) / 2, 3);
  });

  test("each series has its color: the palette, or stroke", () => {
    const cmds = chart();
    expect(linePoints(cmds, PALETTE_0)).toHaveLength(3);
    expect(linePoints(cmds, "#e01b24")).toHaveLength(3);
    expect(of(cmds, "arc").length).toBe(6); // dots, on by default
  });

  test("monotone curves pass through the points with more segments", () => {
    const cmds = drawCommands(mount(() => (
      <Column><LineChart data={SALES} width={500} height={300}><Line dataKey="meta" type="monotone" dot={false} /></LineChart></Column>
    )));
    const linear = drawCommands(mount(() => (
      <Column><LineChart data={SALES} width={500} height={300}><Line dataKey="meta" dot={false} /></LineChart></Column>
    )));
    const curve = linePoints(cmds, PALETTE_0), straight = linePoints(linear, PALETTE_0);
    expect(curve.length).toBeGreaterThan(10);
    expect(curve[0]).toEqual(straight[0]!);
    expect(curve[curve.length - 1]).toEqual(straight[2]!);
  });

  test("data can be a signal", () => {
    const [data, setData] = createSignal(SALES);
    const node = mount(() => <Column><LineChart data={data} width={500} height={300}><Line dataKey="total" /></LineChart></Column>);
    const before = linePoints(drawCommands(node), PALETTE_0);
    setData(SALES.map((r, i) => ({ ...r, total: SALES[2 - i]!.total }))); // reversed: 100, 50, 0
    const after = linePoints(drawCommands(node), PALETTE_0);
    expect(after[0]![1]).toBe(before[2]![1]!);
    expect(after[2]![1]).toBe(before[0]![1]!);
  });

  test("tickFormatter, a fixed domain, a grid and a legend", () => {
    const cmds = drawCommands(mount(() => (
      <Column>
        <LineChart data={SALES} width={500} height={300}>
          <CartesianGrid />
          <XAxis dataKey="mes" tickFormatter={(m) => String(m).toUpperCase()} />
          <YAxis domain={[0, 200]} tickFormatter={(v) => `${v}%`} />
          <Line dataKey="total" name="Vendas" />
          <Tooltip />
          <Legend />
        </LineChart>
      </Column>
    )));
    const t = texts(cmds);
    expect(t).toContain("JAN");
    expect(t).toContain("200%");
    expect(t).toContain("Vendas");
    const grid = of(cmds, "line").filter((l) => l.width === 1);
    expect(grid.filter((l) => l.y0 === l.y1).length).toBe(5); // one per y tick (0..200 by 50)
    expect(grid.filter((l) => l.x0 === l.x1).length).toBe(3); // one per category
  });
});

describe("AreaChart and BarChart", () => {
  test("areas fill down to zero under their line", () => {
    const cmds = drawCommands(mount(() => (
      <Column><AreaChart data={SALES} width={500} height={300}><Area dataKey="meta" /></AreaChart></Column>
    )));
    const fill = of(cmds, "triangles");
    expect(fill).toHaveLength(1);
    expect(fill[0]!.color[3]).toBeLessThan(1); // translucent
    expect(linePoints(cmds, PALETTE_0)).toHaveLength(3);
  });

  test("bars: one per row and series, from a common baseline, height by value", () => {
    const cmds = drawCommands(mount(() => (
      <Column>
        <BarChart data={SALES} width={500} height={300}>
          <XAxis dataKey="mes" />
          <Bar dataKey="total" fill="#26a269" />
          <Bar dataKey="meta" fill="#e5a50a" />
        </BarChart>
      </Column>
    )));
    const bars = (hex: string) => of(cmds, "rect").filter((r) => r.color.join() === color(hex).join());
    const total = bars("#26a269"), meta = bars("#e5a50a");
    expect(total).toHaveLength(3);
    expect(meta).toHaveLength(3);
    const bottom = (r: Of<"rect">) => r.y + r.h;
    expect(new Set([...total, ...meta].map(bottom)).size).toBe(1);
    expect(total[1]!.h * 2).toBeCloseTo(total[2]!.h, 3); // 50 is half of 100
    expect(total[0]!.h).toBe(0);
    expect(meta[0]!.x).toBeGreaterThan(total[0]!.x); // side by side within the category
  });
});

describe("PieChart", () => {
  const DATA = [{ nome: "a", valor: 1 }, { nome: "b", valor: 3 }];

  test("slices proportional to the values, clockwise from the top", () => {
    const arcs = of(drawCommands(mount(() => (
      <Column><PieChart width={300} height={300}><Pie data={DATA} dataKey="valor" nameKey="nome" /></PieChart></Column>
    ))), "arc");
    expect(arcs.map((a) => [a.start, a.sweep])).toEqual([[0, 1.571], [1.571, 4.712]]);
    expect(arcs[0]!.inner).toBe(0);
    expect(arcs[0]!.outer).toBe(120); // default: 80% of the half size
  });

  test("donut radii, padding between slices, cell colors and the legend", () => {
    const cmds = drawCommands(mount(() => (
      <Column>
        <PieChart width={300} height={300}>
          <Pie data={DATA} dataKey="valor" nameKey="nome" innerRadius={60} outerRadius="50%" paddingAngle={10}>
            <Cell fill="#ff0000" />
            <Cell fill="#0000ff" />
          </Pie>
          <Legend />
        </PieChart>
      </Column>
    )));
    const arcs = of(cmds, "arc");
    expect(arcs.map((a) => [a.inner, a.outer])).toEqual([[60, 75], [60, 75]]);
    const gap = (10 * Math.PI) / 180;
    expect(arcs[0]!.sweep + arcs[1]!.sweep).toBeCloseTo(2 * Math.PI - 2 * gap, 2);
    expect(arcs.map((a) => a.color.join())).toEqual([color("#ff0000").join(), color("#0000ff").join()]);
    expect(texts(cmds)).toEqual(expect.arrayContaining(["a", "b"]));
  });
});
