import { Button, Card, Checkbox, Column, For, Row, Scroll, Show, Text, TextField, Window, createMemo, createSignal, run } from "@nodebuilderjs/core";

interface Todo {
  title: string;
  done: () => boolean;
  setDone: (v: boolean) => void;
}

function makeTodo(title: string, done = false): Todo {
  const [isDone, setDone] = createSignal(done);
  return { title, done: isDone, setDone };
}

function TodoApp() {
  const [todos, setTodos] = createSignal<Todo[]>([
    makeTodo("Abrir uma janela Wayland a partir do Node", true),
    makeTodo("Renderizar com GLES + FreeType/HarfBuzz", true),
    makeTodo("Layout flexbox em TypeScript", true),
    makeTodo("Escrever acentuação: ç, ã, é, ü"),
    makeTodo("Font fallback and color emoji: ▲ ↑ ✓ 🎉 👍🏽 👨‍👩‍👧 🇧🇷"),
  ]);
  const [draft, setDraft] = createSignal("");
  const remaining = createMemo(() => todos().filter((t) => !t.done()).length);

  const add = () => {
    const title = draft().trim();
    if (!title) return;
    setTodos((list) => [...list, makeTodo(title)]);
    setDraft("");
  };
  const remove = (todo: Todo) => setTodos((list) => list.filter((t) => t !== todo));
  const clearDone = () => setTodos((list) => list.filter((t) => !t.done()));

  return (
    <Window title="Tarefas" width={520} height={600}>
      <Column grow={1} padding={20} gap={14} minHeight={0}>
        <Row gap={8}>
          <TextField grow={1} value={draft} onInput={setDraft} onSubmit={add} placeholder="O que precisa ser feito?" />
          <Button label="Adicionar" variant="primary" onClick={add} />
        </Row>

        <Scroll grow={1} gap={8} padding={[0, 10, 0, 0]}>
          <For each={todos} fallback={<Text color="#9a9aa4">Nothing here 🎉</Text>}>
            {(todo) => (
              <Card direction="row" align="center" padding={[10, 12]}>
                <Checkbox checked={todo.done} onChange={todo.setDone} />
                <Text grow={1} color={() => (todo.done() ? "#9a9aa4" : "#1f1f24")}>
                  {todo.title}
                </Text>
                <Button label="Remover" variant="flat" padding={[6, 10]} onClick={() => remove(todo)} />
              </Card>
            )}
          </For>
        </Scroll>

        <Row align="center">
          <Text grow={1} color="#6b6b76">
            {() => `${remaining()} pendente${remaining() === 1 ? "" : "s"} de ${todos().length}`}
          </Text>
          <Show when={() => todos().length > remaining()}>
            <Button label="Limpar concluídas" variant="danger" onClick={clearDone} />
          </Show>
        </Row>
      </Column>
    </Window>
  );
}

run(() => <TodoApp />);
