// System tray: closing the window hides it to the tray; the tray's menu shows it again,
// counts, toggles a setting and quits.
import { Button, Column, Row, Text, Window, createSignal, createTray, run, windowControls, windowState } from "@nodebuilderjs/core";

run(() => {
  const [count, setCount] = createSignal(0);
  const [muted, setMuted] = createSignal(false);
  let quitting = false;
  const quit = () => {
    quitting = true;
    windowControls.close();
  };
  const toggleWindow = () => (windowState.visible() ? windowControls.hide() : windowControls.show());

  const tray = createTray({
    tooltip: () => `Count: ${count()}`,
    title: "Tray example",
    onClick: toggleWindow,
    menu: () => [
      { label: windowState.visible() ? "Hide window" : "Show window", onClick: toggleWindow },
      { label: "Count +1", onClick: () => setCount((c) => c + 1) },
      { label: "Mute", checked: muted(), onClick: () => setMuted((m) => !m) },
      "separator",
      { label: "Quit", onClick: quit },
    ],
  });

  return (
    <Window title="Tray" width={420} height={260} onClose={() => quitting || !tray.available() || (windowControls.hide(), false)}>
      <Column grow={1} align="center" justify="center" gap={14}>
        <Text fontSize={40} bold>{count}</Text>
        <Text>{() => (tray.available() ? "Close the window: it goes to the tray." : "No system tray here: closing quits.")}</Text>
        <Text>{() => (muted() ? "Muted" : "Not muted")}</Text>
        <Row gap={8}>
          <Button label="+1" variant="primary" onClick={() => setCount((c) => c + 1)} />
          <Button label="Quit" variant="flat" onClick={quit} />
        </Row>
      </Column>
    </Window>
  );
});
