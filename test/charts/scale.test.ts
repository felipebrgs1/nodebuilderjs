import { describe, expect, test } from "bun:test";
import { niceScale } from "../../src/charts/scale.js";

describe("niceScale", () => {
  test("round bounds and steps of 1, 2 or 5 times a power of ten", () => {
    expect(niceScale(0, 97)).toEqual({ min: 0, max: 100, step: 20, ticks: [0, 20, 40, 60, 80, 100] });
    expect(niceScale(0, 1234)).toEqual({ min: 0, max: 1400, step: 200, ticks: [0, 200, 400, 600, 800, 1000, 1200, 1400] });
    expect(niceScale(12, 58).ticks).toEqual([10, 20, 30, 40, 50, 60]);
  });

  test("negative ranges and ranges across zero", () => {
    expect(niceScale(-37, 0).ticks).toEqual([-40, -30, -20, -10, 0]);
    expect(niceScale(-15, 42).ticks).toEqual([-20, -10, 0, 10, 20, 30, 40, 50]);
  });

  test("fractions come out without floating point noise", () => {
    expect(niceScale(0, 1).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceScale(0.1, 0.35).ticks).toEqual([0.1, 0.15, 0.2, 0.25, 0.3, 0.35]);
  });

  test("a single value or empty data still gives an axis", () => {
    expect(niceScale(5, 5).ticks).toEqual([0, 1, 2, 3, 4, 5]);
    expect(niceScale(0, 0).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceScale(-3, -3).ticks).toEqual([-3, -2.5, -2, -1.5, -1, -0.5, 0]);
  });

  test("the tick count is a hint", () => {
    expect(niceScale(0, 100, 10).step).toBe(10);
    expect(niceScale(0, 100, 2).step).toBe(50);
  });
});
