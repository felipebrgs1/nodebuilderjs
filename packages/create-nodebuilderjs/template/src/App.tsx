import { Column, Icon, Row, Scroll, Text, Window, theme } from "@nodebuilderjs/core";
import { Atividade } from "./componentes/Atividade.js";
import { Contador } from "./componentes/Contador.js";
import { Tarefas } from "./componentes/Tarefas.js";
import { criarEstado } from "./estado.js";
import { brilho } from "./icones.js";

export function App() {
  const estado = criarEstado();
  return (
    <Window title="{{title}}" appId="{{appId}}" width={720} height={760}>
      <Scroll grow={1} padding={20} gap={16}>
        <Row gap={12} align="center">
          <Icon svg={brilho} size={32} color={theme.accent.base} />
          <Column gap={2}>
            <Text fontSize={22} bold>{"{{title}}"}</Text>
            <Text color={theme.text.secondary}>Edite src/App.tsx e salve: o bun run dev reabre a janela.</Text>
          </Column>
        </Row>
        <Row gap={16} align="start">
          <Column grow={1} gap={16}>
            <Contador estado={estado} />
            <Atividade estado={estado} />
          </Column>
          <Column grow={1}>
            <Tarefas estado={estado} />
          </Column>
        </Row>
      </Scroll>
    </Window>
  );
}
