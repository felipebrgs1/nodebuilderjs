---
name: nodebuilder-graficos
description: Gráficos de linha, área, barra, composto e pizza/rosca no nodebuilder com @nodebuilderjs/core/charts, que usa a mesma API do Recharts. Use ao criar dashboards, relatórios, séries temporais, comparações por categoria ou participação (pizza), e sempre que pensaria em usar Recharts, Chart.js ou Victory.
---

# Gráficos com `@nodebuilderjs/core/charts`

Já vem no `@nodebuilderjs/core` (não instale nada); só entra no app se for importado.

```tsx
import { createSignal, theme } from "@nodebuilderjs/core";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, XAxis, YAxis,
} from "@nodebuilderjs/core/charts";

const [vendas] = createSignal([
  { mes: "jan", receita: 120, meta: 100 },
  { mes: "fev", receita: 150, meta: 110 },
  { mes: "mar", receita: 90, meta: 120 },
]);
const canais = [{ nome: "Loja", valor: 42 }, { nome: "Site", valor: 31 }];

export const graficos = () => (
  <>
    <LineChart data={vendas} height={240}>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="mes" />
      <YAxis tickFormatter={(v) => `R$ ${v}`} />
      <Line dataKey="receita" name="Receita" />
      <Line dataKey="meta" name="Meta" stroke="#e5a50a" type="monotone" dot={false} />
      <Legend />
    </LineChart>
    <BarChart data={vendas} height={200}>
      <XAxis dataKey="mes" />
      <YAxis />
      <Bar dataKey="receita" fill={theme.accent.base} radius={3} />
    </BarChart>
    <AreaChart data={vendas} height={160}>
      <YAxis domain={[0, 200]} />
      <Area dataKey="receita" type="monotone" />
    </AreaChart>
    <PieChart height={220}>
      <Pie data={canais} dataKey="valor" nameKey="nome" innerRadius="50%" paddingAngle={2}>
        <Cell fill="#3584e4" />
        <Cell fill="#26a269" />
      </Pie>
      <Legend />
    </PieChart>
  </>
);
```

## O que é suportado

| Componente | Props |
|---|---|
| `LineChart`, `AreaChart`, `BarChart`, `ComposedChart` (mistura) | `data` (array ou signal), `height` (240), `width` ou `grow` e as props de estilo |
| `Line` | `dataKey`, `name`, `stroke`, `strokeWidth` (2), `strokeDasharray` (`"6 4"`), `dot` (true), `type` (`linear`/`monotone`) |
| `Area` | `dataKey`, `name`, `stroke`, `fill`, `fillOpacity` (0,25), `type`, `stackId` |
| `Bar` | `dataKey`, `name`, `fill`, `radius`, `stackId`, `label` (true ou `(valor) => texto`) |
| `XAxis` | `dataKey`, `tickFormatter`, `hide` |
| `YAxis` | `domain={[min, max]}`, `tickCount`, `tickFormatter`, `hide` |
| `CartesianGrid` | `horizontal`, `vertical`, `stroke`, `strokeDasharray` |
| `PieChart` + `Pie` | `data`, `dataKey`, `nameKey`, `innerRadius`, `outerRadius` (px ou `"80%"`), `paddingAngle` (graus), `label` (true ou `({ name, value, percent }) => texto`); `<Cell fill>` por fatia |
| `Tooltip` | `formatter(valor, nome)`, `labelFormatter(categoria)`; linha-guia na categoria sob o mouse (na pizza: a fatia) |
| `Legend` | sem props (embaixo, centralizada) |

`dataKey` é o nome do campo ou uma função `(linha) => valor`.

## Diferenças do Recharts

- **Sem `ResponsiveContainer`:** o gráfico já ocupa a largura do pai; dê `height`.
- Séries com o mesmo `stackId` se empilham (barras numa coluna só, áreas uma sobre a outra);
  o eixo y considera os totais.
- O eixo x omite rótulos que se sobreporiam, mantendo o último (como `interval="preserveEnd"`).
- Não existem ainda: `Brush`, `ReferenceLine`, `ScatterChart`, `RadarChart`, eixos
  secundários, animações; em `Line`, o `label`.
- Pizza começa no topo e gira no sentido horário (`startAngle`/`endAngle` não existem); os
  rótulos ficam fora das fatias, então deixe `outerRadius` em ~70% para caberem.
- Cores: sem `stroke`/`fill`, cada série pega a próxima cor da paleta (a primeira é
  `theme.accent.base`).
- Para algo fora disso, desenhe com `<Canvas>` (skill `nodebuilder-desenho`).

## Desempenho

Mudar o signal de `data` redesenha só aquele gráfico. Atualizar a cada frame (dados ao
vivo com `requestAnimationFrame`) funciona; centenas de pontos por série são tranquilos.
