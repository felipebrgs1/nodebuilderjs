// Configuration children, read by the chart that contains them (like Recharts): they draw
// nothing themselves and render nothing outside a chart.

export type Row = Record<string, unknown>;
/** A field of each data row, or a function computing the value. */
export type DataKey = string | ((row: Row) => unknown);
export type Curve = "linear" | "monotone";

export interface LineProps { dataKey: DataKey; name?: string; stroke?: string; strokeWidth?: number; dot?: boolean; type?: Curve }
export interface AreaProps { dataKey: DataKey; name?: string; stroke?: string; fill?: string; fillOpacity?: number; strokeWidth?: number; type?: Curve }
export interface BarProps { dataKey: DataKey; name?: string; fill?: string; radius?: number }
export interface XAxisProps { dataKey?: DataKey; hide?: boolean; tickFormatter?: (value: unknown, index: number) => string }
export interface YAxisProps { hide?: boolean; domain?: [number, number]; tickCount?: number; tickFormatter?: (value: number, index: number) => string }
export interface CartesianGridProps { horizontal?: boolean; vertical?: boolean; stroke?: string }
export interface LegendProps {}
export interface TooltipProps {}
export interface PieProps {
  data?: readonly Row[];
  dataKey: DataKey;
  nameKey?: DataKey;
  innerRadius?: number | string;
  outerRadius?: number | string;
  /** Gap between slices, in degrees (like Recharts). */
  paddingAngle?: number;
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
/** Accepted so Recharts code keeps working; hover tooltips are not implemented yet. */
export const Tooltip = (_: TooltipProps) => null;
export const Pie = (_: PieProps) => null;
export const Cell = (_: CellProps) => null;
