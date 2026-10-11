// <Canvas>: lines, filled polygons and arcs drawn by the GPU with antialiasing.
// LIVE=0 freezes the data (for screenshots and measurements).
import { Card, Canvas, Column, Row, Scroll, Text, Window, createSignal, requestAnimationFrame, run, theme } from "@nodebuilderjs/core";

const LIVE = process.env.LIVE !== "0";
const POINTS = 60;
let seed = 3;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const [series, setSeries] = createSignal(Array.from({ length: POINTS }, (_, i) => 50 + Math.sin(i / 6) * 25 + rand() * 15));
const [tick, setTick] = createSignal(0);

if (LIVE) {
  const loop = () => {
    setSeries((s) => [...s.slice(1), Math.max(5, Math.min(95, s[s.length - 1]! + (rand() - 0.5) * 12))]);
    setTick((t) => t + 1);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function LineChart() {
  return (
    <Canvas height={180} draw={(g) => {
      const data = series();
      const x = (i: number) => (i / (data.length - 1)) * g.width;
      const y = (v: number) => g.height - (v / 100) * g.height;
      for (let v = 0; v <= 100; v += 25) g.line(0, y(v), g.width, y(v), "#0000001a", 1, "butt"); // grid
      const line = data.flatMap((v, i) => [x(i), y(v)]);
      g.polygon([0, g.height, ...line, g.width, g.height], "#3584e433");
      g.polyline(line, theme.accent.base, 2);
      g.circle(x(data.length - 1), y(data[data.length - 1]!), 4, theme.accent.base);
    }} />
  );
}

function Donut() {
  const parts = [["#3584e4", 0.42], ["#26a269", 0.27], ["#e5a50a", 0.18], ["#e01b24", 0.13]] as const;
  return (
    <Canvas width={160} height={160} draw={(g) => {
      let start = (tick() / 120) % (2 * Math.PI);
      for (const [color, share] of parts) {
        g.arc(80, 80, 70, 44, start, share * 2 * Math.PI - 0.03, color);
        start += share * 2 * Math.PI;
      }
      g.text("42%", 62, 70, theme.text.primary, 18, true);
    }} />
  );
}

function Pie() {
  return (
    <Canvas width={160} height={160} draw={(g) => {
      g.arc(80, 80, 70, 0, 0, Math.PI * 1.2, "#3584e4");
      g.arc(80, 80, 70, 0, Math.PI * 1.2, Math.PI * 0.5, "#9141ac");
      g.arc(80, 80, 70, 0, Math.PI * 1.7, Math.PI * 0.3, "#26a269");
    }} />
  );
}

function Strokes() {
  return (
    <Canvas height={120} draw={(g) => {
      const caps = ["butt", "round", "square"] as const;
      caps.forEach((cap, i) => {
        g.line(20, 20 + i * 30, 160, 20 + i * 30, "#1f1f24", 12, cap);
        g.line(20, 20 + i * 30, 160, 20 + i * 30, "#e01b24", 1, "butt");
      });
      [0.5, 1, 1.5, 2, 4, 8].forEach((w, i) => g.line(200 + i * 30, 10, 220 + i * 30, 100, "#1f1f24", w));
      g.polyline([400, 100, 430, 20, 460, 100, 490, 20], theme.accent.base, 6, { cap: "round" });
      g.polygon([520, 20, 580, 20, 580, 50, 550, 50, 550, 100, 520, 100], "#e5a50a"); // concave
    }} />
  );
}

run(() => (
  <Window title="Desenho" width={720} height={640}>
    <Scroll grow={1} padding={20} gap={16}>
      <Card gap={8}>
        <Text bold>Linha com área (dados ao vivo)</Text>
        <LineChart />
      </Card>
      <Row gap={16}>
        <Card gap={8} align="center"><Text bold>Rosca</Text><Donut /></Card>
        <Card gap={8} align="center"><Text bold>Pizza</Text><Pie /></Card>
      </Row>
      <Card gap={8}>
        <Text bold>Pontas, espessuras e polígonos</Text>
        <Strokes />
      </Card>
    </Scroll>
  </Window>
));
