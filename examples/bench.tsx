// Stress test. N cells; MODE=one changes one label per frame, MODE=all changes every label,
// MODE=static draws once and idles. Mirrored in compare/electron for comparison.
//   NB_STATS=1 N=1000 MODE=all bun examples/bench.tsx
import { Column, For, Row, Scroll, Text, Window, createSignal, requestAnimationFrame, run } from "@nodebuilderjs/core";

const N = Number(process.env.N ?? 1000);
const MODE = process.env.MODE ?? "one";
const COLS = 10;

const [tick, setTick] = createSignal(0);
const loop = () => {
  setTick((t) => t + 1);
  requestAnimationFrame(loop);
};
if (MODE !== "static") requestAnimationFrame(loop);

const rows = Array.from({ length: Math.ceil(N / COLS) }, (_, r) =>
  Array.from({ length: Math.min(COLS, N - r * COLS) }, (_, c) => r * COLS + c),
);
const hue = ["#e8f0fe", "#fde8e8", "#e6f4ea", "#fef7e0"];

function Cell(props: { i: number }) {
  const label = MODE === "all" ? () => `#${props.i} · ${(tick() + props.i) % 1000}` : `#${props.i}`;
  return (
    <Column grow={1} padding={[6, 8]} radius={6} background={hue[props.i % 4]} borderWidth={1} borderColor="#00000014">
      <Text fontSize={12}>{label}</Text>
    </Column>
  );
}

run(() => (
  <Window title={`Bench: ${N} células, modo ${MODE}`} width={1000} height={720}>
    <Column grow={1} padding={12} gap={8} minHeight={0}>
      <Text bold fontSize={16}>{() => `Frame ${tick()}`}</Text>
      <Scroll grow={1} gap={4}>
        <For each={rows}>
          {(row) => (
            <Row gap={4}>
              <For each={row}>{(i) => <Cell i={i} />}</For>
            </Row>
          )}
        </For>
      </Scroll>
    </Column>
  </Window>
));
