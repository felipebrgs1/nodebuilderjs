import { Column, Icon, Row, Scroll, Spacer, Text, Toggle, Window, colorScheme, setTheme, theme } from "@nodebuilderjs/core";
import { Activity } from "./components/Activity.js";
import { Counter } from "./components/Counter.js";
import { Tasks } from "./components/Tasks.js";
import { sparkle } from "./icons.js";
import { createState } from "./state.js";

export function App() {
  const state = createState();
  return (
    <Window title="{{title}}" appId="{{appId}}" width={720} height={760}>
      <Scroll grow={1} padding={20} gap={16}>
        <Row gap={12} align="center">
          {/* Theme colors go inside functions, so they follow a theme switch. */}
          <Icon svg={sparkle} size={32} color={() => theme.accent.base} />
          <Column gap={2} grow={1}>
            <Text fontSize={22} bold>{"{{title}}"}</Text>
            <Text color={() => theme.text.secondary}>Edit src/App.tsx and save: bun run dev reopens the window.</Text>
          </Column>
          <Spacer size={8} />
          <Toggle checked={() => colorScheme() === "dark"} onChange={(on) => setTheme(on ? "dark" : "light")} label="Dark" />
        </Row>
        <Row gap={16} align="start">
          <Column grow={1} gap={16}>
            <Counter state={state} />
            <Activity state={state} />
          </Column>
          <Column grow={1}>
            <Tasks state={state} />
          </Column>
        </Row>
      </Scroll>
    </Window>
  );
}
