/**
 * Coverage (0..1 per pixel) of closed polygons. Horizontal coverage is exact; vertically
 * each pixel row is sampled `sub` times.
 */
export function rasterize(polys: number[][], w: number, h: number, evenOdd: boolean): Float32Array {
  const cov = new Float32Array(w * h);
  // Edges as [x0, y0, x1, y1, winding] with y0 < y1.
  const edges: number[][] = [];
  for (const p of polys) {
    for (let i = 0, n = p.length; i < n; i += 2) {
      const j = (i + 2) % n;
      const ax = p[i]!, ay = p[i + 1]!, bx = p[j]!, by = p[j + 1]!;
      if (ay === by) continue;
      edges.push(ay < by ? [ax, ay, bx, by, 1] : [bx, by, ax, ay, -1]);
    }
  }
  if (!edges.length) return cov;
  edges.sort((a, b) => a[1]! - b[1]!);
  const sub = h <= 256 ? 16 : 5;
  const weight = 1 / sub;
  const partial = new Float32Array(w + 1);
  const diff = new Float32Array(w + 2);
  let active: number[][] = [];
  let next = 0;
  const xs: number[] = [];
  const ws: number[] = [];

  for (let row = 0; row < h; row++) {
    partial.fill(0);
    diff.fill(0);
    let any = false;
    for (let k = 0; k < sub; k++) {
      const y = row + (k + 0.5) * weight;
      while (next < edges.length && edges[next]![1]! <= y) active.push(edges[next++]!);
      active = active.filter((e) => e[3]! > y);
      if (!active.length) continue;
      xs.length = 0;
      ws.length = 0;
      for (const e of active) {
        if (e[1]! > y) continue;
        const t = (y - e[1]!) / (e[3]! - e[1]!);
        const x = e[0]! + (e[2]! - e[0]!) * t;
        // insertion sort: few crossings per line
        let i = xs.length;
        xs.push(x);
        ws.push(e[4]!);
        while (i > 0 && xs[i - 1]! > x) {
          xs[i] = xs[i - 1]!;
          ws[i] = ws[i - 1]!;
          i--;
        }
        xs[i] = x;
        ws[i] = e[4]!;
      }
      let winding = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        winding += ws[i]!;
        const inside = evenOdd ? (winding & 1) !== 0 : winding !== 0;
        if (!inside) continue;
        any = true;
        // span [xs[i], xs[i+1]) clipped to the canvas
        const xa = Math.max(0, xs[i]!), xb = Math.min(w, xs[i + 1]!);
        if (xb <= xa) continue;
        const ia = Math.floor(xa), ib = Math.floor(xb);
        if (ia === ib) partial[ia]! += (xb - xa) * weight;
        else {
          partial[ia]! += (ia + 1 - xa) * weight;
          diff[ia + 1]! += weight;
          diff[ib]! -= weight;
          if (ib < w) partial[ib]! += (xb - ib) * weight;
        }
      }
    }
    if (!any) continue;
    let run = 0;
    const o = row * w;
    for (let x = 0; x < w; x++) {
      run += diff[x]!;
      cov[o + x] = Math.min(1, partial[x]! + run);
    }
  }
  return cov;
}

