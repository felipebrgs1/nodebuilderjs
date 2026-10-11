import { Button, Card, Icon, Row, Text, theme } from "@nodebuilderjs/core";
import type { Estado } from "../estado.js";
import { ponteiro } from "../icones.js";

export function Contador(props: { estado: Estado }) {
  const { cliques, clicar, zerar } = props.estado;
  // Só funções são reativas: `vezes` é lida pelo Text sempre que `cliques` muda.
  const vezes = () => `Você clicou ${cliques()} ${cliques() === 1 ? "vez" : "vezes"}`;
  return (
    <Card gap={12}>
      <Row gap={8} align="center" color={theme.text.secondary}>
        <Icon svg={ponteiro} size={16} />
        <Text bold>Contador</Text>
      </Row>
      <Text fontSize={20}>{vezes}</Text>
      <Row gap={8}>
        <Button label="Zerar" variant="flat" onClick={zerar} />
        <Button label="Clique aqui" variant="primary" onClick={clicar} />
      </Row>
    </Card>
  );
}
