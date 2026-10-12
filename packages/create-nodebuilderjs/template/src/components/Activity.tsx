import { Card, Icon, Row, Text, theme } from "@nodebuilderjs/core";
import { Area, AreaChart, CartesianGrid, Legend, Line, Tooltip, YAxis } from "@nodebuilderjs/core/charts";
import { chart } from "../icons.js";
import type { State } from "../state.js";

export function Activity(props: { state: State }) {
  return (
    <Card gap={8}>
      <Row gap={8} align="center" color={() => theme.text.secondary}>
        <Icon svg={chart} size={16} />
        <Text bold>Activity</Text>
      </Row>
      {/* data is a signal: the chart follows every click and every task. */}
      <AreaChart data={props.state.history} height={180}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <YAxis />
        <Area dataKey="clicks" name="Clicks" type="monotone" />
        <Line dataKey="pending" name="Pending" stroke="#e5a50a" dot={false} />
        <Tooltip />
        <Legend />
      </AreaChart>
    </Card>
  );
}
