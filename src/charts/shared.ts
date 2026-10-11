// Pieces shared by the chart types: reading the configuration children, values and colors.

import { type ElementDesc, isElement } from "../jsx-runtime.js";
import { theme } from "../theme.js";
import type { DataKey, Row } from "./components.js";

/** Default series colors, in order. */
export const palette = () => [theme.accent.base, "#26a269", "#e5a50a", "#e01b24", "#9141ac", "#2ec27e", "#c64600", "#1c71d8"];

/** The configuration children (<Line>, <XAxis>...) as descriptions, without rendering them. */
export function configs(children: unknown): ElementDesc[] {
  const out: ElementDesc[] = [];
  const walk = (c: unknown) => {
    if (Array.isArray(c)) c.forEach(walk);
    else if (isElement(c)) out.push(c);
  };
  walk(children);
  return out;
}

export function value(row: Row, key: DataKey | undefined): unknown {
  if (key === undefined) return undefined;
  return typeof key === "function" ? key(row) : row[key];
}

export function number(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : NaN;
}

export const seriesName = (name: string | undefined, key: DataKey, index: number) =>
  name ?? (typeof key === "string" ? key : `Série ${index + 1}`);

/** A hex color with its alpha multiplied by `opacity` (other formats are returned as is). */
export function withOpacity(color: string, opacity: number): string {
  let hex = color.replace("#", "");
  if (!/^[0-9a-f]+$/i.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return color;
  if (hex.length <= 4) hex = [...hex].map((h) => h + h).join("");
  const alpha = hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1;
  const a = Math.round(Math.min(1, Math.max(0, alpha * opacity)) * 255);
  return `#${hex.slice(0, 6)}${a.toString(16).padStart(2, "0")}`;
}

/** Number labels with as many decimals as the step needs, in the system's locale. */
export function numberFormat(step: number) {
  const decimals = step > 0 && step < 1 ? Math.min(10, Math.ceil(-Math.log10(step) - 1e-9)) : 0;
  const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals });
  return (v: number) => format.format(v);
}

/** A radius as px or as a percentage ("80%") of `half`. */
export function radius(r: number | string | undefined, half: number, fallback: number): number {
  if (r === undefined) return fallback;
  if (typeof r === "number") return r;
  const n = parseFloat(r);
  return r.trim().endsWith("%") ? (half * n) / 100 : n;
}

export const LEGEND_HEIGHT = 24;
