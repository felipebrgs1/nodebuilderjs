import {
  Button, Card, Checkbox, Column, Dialog, For, Icon, Row, Show, Spacer, Text, TextField, createSignal, theme,
} from "@nodebuilderjs/core";
import { list, plus } from "../icons.js";
import type { State } from "../state.js";

export function Tasks(props: { state: State }) {
  const { tasks, pending, add, clearCompleted } = props.state;
  const [text, setText] = createSignal("");
  const [confirming, setConfirming] = createSignal(false);
  const submit = () => add(text()) && setText("");
  const done = () => tasks().filter((t) => t.done()).length;

  return (
    <Card gap={12}>
      <Row gap={8} align="center" color={() => theme.text.secondary}>
        <Icon svg={list} size={16} />
        <Text bold>Tasks</Text>
        <Spacer />
        <Text fontSize={12}>{() => `${pending()} pending`}</Text>
      </Row>
      <Row gap={8}>
        <TextField grow={1} value={text} onInput={setText} onSubmit={submit} placeholder="New task" />
        <Button variant="primary" onClick={submit} disabled={() => !text().trim()}>
          <Icon svg={plus} size={16} />
          <Text>Add</Text>
        </Button>
      </Row>
      <Column gap={8}>
        {/* For is keyed by reference: each task keeps its state when the list is reordered. */}
        <For each={tasks} fallback={<Text color={() => theme.text.secondary}>Nothing here.</Text>}>
          {(t) => <Checkbox checked={t.done} onChange={t.mark} label={t.title} />}
        </For>
      </Column>
      <Show when={() => done() > 0}>
        <Row>
          <Button label="Clear completed" variant="flat" onClick={() => setConfirming(true)} />
        </Row>
      </Show>
      {/* A modal on top of the window: Escape or a click outside calls onClose. */}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Clear completed tasks?"
        actions={[
          <Button label="Cancel" variant="flat" onClick={() => setConfirming(false)} />,
          <Button label="Clear" variant="danger" onClick={() => (clearCompleted(), setConfirming(false))} />,
        ]}
      >
        <Text color={() => theme.text.secondary}>{() => `${done()} ${done() === 1 ? "task" : "tasks"} will be removed.`}</Text>
      </Dialog>
    </Card>
  );
}
