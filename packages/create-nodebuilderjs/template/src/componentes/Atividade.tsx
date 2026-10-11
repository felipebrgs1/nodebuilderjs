import { Card, Icon, Row, Text, theme } from "@nodebuilderjs/core";
import { Area, AreaChart, CartesianGrid, Legend, Line, Tooltip, YAxis } from "@nodebuilderjs/core/charts";
import type { Estado } from "../estado.js";
import { grafico } from "../icones.js";

export function Atividade(props: { estado: Estado }) {
  return (
    <Card gap={8}>
      <Row gap={8} align="center" color={theme.text.secondary}>
        <Icon svg={grafico} size={16} />
        <Text bold>Atividade</Text>
      </Row>
      {/* data é um signal: o gráfico acompanha cada clique e cada tarefa. */}
      <AreaChart data={props.estado.historico} height={180}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <YAxis />
        <Area dataKey="cliques" name="Cliques" type="monotone" />
        <Line dataKey="pendentes" name="Pendentes" stroke="#e5a50a" dot={false} />
        <Tooltip />
        <Legend />
      </AreaChart>
    </Card>
  );
}
