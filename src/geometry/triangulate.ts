// Ear clipping for simple polygons (convex or concave, any winding). Repeated and
// collinear points are dropped first, so no triangle is empty. Self-intersecting input
// returns null: the caller decides what to do (it has no well-defined triangulation).
// Ears are only tested against reflex vertices, and edge pairs only when their x ranges
// overlap, so shapes spread along x (chart areas) stay close to O(n log n).

const EPS = 1e-9;

/** Triangulates a polygon given as x, y pairs; returns vertex indices, 3 per triangle. */
export function triangulate(points: ArrayLike<number>): number[] | null {
  const x = (i: number) => points[i * 2]!;
  const y = (i: number) => points[i * 2 + 1]!;
  const cross = (a: number, b: number, c: number) => (x(b) - x(a)) * (y(c) - y(a)) - (x(c) - x(a)) * (y(b) - y(a));

  let ring: number[] = [];
  for (let i = 0; i < points.length >> 1; i++) {
    const last = ring[ring.length - 1];
    if (last === undefined || Math.abs(x(i) - x(last)) > EPS || Math.abs(y(i) - y(last)) > EPS) ring.push(i);
  }
  if (ring.length > 1 && Math.abs(x(ring[0]!) - x(ring[ring.length - 1]!)) <= EPS && Math.abs(y(ring[0]!) - y(ring[ring.length - 1]!)) <= EPS) ring.pop();
  // Drop collinear vertices until none is left (removing one can make its neighbor collinear).
  for (let changed = true; changed && ring.length >= 3; ) {
    changed = false;
    for (let k = 0; k < ring.length && ring.length >= 3; k++) {
      const a = ring[(k - 1 + ring.length) % ring.length]!, b = ring[k]!, c = ring[(k + 1) % ring.length]!;
      if (Math.abs(cross(a, b, c)) <= EPS) {
        ring.splice(k--, 1);
        changed = true;
      }
    }
  }
  if (ring.length < 3) return [];
  if (selfIntersects(ring, x, y)) return null;

  let signed = 0;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k]!, b = ring[(k + 1) % ring.length]!;
    signed += x(a) * y(b) - x(b) * y(a);
  }
  const winding = signed > 0 ? 1 : -1; // convex corners have cross * winding > 0

  // Only reflex (concave) vertices can lie inside an ear, so only they are tested, found
  // by x with a binary search. A reflex vertex may turn convex later; testing it is harmless.
  const reflex = ring.filter((_, k) => cross(ring[(k - 1 + ring.length) % ring.length]!, ring[k]!, ring[(k + 1) % ring.length]!) * winding < 0);
  reflex.sort((a, b) => x(a) - x(b));
  const reflexX = reflex.map(x);
  const removed = new Uint8Array(points.length >> 1);
  const blocked = (a: number, b: number, c: number) => {
    const minX = Math.min(x(a), x(b), x(c)) - EPS, maxX = Math.max(x(a), x(b), x(c)) + EPS;
    let lo = 0, hi = reflex.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (reflexX[mid]! < minX) lo = mid + 1;
      else hi = mid;
    }
    for (let r = lo; r < reflex.length && reflexX[r]! <= maxX; r++) {
      const v = reflex[r]!;
      if (!removed[v] && v !== a && v !== b && v !== c && inTriangle(v, a, b, c, x, y, cross)) return true;
    }
    return false;
  };

  const out: number[] = [];
  let k = 0;
  let misses = 0;
  while (ring.length > 3) {
    const n = ring.length;
    const ia = (k - 1 + n) % n, ic = (k + 1) % n;
    const a = ring[ia]!, b = ring[k]!, c = ring[ic]!;
    if (cross(a, b, c) * winding > EPS && !blocked(a, b, c)) {
      out.push(a, b, c);
      ring.splice(k, 1);
      removed[b] = 1;
      k = k % ring.length; // keep scanning from here instead of restarting
      misses = 0;
      continue;
    }
    k = (k + 1) % n;
    if (++misses > n) return null; // no ear left: not a simple polygon after all
  }
  out.push(ring[0]!, ring[1]!, ring[2]!);
  return out;
}

/** Whether v lies in triangle abc (edges included), other than on its corners. */
function inTriangle(v: number, a: number, b: number, c: number, x: (i: number) => number, y: (i: number) => number, cross: (a: number, b: number, c: number) => number) {
  const orient = Math.sign(cross(a, b, c));
  if (cross(a, b, v) * orient < -EPS || cross(b, c, v) * orient < -EPS || cross(c, a, v) * orient < -EPS) return false;
  const at = (p: number) => Math.abs(x(v) - x(p)) + Math.abs(y(v) - y(p)) <= EPS;
  return !at(a) && !at(b) && !at(c);
}

/** Edge pairs are only compared when their x ranges overlap (edges sorted by min x). */
function selfIntersects(ring: number[], x: (i: number) => number, y: (i: number) => number) {
  const n = ring.length;
  const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
    const v = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    return Math.abs(v) <= EPS ? 0 : Math.sign(v);
  };
  const onSegment = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
    Math.min(ax, bx) - EPS <= px && px <= Math.max(ax, bx) + EPS && Math.min(ay, by) - EPS <= py && py <= Math.max(ay, by) + EPS;
  const edges = Array.from({ length: n }, (_, i) => i);
  const minX = (i: number) => Math.min(x(ring[i]!), x(ring[(i + 1) % n]!));
  const maxX = (i: number) => Math.max(x(ring[i]!), x(ring[(i + 1) % n]!));
  edges.sort((p, q) => minX(p) - minX(q));
  for (let s = 0; s < n; s++) {
    const i = edges[s]!;
    const limit = maxX(i) + EPS;
    for (let t = s + 1; t < n && minX(edges[t]!) <= limit; t++) {
      const j = edges[t]!;
      if (Math.abs(i - j) === 1 || Math.abs(i - j) === n - 1) continue; // neighbors share a vertex
      const a = ring[i]!, b = ring[(i + 1) % n]!, c = ring[j]!, d = ring[(j + 1) % n]!;
      const o1 = orient(x(a), y(a), x(b), y(b), x(c), y(c)), o2 = orient(x(a), y(a), x(b), y(b), x(d), y(d));
      const o3 = orient(x(c), y(c), x(d), y(d), x(a), y(a)), o4 = orient(x(c), y(c), x(d), y(d), x(b), y(b));
      if (o1 !== o2 && o3 !== o4 && o1 * o2 <= 0 && o3 * o4 <= 0) return true;
      if (o1 === 0 && onSegment(x(a), y(a), x(b), y(b), x(c), y(c))) return true;
      if (o2 === 0 && onSegment(x(a), y(a), x(b), y(b), x(d), y(d))) return true;
      if (o3 === 0 && onSegment(x(c), y(c), x(d), y(d), x(a), y(a))) return true;
      if (o4 === 0 && onSegment(x(c), y(c), x(d), y(d), x(b), y(b))) return true;
    }
  }
  return false;
}
