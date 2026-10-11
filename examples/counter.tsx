import { Button, Column, Row, Text, Window, createMemo, createSignal, run } from "@nodebuilderjs/core";

function Counter() {
  const [count, setCount] = createSignal(0);
  const parity = createMemo(() => (count() % 2 === 0 ? "par" : "ímpar"));

  return (
    <Window title="Contador" width={420} height={320}>
      <Column grow={1} align="center" justify="center" gap={16} padding={24}>
        <Text fontSize={48} bold>
          {count}
        </Text>
        <Text color="#6b6b76">O número é {parity}</Text>
        <Row gap={8}>
          <Button label="−1" onClick={() => setCount((c) => c - 1)} />
          <Button label="Zerar" variant="flat" onClick={() => setCount(0)} />
          <Button label="+1" variant="primary" onClick={() => setCount((c) => c + 1)} />
        </Row>
      </Column>
    </Window>
  );
}

run(() => <Counter />);
