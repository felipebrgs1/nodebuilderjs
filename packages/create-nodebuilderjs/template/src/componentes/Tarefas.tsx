import { Button, Card, Checkbox, Column, For, Icon, Row, Show, Spacer, Text, TextField, createSignal, theme } from "@nodebuilderjs/core";
import type { Estado } from "../estado.js";
import { lista, mais } from "../icones.js";

export function Tarefas(props: { estado: Estado }) {
  const { tarefas, pendentes, adicionar, limparConcluidas } = props.estado;
  const [texto, setTexto] = createSignal("");
  const enviar = () => adicionar(texto()) && setTexto("");

  return (
    <Card gap={12}>
      <Row gap={8} align="center" color={theme.text.secondary}>
        <Icon svg={lista} size={16} />
        <Text bold>Tarefas</Text>
        <Spacer />
        <Text fontSize={12}>{() => `${pendentes()} ${pendentes() === 1 ? "pendente" : "pendentes"}`}</Text>
      </Row>
      <Row gap={8}>
        <TextField grow={1} value={texto} onInput={setTexto} onSubmit={enviar} placeholder="Nova tarefa" />
        <Button variant="primary" onClick={enviar} disabled={() => !texto().trim()}>
          <Icon svg={mais} size={16} />
          <Text>Adicionar</Text>
        </Button>
      </Row>
      <Column gap={8}>
        {/* For é keyed por referência: cada tarefa mantém seu estado ao reordenar. */}
        <For each={tarefas} fallback={<Text color={theme.text.secondary}>Nada por aqui.</Text>}>
          {(t) => <Checkbox checked={t.feita} onChange={t.marcar} label={t.titulo} />}
        </For>
      </Column>
      <Show when={() => tarefas().some((t) => t.feita())}>
        <Row>
          <Button label="Limpar concluídas" variant="flat" onClick={limparConcluidas} />
        </Row>
      </Show>
    </Card>
  );
}
