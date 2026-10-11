// Configuration children, read by the chart that contains them (like Recharts): they draw
// nothing themselves and render nothing outside a chart.

export type Row = Record<string, unknown>;
/** A field of each data row, or a function computing the value. */
export type DataKey = string | ((row: Row) => unknown);
export type Curve = "linear" | "monotone";

/** Dash pattern as SVG writes it ("4 2") or as numbers. */
export type DashArray = string | readonly number[];

export interface LineProps { dataKey: DataKey; name?: string; stroke?: string; strokeWidth?: number; strokeDasharray?: DashArray; dot?: boolean; type?: Curve }
export interface AreaProps { dataKey: DataKey; name?: string; stroke?: string; fill?: string; fillOpacity?: number; strokeWidth?: number; type?: Curve; stackId?: string | number }
export interface BarProps {
  dataKey: DataKey;
  name?: string;
  fill?: string;
  radius?: number;
  /** Bars with the same stackId pile up in one column. */
  stackId?: string | number;
  /** The value above each bar (true) or a formatter for it. */
  label?: boolean | ((value: number) => string);
}
export interface XAxisProps { dataKey?: DataKey; hide?: boolean; tickFormatter?: (value: unknown, index: number) => string }
export interface YAxisProps { hide?: boolean; domain?: [number, number]; tickCount?: number; tickFormatter?: (value: number, index: number) => string }
export interface CartesianGridProps { horizontal?: boolean; vertical?: boolean; stroke?: string; strokeDasharray?: DashArray }
export interface LegendProps {}
export interface TooltipProps {
  /** Formats each value (the series name is shown before it). */
  formatter?: (value: unknown, name: string) => string;
  /** Formats the title (the category of the hovered point). */
  labelFormatter?: (label: unknown) => string;
}
export interface PieProps {
  data?: readonly Row[];
  dataKey: DataKey;
  nameKey?: DataKey;
  innerRadius?: number | string;
  outerRadius?: number | string;
  /** Gap between slices, in degrees (like Recharts). */
  paddingAngle?: number;
  /** Text outside each slice: its value (true) or a function of name, value and percent (0..1). */
  label?: boolean | ((slice: { name: string; value: number; percent: number }) => string);
  children?: unknown;
}
export interface CellProps { fill: string }

export const Line = (_: LineProps) => null;
export const Area = (_: AreaProps) => null;
export const Bar = (_: BarProps) => null;
export const XAxis = (_: XAxisProps) => null;
export const YAxis = (_: YAxisProps) => null;
export const CartesianGrid = (_: CartesianGridProps) => null;
export const Legend = (_: LegendProps) => null;
/** Shows the values under the pointer: the nearest category, or the hovered slice. */
export const Tooltip = (_: TooltipProps) => null;
export const Pie = (_: PieProps) => null;
export const Cell = (_: CellProps) => null;
