import { describe, expect, test } from "bun:test";
import { Column, UINode, createRoot, createSignal, layout, setTextMeasurer, theme } from "@nodebuilderjs/core";
import { insert } from "@nodebuilderjs/core/jsx-runtime";
import { interact } from "@nodebuilderjs/core/testing";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis,
} from "@nodebuilderjs/core/charts";
import { parseColor } from "../../src/render/paint.js";
import { type DrawCommand, drawCommands } from "../helpers.js";

setTextMeasurer((text) => ({ width: text.length * 8, ascent: 15, descent: 5 }));

let lastRoot: UINode;
function mount(view: () => any) {
  const root = new UINode("root");
  root.isRoot = true;
  createRoot(() => insert(root, view));
  layout(root, 600, 400);
  lastRoot = root;
  return root.children[0]!;
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

describe("dashes", () => {
  test("strokeDasharray on lines and on the grid", () => {
    const cmds = drawCommands(mount(() => (
      <Column>
        <LineChart data={SALES} width={500} height={300}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <YAxis />
          <Line dataKey="total" strokeDasharray="6 4" dot={false} />
        </LineChart>
      </Column>
    )));
    const lines = of(cmds, "line");
    const series = lines.filter((l) => l.width === 2);
    expect(series.length).toBeGreaterThan(10);
    expect(series.every((l) => l.capStart === "butt" && Math.hypot(l.x1 - l.x0, l.y1 - l.y0) <= 6.001)).toBe(true);
    const grid = lines.filter((l) => l.width === 1);
    expect(grid.every((l) => Math.abs(l.x1 - l.x0) <= 3.001)).toBe(true);
    expect(grid.length).toBeGreaterThan(6 * 10); // 6 ticks, many dashes each
  });
});

describe("stacking", () => {
  const DATA = [{ c: "a", x: 10, y: 10 }, { c: "b", x: 20, y: 20 }, { c: "c", x: 30, y: 30 }];

  test("bars with the same stackId pile up in one column; the axis covers the totals", () => {
    const cmds = drawCommands(mount(() => (
      <Column>
        <BarChart data={DATA} width={500} height={300}>
          <YAxis />
          <Bar dataKey="x" stackId="s" fill="#26a269" />
          <Bar dataKey="y" stackId="s" fill="#e5a50a" />
        </BarChart>
      </Column>
    )));
    const bars = (hex: string) => of(cmds, "rect").filter((r) => r.color.join() === color(hex).join());
    const [bottom, top] = [bars("#26a269"), bars("#e5a50a")];
    bottom.forEach((b, i) => {
      expect(top[i]!.x).toBe(b.x);
      expect(top[i]!.w).toBe(b.w);
      // decode() rounds each number to 1e-3, so sums are compared to 2 decimals
      expect(top[i]!.y + top[i]!.h).toBeCloseTo(b.y, 2); // sits on the one below
      expect(top[i]!.h).toBeCloseTo(b.h, 2); // same values
    });
    expect(texts(cmds)).toContain("60"); // total of the last column
  });

  test("stacked areas start where the previous one ends", () => {
    const cmds = drawCommands(mount(() => (
      <Column>
        <AreaChart data={DATA} width={500} height={300}>
          <YAxis />
          <Area dataKey="x" stackId="s" stroke="#26a269" />
          <Area dataKey="y" stackId="s" stroke="#e5a50a" />
        </AreaChart>
      </Column>
    )));
    const zero = center(of(cmds, "text").find((t) => t.text === "0")!).y;
    const lower = linePoints(cmds, "#26a269"), upper = linePoints(cmds, "#e5a50a");
    lower.forEach((p, i) => expect(zero - upper[i]![1]!).toBeCloseTo(2 * (zero - p[1]!), 2));
    expect(of(cmds, "triangles")).toHaveLength(2);
  });
});

describe("tooltips", () => {
  const view = (tooltip = true) => () => (
    <Column>
      <LineChart data={SALES} width={500} height={300}>
        <XAxis dataKey="mes" />
        <Line dataKey="total" name="Total" />
        <Line dataKey="meta" />
        {tooltip && <Tooltip formatter={(v: unknown) => `${v} un`} />}
      </LineChart>
    </Column>
  );

  test("hovering shows a guide line at the nearest category and its values", () => {
    const chart = mount(view());
    const at = (m: string) => center(of(drawCommands(chart), "text").find((t) => t.text === m)!);
    const ui = interact(lastRoot);
    ui.move(at("fev").x + 20, 100);
    let cmds = drawCommands(chart);
    expect(texts(cmds).filter((t) => t === "fev")).toHaveLength(2); // axis + tooltip title
    expect(texts(cmds)).toEqual(expect.arrayContaining(["Total: 50 un", "meta: 60 un"]));
    expect(of(cmds, "line").some((l) => l.x0 === l.x1 && l.x0 === at("fev").x && l.width === 1)).toBe(true);
    ui.move(at("mar").x - 5, 100);
    expect(texts(drawCommands(chart))).toContain("Total: 100 un");
    ui.move(590, 390); // outside the chart
    expect(texts(drawCommands(chart)).filter((t) => t === "fev")).toHaveLength(1);
  });

  test("no <Tooltip>, no tooltip", () => {
    const chart = mount(view(false));
    const before = drawCommands(chart).length;
    interact(lastRoot).move(250, 100);
    expect(drawCommands(chart).length).toBe(before);
  });

  test("pie: the slice under the pointer", () => {
    const chart = mount(() => (
      <Column>
        <PieChart width={300} height={300}>
          <Pie data={[{ nome: "a", valor: 1 }, { nome: "b", valor: 3 }]} dataKey="valor" nameKey="nome" />
          <Tooltip />
        </PieChart>
      </Column>
    ));
    const ui = interact(lastRoot);
    ui.move(150 + 60, 150 - 60); // top right: slice a (0 to 90 degrees)
    expect(texts(drawCommands(chart))).toContain("a: 1");
    ui.move(150 - 60, 150); // left: slice b
    expect(texts(drawCommands(chart))).toContain("b: 3");
    ui.move(150, 150 + 140); // inside the box, outside the pie
    expect(texts(drawCommands(chart))).toEqual([]);
  });
});

describe("labels", () => {
  test("pie labels outside the slices: the value, or a function of name, value and percent", () => {
    const pie = (label: unknown) => drawCommands(mount(() => (
      <Column>
        <PieChart width={300} height={300}>
          <Pie data={[{ nome: "a", valor: 1 }, { nome: "b", valor: 3 }]} dataKey="valor" nameKey="nome" label={label as never} />
        </PieChart>
      </Column>
    )));
    expect(texts(pie(true))).toEqual(["1", "3"]);
    const custom = pie(({ name, percent }: { name: string; percent: number }) => `${name} ${Math.round(percent * 100)}%`);
    expect(texts(custom)).toEqual(["a 25%", "b 75%"]);
    for (const t of of(custom, "text")) expect(Math.hypot(center(t).x - 150, center(t).y - 150)).toBeGreaterThan(120);
  });

  test("bar labels: the value just above each bar", () => {
    const cmds = drawCommands(mount(() => (
      <Column><BarChart data={SALES} width={500} height={300}><Bar dataKey="meta" fill="#26a269" label /></BarChart></Column>
    )));
    const bars = of(cmds, "rect").filter((r) => r.color.join() === color("#26a269").join());
    const labels = of(cmds, "text");
    expect(labels.map((t) => t.text)).toEqual(["40", "60", "80"]);
    labels.forEach((t, i) => {
      expect(t.y + 20).toBeLessThanOrEqual(bars[i]!.y);
      expect(center(t).x).toBeCloseTo(bars[i]!.x + bars[i]!.w / 2, 3);
    });
  });
});

describe("crowded x axis", () => {
  test("overlapping labels are skipped, keeping the last one", () => {
    const data = Array.from({ length: 30 }, (_, i) => ({ c: `cat-${String(i).padStart(2, "0")}`, v: i }));
    const cmds = drawCommands(mount(() => (
      <Column><LineChart data={data} width={400} height={200}><XAxis dataKey="c" /><Line dataKey="v" dot={false} /></LineChart></Column>
    )));
    const labels = of(cmds, "text");
    expect(labels.length).toBeLessThan(30);
    expect(labels[labels.length - 1]!.text).toBe("cat-29");
    for (let i = 1; i < labels.length; i++) expect(labels[i]!.x - labels[i - 1]!.x).toBeGreaterThanOrEqual(48); // 6 chars
  });
});
