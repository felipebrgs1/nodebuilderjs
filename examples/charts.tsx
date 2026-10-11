// @nodebuilderjs/core/charts: the Recharts API shape, drawn by nodebuilder. LIVE=0 freezes the data.
import { Card, Column, Row, Scroll, Text, Window, createSignal, requestAnimationFrame, run } from "@nodebuilderjs/core";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis,
} from "@nodebuilderjs/core/charts";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
let seed = 11;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const sales = MONTHS.map((mes, i) => ({ mes, vendas: Math.round(40 + i * 6 + rand() * 30), meta: 60 + i * 5, custo: Math.round(20 + rand() * 40) }));
const share = [{ canal: "Loja", valor: 42 }, { canal: "Site", valor: 31 }, { canal: "App", valor: 19 }, { canal: "Parceiros", valor: 8 }];

const [live, setLive] = createSignal(Array.from({ length: 40 }, (_, i) => ({ t: i, cpu: 40 + Math.sin(i / 4) * 20 })));
if (process.env.LIVE !== "0") {
  let t = 40;
  const loop = () => {
    setLive((d) => [...d.slice(1), { t: t++, cpu: Math.max(0, Math.min(100, d[d.length - 1]!.cpu + (rand() - 0.5) * 14)) }]);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

run(() => (
  <Window title="Gráficos" width={900} height={720}>
    <Scroll grow={1} padding={20} gap={16}>
      <Card gap={8}>
        <Text bold>Vendas x meta</Text>
        <LineChart data={sales} height={220}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="mes" />
          <YAxis />
          <Line dataKey="vendas" name="Vendas" />
          <Line dataKey="meta" name="Meta" stroke="#e5a50a" dot={false} />
          <Tooltip />
          <Legend />
        </LineChart>
      </Card>
      <Row gap={16}>
        <Card gap={8} grow={1}>
          <Text bold>CPU (ao vivo)</Text>
          <AreaChart data={live} height={180}>
            <CartesianGrid vertical={false} />
            <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Area dataKey="cpu" type="monotone" stroke="#26a269" />
          </AreaChart>
        </Card>
        <Card gap={8} width={300}>
          <Text bold>Canais</Text>
          <PieChart height={180}>
            <Pie data={share} dataKey="valor" nameKey="canal" innerRadius="45%" paddingAngle={2} />
            <Legend />
          </PieChart>
        </Card>
      </Row>
      <Row gap={16}>
        <Card gap={8} grow={1}>
          <Text bold>Receita e custo por mês</Text>
          <BarChart data={sales.slice(0, 6)} height={200}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="mes" />
            <YAxis />
            <Bar dataKey="vendas" name="Receita" radius={3} />
            <Bar dataKey="custo" name="Custo" fill="#e01b24" radius={3} />
            <Legend />
          </BarChart>
        </Card>
        <Card gap={8} width={300}>
          <Text bold>Pizza</Text>
          <PieChart height={200}>
            <Pie data={share} dataKey="valor" nameKey="canal">
              <Cell fill="#1c71d8" /><Cell fill="#26a269" /><Cell fill="#e5a50a" /><Cell fill="#9141ac" />
            </Pie>
          </PieChart>
        </Card>
      </Row>
    </Scroll>
  </Window>
));
