---
name: nodebuilder-charts
description: Line, area, bar, composed and pie/donut charts in nodebuilder with @nodebuilderjs/core/charts, which uses the same API as Recharts. Use when building dashboards, reports, time series, category comparisons or share breakdowns (pie), and whenever you would reach for Recharts, Chart.js or Victory.
---

# Charts with `@nodebuilderjs/core/charts`

Already ships with `@nodebuilderjs/core` (install nothing); it only ends up in the app if imported.

```tsx
import { createSignal, theme } from "@nodebuilderjs/core";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, XAxis, YAxis,
} from "@nodebuilderjs/core/charts";

const [sales] = createSignal([
  { month: "Jan", revenue: 120, target: 100 },
  { month: "Feb", revenue: 150, target: 110 },
  { month: "Mar", revenue: 90, target: 120 },
]);
const channels = [{ name: "Store", value: 42 }, { name: "Website", value: 31 }];

export const charts = () => (
  <>
    <LineChart data={sales} height={240}>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="month" />
      <YAxis tickFormatter={(v) => `$${v}`} />
      <Line dataKey="revenue" name="Revenue" />
      <Line dataKey="target" name="Target" stroke="#e5a50a" type="monotone" dot={false} />
      <Legend />
    </LineChart>
    <BarChart data={sales} height={200}>
      <XAxis dataKey="month" />
      <YAxis />
      <Bar dataKey="revenue" fill={theme.accent.base} radius={3} />
    </BarChart>
    <AreaChart data={sales} height={160}>
      <YAxis domain={[0, 200]} />
      <Area dataKey="revenue" type="monotone" />
    </AreaChart>
    <PieChart height={220}>
      <Pie data={channels} dataKey="value" nameKey="name" innerRadius="50%" paddingAngle={2}>
        <Cell fill="#3584e4" />
        <Cell fill="#26a269" />
      </Pie>
      <Legend />
    </PieChart>
  </>
);
```

## What is supported

| Component | Props |
|---|---|
| `LineChart`, `AreaChart`, `BarChart`, `ComposedChart` (mixed) | `data` (array or signal), `height` (240), `width` or `grow`, and the style props |
| `Line` | `dataKey`, `name`, `stroke`, `strokeWidth` (2), `strokeDasharray` (`"6 4"`), `dot` (true), `type` (`linear`/`monotone`) |
| `Area` | `dataKey`, `name`, `stroke`, `fill`, `fillOpacity` (0.25), `type`, `stackId` |
| `Bar` | `dataKey`, `name`, `fill`, `radius`, `stackId`, `label` (true or `(value) => text`) |
| `XAxis` | `dataKey`, `tickFormatter`, `hide` |
| `YAxis` | `domain={[min, max]}`, `tickCount`, `tickFormatter`, `hide` |
| `CartesianGrid` | `horizontal`, `vertical`, `stroke`, `strokeDasharray` |
| `PieChart` + `Pie` | `data`, `dataKey`, `nameKey`, `innerRadius`, `outerRadius` (px or `"80%"`), `paddingAngle` (degrees), `label` (true or `({ name, value, percent }) => text`); `<Cell fill>` per slice |
| `Tooltip` | `formatter(value, name)`, `labelFormatter(category)`; guide line at the category under the mouse (on a pie: the slice) |
| `Legend` | no props (bottom, centered) |

`dataKey` is the field name or a function `(row) => value`.

## Differences from Recharts

- **No `ResponsiveContainer`:** the chart already fills the parent's width; give it a `height`.
- Series with the same `stackId` stack (bars in a single column, areas on top of each other);
  the y axis accounts for the totals.
- The x axis drops labels that would overlap, keeping the last one (like `interval="preserveEnd"`).
- Not available yet: `Brush`, `ReferenceLine`, `ScatterChart`, `RadarChart`, secondary
  axes, animations; on `Line`, `label`.
- Pies start at the top and go clockwise (`startAngle`/`endAngle` do not exist); the
  labels sit outside the slices, so keep `outerRadius` around 70% for them to fit.
- Colors: without `stroke`/`fill`, each series takes the next palette color (the first is
  `theme.accent.base`).
- For anything beyond this, draw with `<Canvas>` (skill `nodebuilder-drawing`).

## Performance

Changing the `data` signal redraws only that chart. Updating every frame (live data
with `requestAnimationFrame`) works; hundreds of points per series are fine.
