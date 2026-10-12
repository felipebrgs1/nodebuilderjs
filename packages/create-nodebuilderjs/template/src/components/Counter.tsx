import { Button, Card, Icon, Row, Text, Tooltip, theme } from "@nodebuilderjs/core";
import { pointer } from "../icons.js";
import type { State } from "../state.js";

export function Counter(props: { state: State }) {
  const { clicks, click, reset } = props.state;
  // Only functions are reactive: Text reads `times` again whenever `clicks` changes.
  const times = () => `You clicked ${clicks()} ${clicks() === 1 ? "time" : "times"}`;
  return (
    <Card gap={12}>
      <Row gap={8} align="center" color={() => theme.text.secondary}>
        <Icon svg={pointer} size={16} />
        <Text bold>Counter</Text>
      </Row>
      <Text fontSize={20}>{times}</Text>
      <Row gap={8}>
        <Tooltip text="Back to zero">
          <Button label="Reset" variant="flat" onClick={reset} disabled={() => clicks() === 0} />
        </Tooltip>
        <Button label="Click me" variant="primary" onClick={click} />
      </Row>
    </Card>
  );
}
