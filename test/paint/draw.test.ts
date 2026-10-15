import { describe, expect, test } from "bun:test";
import { CommandBuffer } from "../../src/render/paint.js";
import { fillPolygon, polyline } from "../../src/render/shapes.js";
import { decode } from "../helpers.js";

const RED: [number, number, number, number] = [1, 0, 0, 1];

describe("primitives", () => {
  test("line: one segment with its width, color and caps", () => {
    const b = new CommandBuffer();
    b.line(10, 20, 110, 20, 4, "#ff0000", "butt", "round");
    b.line(0, 0, 5, 5, 1, "#00ff0080");
    expect(decode(b)).toEqual([
      { op: "line", x0: 10, y0: 20, x1: 110, y1: 20, width: 4, color: RED, capStart: "butt", capEnd: "round" },
      { op: "line", x0: 0, y0: 0, x1: 5, y1: 5, width: 1, color: [0, 1, 0, 0.502], capStart: "round", capEnd: "round" },
    ]);
  });

  test("triangles: vertices with coverage (default 1)", () => {
    const b = new CommandBuffer();
    b.triangles([0, 0, 10, 0, 0, 10], [1, 0.5, 0], "#ff0000");
    b.triangles([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1], null, "#ff0000");
    const [a, c] = decode(b);
    expect(a).toEqual({ op: "triangles", color: RED, points: [0, 0, 10, 0, 0, 10], coverage: [1, 0.5, 0] });
    expect(c).toMatchObject({ op: "triangles", coverage: [1, 1, 1, 1, 1, 1] });
  });

  test("triangles: thousands of vertices fit (no argument-spread limits)", () => {
    const b = new CommandBuffer();
    const n = 300_000; // 100k triangles
    b.triangles(new Float32Array(n * 2), null, "#000");
    expect(b.length).toBe(1 + 5 + n * 3);
  });

  test("arc: center, radii, angles and color", () => {
    const b = new CommandBuffer();
    b.arc(50, 60, 40, 25, 0, Math.PI, "#ff0000");
    expect(decode(b)).toEqual([{ op: "arc", cx: 50, cy: 60, outer: 40, inner: 25, start: 0, sweep: 3.142, color: RED }]);
  });
});

describe("polyline", () => {
  const lines = (points: number[], options?: Parameters<typeof polyline>[4]) => {
    const b = new CommandBuffer();
    polyline(b, points, 2, "#ff0000", options);
    return decode(b) as Extract<ReturnType<typeof decode>[number], { op: "line" }>[];
  };

  test("one segment per pair of points; joints are round, ends use the cap", () => {
    const l = lines([0, 0, 10, 0, 10, 10], { cap: "butt" });
    expect(l.map((s) => [s.x0, s.y0, s.x1, s.y1])).toEqual([[0, 0, 10, 0], [10, 0, 10, 10]]);
    expect(l.map((s) => [s.capStart, s.capEnd])).toEqual([["butt", "round"], ["round", "butt"]]);
    expect(lines([0, 0, 10, 0]).map((s) => [s.capStart, s.capEnd])).toEqual([["round", "round"]]); // default round
  });

  test("square caps extend the ends by half the width", () => {
    const [s] = lines([0, 0, 10, 0], { cap: "square" });
    expect([s!.x0, s!.x1, s!.capStart, s!.capEnd]).toEqual([-1, 11, "butt", "butt"]);
  });

  test("closed polylines join the last point to the first", () => {
    const l = lines([0, 0, 10, 0, 10, 10], { closed: true, cap: "butt" });
    expect(l).toHaveLength(3);
    expect(l.every((s) => s.capStart === "round" && s.capEnd === "round")).toBe(true);
  });

  test("repeated points are skipped; a single point is a dot", () => {
    expect(lines([0, 0, 0, 0, 10, 0])).toHaveLength(1);
    expect(lines([5, 5])).toEqual([expect.objectContaining({ x0: 5, y0: 5, x1: 5, y1: 5, capStart: "round" })]);
    expect(lines([5, 5], { cap: "butt" })).toEqual([]);
  });
});

