// Overlays: a dropdown anchored to a button, a modal dialog that fades and slides in, and
// a hint shown on hover. Also exercises opacity and translateY.
// OPEN=menu|dialogo|dica starts with one of them open (for screenshots).

import {
  Box, Button, Card, Column, For, Overlay, Row, Show, Text, Window, createSignal, requestAnimationFrame, run, theme,
} from "@nodebuilderjs/core";
import type { ElementRef } from "@nodebuilderjs/core";

const FRUITS = ["Maçã", "Banana", "Laranja", "Uva", "Manga"];
const initial = process.env.OPEN;

function Dropdown() {
  const [open, setOpen] = createSignal(initial === "menu");
  const [choice, setChoice] = createSignal(FRUITS[0]!);
  let trigger: ElementRef | undefined;
  return (
    <Column gap={6} align="start">
      <Text color={theme.text.secondary}>Fruta</Text>
      <Button ref={(el) => (trigger = el)} width={180} label={choice} onClick={() => setOpen((o) => !o)} />
      <Show when={open}>
        <Overlay anchor={() => trigger} matchWidth onDismiss={() => setOpen(false)}>
          <Card padding={4} gap={0} shadow={{ color: "#00000030", blur: 16, y: 4 }}>
            <For each={FRUITS}>
              {(fruit) => <Option label={fruit} onPick={() => (setChoice(fruit), setOpen(false))} />}
            </For>
          </Card>
        </Overlay>
      </Show>
    </Column>
  );
}

function Option(props: { label: string; onPick: () => void }) {
  const [hover, setHover] = createSignal(false);
  return (
    <Box
      padding={[8, 10]} radius={6} cursor="pointer"
      background={() => (hover() ? theme.control.hover : "transparent")}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onClick={props.onPick}
    >
      <Text>{props.label}</Text>
    </Box>
  );
}

/** 0 -> 1 over `ms`, eased; calls `step` every frame. */
function animate(ms: number, step: (t: number) => void, done?: () => void) {
  const start = performance.now();
  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    step(1 - (1 - t) ** 3);
    if (t < 1) requestAnimationFrame(frame);
    else done?.();
  };
  requestAnimationFrame(frame);
}

function Dialog() {
  const [open, setOpen] = createSignal(initial === "dialogo");
  const [progress, setProgress] = createSignal(open() ? 1 : 0);
  const show = () => {
    setOpen(true);
    animate(180, setProgress);
  };
  const hide = () => animate(140, (t) => setProgress(1 - t), () => setOpen(false));
  return (
    <>
      <Button label="Abrir diálogo" variant="primary" onClick={show} />
      <Show when={open}>
        <Overlay modal background="#00000059" align="center" justify="center" opacity={progress} onDismiss={hide}>
          <Card width={320} gap={12} translateY={() => (1 - progress()) * 24} shadow={{ color: "#00000040", blur: 24, y: 8 }}>
            <Text fontSize={18} bold>Excluir arquivo?</Text>
            <Text color={theme.text.secondary}>Esta ação não pode ser desfeita.</Text>
            <Row gap={8} justify="end">
              <Button label="Cancelar" variant="flat" onClick={hide} />
              <Button label="Excluir" variant="danger" onClick={hide} />
            </Row>
          </Card>
        </Overlay>
      </Show>
    </>
  );
}

function Hint() {
  const [hover, setHover] = createSignal(initial === "dica");
  let target: ElementRef | undefined;
  return (
    <>
      <Box
        ref={(el) => (target = el)} padding={[6, 10]} radius={6} background={theme.control.base}
        onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
      >
        <Text>Passe o mouse aqui</Text>
      </Box>
      <Show when={hover}>
        <Overlay anchor={() => target} placement="right" offset={8}>
          <Box padding={[6, 10]} radius={6} background="#1f1f24e6">
            <Text color="#ffffff">Uma dica flutuante</Text>
          </Box>
        </Overlay>
      </Show>
    </>
  );
}

run(() => (
  <Window title="Overlays" width={560} height={420}>
    <Column grow={1} padding={24} gap={24} align="start">
      <Dropdown />
      <Dialog />
      <Hint />
    </Column>
  </Window>
));
