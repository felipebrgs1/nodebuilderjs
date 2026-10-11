import { Button, Column, Row, Text, Window, createSignal, theme } from "@nodebuilderjs/core";

export function App() {
  const [count, setCount] = createSignal(0);
  const times = () => `Você clicou ${count()} ${count() === 1 ? "vez" : "vezes"}`;

  return (
    <Window title="{{title}}" appId="{{appId}}" width={480} height={360}>
      <Column grow={1} align="center" justify="center" gap={16} padding={24}>
        <Text fontSize={24} bold>
          {"{{title}}"}
        </Text>
        <Text color={theme.text.secondary}>{times}</Text>
        <Row gap={8}>
          <Button label="Zerar" variant="flat" onClick={() => setCount(0)} />
          <Button label="Clique aqui" variant="primary" onClick={() => setCount((c) => c + 1)} />
        </Row>
        <Text fontSize={12} color={theme.text.secondary}>
          Edite src/App.tsx e salve: o bun run dev reabre a janela.
        </Text>
      </Column>
    </Window>
  );
}