describe("fillPolygon", () => {
  const fill = (points: number[], scale = 1) => {
    const b = new CommandBuffer();
    fillPolygon(b, points, "#ff0000", scale);
    return decode(b) as Extract<ReturnType<typeof decode>[number], { op: "triangles" }>[];
  };

  /** Integral of coverage over the triangles: linear coverage averages over each triangle. */
  const coveredArea = (t: { points: number[]; coverage: number[] }) => {
    let sum = 0;
    for (let i = 0; i < t.coverage.length; i += 3) {
      const [ax, ay, bx, by, cx, cy] = t.points.slice(i * 2, i * 2 + 6) as [number, number, number, number, number, number];
      const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
      sum += (area * (t.coverage[i]! + t.coverage[i + 1]! + t.coverage[i + 2]!)) / 3;
    }
    return sum;
  };

  test("a square: inner triangles plus a 1-pixel antialiased fringe", () => {
    const [t] = fill([0, 0, 100, 0, 100, 50, 0, 50]);
    expect(t!.color).toEqual(RED);
    expect(t!.coverage.length).toBe(6 + 4 * 6); // 2 inner triangles + 2 per edge
    expect(new Set(t!.coverage)).toEqual(new Set([0, 1]));
    expect(coveredArea(t!) / 5000).toBeCloseTo(1, 2);
    // The fringe spans half a pixel on each side of the edge.
    const xs = t!.points.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo(-0.5, 3);
    expect(Math.max(...xs)).toBeCloseTo(100.5, 3);
  });

  test("winding does not matter; concave shapes keep their area", () => {
    const l = [0, 0, 20, 0, 20, 10, 10, 10, 10, 20, 0, 20];
    const reversed = [...l.keys()].filter((i) => i % 2 === 0).reverse().flatMap((i) => [l[i]!, l[i + 1]!]);
    expect(coveredArea(fill(l)[0]!) / 300).toBeCloseTo(1, 1);
    expect(coveredArea(fill(reversed)[0]!) / 300).toBeCloseTo(1, 1);
  });

  test("the fringe is one device pixel: thinner on HiDPI", () => {
    const xs = fill([0, 0, 10, 0, 10, 10, 0, 10], 2)[0]!.points.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo(-0.25, 3);
  });

  test("dense curves: no interior triangle flips when pulled in by the fringe", () => {
    // The area under a sampled curve has many slivers thinner than the half-pixel inset.
    const pts = [0, 180];
    for (let i = 0; i <= 1200; i++) pts.push(i * 0.4, 100 - Math.sin(i / 60) * 40);
    pts.push(480, 180);
    const [t] = fill(pts);
    // Signed area of the interior triangles: the flipped ones cover pixels twice. (Slivers
    // near zero area can flip from the 1e-3 rounding of decode(); they cover no pixel.)
    let flipped = 0, total = 0;
    for (let i = 0; i < t!.coverage.length; i += 3) {
      if (t!.coverage[i] !== 1 || t!.coverage[i + 1] !== 1 || t!.coverage[i + 2] !== 1) continue;
      const [ax, ay, bx, by, cx, cy] = t!.points.slice(i * 2, i * 2 + 6) as [number, number, number, number, number, number];
      const a = ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
      total += a;
      if (Math.sign(a) !== Math.sign(total) && Math.abs(a) > 1e-3) flipped += Math.abs(a);
    }
    expect(flipped).toBeLessThan(0.01); // was 25 px² before triangulating the inset ring
  });

  test("self-intersecting or empty shapes draw nothing", () => {
    expect(fill([0, 0, 10, 10, 10, 0, 0, 10])).toEqual([]);
    expect(fill([0, 0, 10, 10])).toEqual([]);
  });
});

describe("dashed polylines", () => {
  const segments = (points: number[], dash: number[], options: Parameters<typeof polyline>[4] = {}) => {
    const b = new CommandBuffer();
    polyline(b, points, 2, "#000", { ...options, dash });
    return (decode(b) as Extract<ReturnType<typeof decode>[number], { op: "line" }>[]).map((s) => [s.x0, s.y0, s.x1, s.y1]);
  };

  test("dashes and gaps along a straight line; a partial last dash", () => {
    expect(segments([0, 0, 20, 0], [4, 2])).toEqual([[0, 0, 4, 0], [6, 0, 10, 0], [12, 0, 16, 0], [18, 0, 20, 0]]);
  });

  test("the pattern continues around corners", () => {
    // 5 along x, then 5 down: dash 0..4, gap 4..6 (turns the corner), dash 6..10.
    expect(segments([0, 0, 5, 0, 5, 5], [4, 2])).toEqual([[0, 0, 4, 0], [5, 1, 5, 5]]);
    // A dash that turns the corner keeps both pieces (and a round joint between them).
    expect(segments([0, 0, 5, 0, 5, 5], [6, 2])).toEqual([[0, 0, 5, 0], [5, 0, 5, 1], [5, 3, 5, 5]]);
  });

  test("dashes are flat-ended unless the cap says otherwise", () => {
    const b = new CommandBuffer();
    polyline(b, [0, 0, 20, 0], 2, "#000", { dash: [4, 2] });
    const caps = (decode(b) as Extract<ReturnType<typeof decode>[number], { op: "line" }>[]).map((s) => s.capStart + s.capEnd);
    expect(new Set(caps)).toEqual(new Set(["buttbutt"]));
  });

  test("an empty or zero pattern draws a solid line", () => {
    expect(segments([0, 0, 20, 0], [])).toEqual([[0, 0, 20, 0]]);
    expect(segments([0, 0, 20, 0], [0, 0])).toEqual([[0, 0, 20, 0]]);
  });
});
