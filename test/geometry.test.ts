import { describe, expect, test } from "bun:test";
import { triangulate } from "../src/geometry/triangulate.js";

const area = (p: ArrayLike<number>, a: number, b: number, c: number) =>
  ((p[b * 2]! - p[a * 2]!) * (p[c * 2 + 1]! - p[a * 2 + 1]!) - (p[c * 2]! - p[a * 2]!) * (p[b * 2 + 1]! - p[a * 2 + 1]!)) / 2;

function polygonArea(p: number[]) {
  let s = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    s += p[i]! * p[j + 1]! - p[j]! * p[i + 1]!;
  }
  return Math.abs(s / 2);
}

function inside(p: number[], x: number, y: number) {
  let hit = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [p[i]!, p[i + 1]!, p[j]!, p[j + 1]!];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Triangles tile the polygon: same total area, none degenerate, each centroid inside. */
function expectTiles(p: number[]) {
  const tris = triangulate(p)!;
  expect(tris).not.toBeNull();
  expect(tris.length % 3).toBe(0);
  let total = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t]!, tris[t + 1]!, tris[t + 2]!];
    const ar = Math.abs(area(p, a, b, c));
    expect(ar).toBeGreaterThan(1e-9);
    total += ar;
    const cx = (p[a * 2]! + p[b * 2]! + p[c * 2]!) / 3, cy = (p[a * 2 + 1]! + p[b * 2 + 1]! + p[c * 2 + 1]!) / 3;
    expect(inside(p, cx, cy)).toBe(true);
  }
  expect(total).toBeCloseTo(polygonArea(p), 6);
  return tris;
}

describe("triangulate", () => {
  test("convex polygons, in either winding", () => {
    expect(expectTiles([0, 0, 10, 0, 10, 10, 0, 10]).length).toBe(6);
    expectTiles([0, 0, 0, 10, 10, 10, 10, 0]);
    expectTiles(Array.from({ length: 64 }, (_, i) => (i % 2 ? Math.sin : Math.cos)((Math.PI * 2 * (i >> 1)) / 32) * 50));
  });

  test("concave polygons", () => {
    expect(expectTiles([0, 0, 20, 0, 20, 10, 10, 10, 10, 20, 0, 20]).length).toBe(12); // L
    const star: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 20 : 50, a = (Math.PI * i) / 5;
      star.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    expectTiles(star);
    // An area chart: a jagged top over a flat baseline.
    expectTiles([0, 100, 0, 40, 10, 80, 20, 10, 30, 90, 40, 50, 50, 60, 50, 100]);
  });

  test("a long jagged area (the reflex-vertex and edge-sweep shortcuts)", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const p = [0, 300];
    for (let i = 0; i < 300; i++) p.push(i * 3, 50 + rnd() * 200);
    p.push(897, 300);
    expect(expectTiles(p).length / 3).toBe(300);
  });

  test("collinear and repeated points do not make empty triangles", () => {
    expectTiles([0, 0, 5, 0, 10, 0, 10, 10, 10, 10, 0, 10, 0, 5]);
  });

  test("degenerate and self-intersecting input", () => {
    expect(triangulate([0, 0, 1, 1])).toEqual([]);
    expect(triangulate([0, 0, 5, 5, 10, 10])).toEqual([]); // no area
    expect(triangulate([0, 0, 10, 10, 10, 0, 0, 10])).toBeNull(); // bow tie
  });
});
