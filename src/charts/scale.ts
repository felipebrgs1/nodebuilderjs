// Axis scales. Tick steps follow d3's choice (1, 2 or 5 times a power of ten, whichever
// gives closest to the requested count), so axes read like every other chart library.

export interface NiceScale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

const E10 = Math.sqrt(50), E5 = Math.sqrt(10), E2 = Math.sqrt(2);

/**
 * Step as an integer to multiply (positive) or the inverse of a fraction to divide by
 * (negative, e.g. -5 = 1/5): this keeps ticks free of floating point noise.
 */
function increment(start: number, stop: number, count: number): number {
  const step = (stop - start) / Math.max(1, count);
  const power = Math.floor(Math.log10(step));
  const error = step / 10 ** power;
  const factor = error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1;
  return power >= 0 ? factor * 10 ** power : -(10 ** -power) / factor;
}

/** A readable axis for [min, max]: round bounds and about `count` evenly spaced ticks. */
export function niceScale(min: number, max: number, count = 5): NiceScale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) [min, max] = [0, 1];
  if (min > max) [min, max] = [max, min];
  if (min === max) [min, max] = min > 0 ? [0, min] : min < 0 ? [min, 0] : [0, 1];

  let inc = increment(min, max, count);
  for (let i = 0; i < 10; i++) {
    const next = increment(...bounds(min, max, inc), count);
    [min, max] = bounds(min, max, inc);
    if (next === inc) break;
    inc = next;
  }
  const ticks: number[] = [];
  if (inc > 0) for (let i = Math.round(min / inc); i * inc <= max + inc * 1e-9; i++) ticks.push(i * inc);
  else for (let i = Math.round(min * -inc); i / -inc <= max - 1e-12 / inc; i++) ticks.push(i / -inc);
  return { min, max, step: inc > 0 ? inc : 1 / -inc, ticks };
}

function bounds(min: number, max: number, inc: number): [number, number] {
  return inc > 0
    ? [Math.floor(min / inc) * inc, Math.ceil(max / inc) * inc]
    : [Math.ceil(min * inc) / inc, Math.floor(max * inc) / inc];
}
