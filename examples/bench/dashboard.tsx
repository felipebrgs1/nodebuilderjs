// Realistic app-shaped benchmark: sidebar, tabs, stat cards, a bar chart, a sortable/filterable
// table, a streaming log and a settings form. Mirrored in compare/electron (SCENE=dashboard).
//   NB_STATS=1 TAB=table ROWS=1000 bun examples/bench/dashboard.tsx
// Env: TAB=overview|table|logs|settings (initial tab), LIVE=0 (no data updates),
//      CYCLE=n (switch tab every n frames: measures mount/unmount), ROWS=n (table size).
import {
  Box, Button, Card, Checkbox, Column, Divider, For, Row, Scroll, Show, Spacer, Text, TextField, Window,
  createMemo, createSignal, mixColor, requestAnimationFrame, run, theme,
} from "@nodebuilderjs/core";
import type { Accessor } from "@nodebuilderjs/core";

const ROWS = Number(process.env.ROWS ?? 500);
const LIVE = process.env.LIVE !== "0";
const CYCLE = Number(process.env.CYCLE ?? 0);

const TABS = [
  { id: "overview", label: "Visão geral", dot: "#3584e4" },
  { id: "table", label: "Serviços", dot: "#26a269" },
  { id: "logs", label: "Logs", dot: "#e5a50a" },
  { id: "settings", label: "Configurações", dot: "#9141ac" },
] as const;

// Seeded so every run (and the Electron mirror) sees the same data.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;

const [tick, setTick] = createSignal(0);
const [tab, setTab] = createSignal(Math.max(0, TABS.findIndex((t) => t.id === process.env.TAB)));

// ---- data ------------------------------------------------------------------

const STATUS = {
  ok: { label: "ativo", fg: "#1c7a45", bg: "#e6f4ea" },
  warn: { label: "lento", fg: "#8a6100", bg: "#fef7e0" },
  down: { label: "parado", fg: "#b3141b", bg: "#fde8e8" },
} as const;
type Status = keyof typeof STATUS;

interface Service {
  id: number;
  name: string;
  region: string;
  status: Accessor<Status>;
  cpu: Accessor<number>;
  setCpu: (v: number) => void;
  mem: number;
}

const NAMES = ["api", "auth", "billing", "cache", "search", "mailer", "queue", "gateway", "storage", "metrics"];
const REGIONS = ["sa-east-1", "us-east-1", "eu-west-1", "ap-south-1"];
const services: Service[] = Array.from({ length: ROWS }, (_, id) => {
  const [cpu, setCpu] = createSignal(Math.round(rand() * 100));
  const status = createMemo<Status>(() => (cpu() > 90 ? "down" : cpu() > 70 ? "warn" : "ok"));
  return { id, name: `${pick(NAMES)}-${id}`, region: pick(REGIONS), cpu, setCpu, status, mem: Math.round(64 + rand() * 4000) };
});

interface LogLine {
  id: number;
  time: string;
  level: "INFO" | "WARN" | "ERRO";
  text: string;
}
const LEVEL = { INFO: "#3584e4", WARN: "#e5a50a", ERRO: "#e01b24" };
const MESSAGES = [
  "requisição concluída em 12 ms", "conexão com o banco reaberta", "cache invalidado para /usuarios",
  "tempo de resposta acima do limite", "job de faturamento agendado", "certificado renovado",
  "falha ao enviar e-mail: tempo esgotado", "réplica sincronizada", "novo deploy recebido (v2.14.3)",
];
let logId = 0;
const makeLog = (): LogLine => {
  const r = rand();
  const s = logId++;
  const time = `${String(Math.floor(s / 3600) % 24).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return { id: s, time, level: r < 0.75 ? "INFO" : r < 0.93 ? "WARN" : "ERRO", text: `${pick(NAMES)}: ${pick(MESSAGES)}` };
};
const [logs, setLogs] = createSignal<LogLine[]>(Array.from({ length: 200 }, makeLog));
const [activity, setActivity] = createSignal<LogLine[]>(Array.from({ length: 12 }, makeLog));

// One frame of "live" data: a tenth of the table, the chart, two log lines, sometimes an activity item.
function step() {
  const t = tick() + 1;
  setTick(t);
  for (let i = t % 10; i < services.length; i += 10) {
    const s = services[i]!;
    s.setCpu(Math.max(0, Math.min(100, s.cpu() + Math.round((rand() - 0.5) * 20))));
  }
  setLogs((list) => [...list.slice(list.length >= 400 ? 2 : 0), makeLog(), makeLog()]);
  if (t % 15 === 0) setActivity((list) => [makeLog(), ...list.slice(0, 11)]);
  if (CYCLE > 0 && t % CYCLE === 0) setTab((i) => (i + 1) % TABS.length);
}
const loop = () => {
  step();
  requestAnimationFrame(loop);
};
if (LIVE || CYCLE > 0) requestAnimationFrame(loop);

// ---- small pieces ------------------------------------------------------------

function Hoverable(props: { children: (hovered: Accessor<boolean>) => any; onClick?: () => void; [k: string]: any }) {
  const [hovered, setHovered] = createSignal(false);
  const { children, ...rest } = props;
  return (
    <Box {...rest} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onClick={props.onClick}>
      {children(hovered)}
    </Box>
  );
}

function Pill(props: { text: Accessor<string>; fg: Accessor<string>; bg: Accessor<string> }) {
  return (
    <Row padding={[2, 8]} radius={10} background={props.bg} align="center">
      <Text fontSize={11} bold color={props.fg}>{props.text}</Text>
    </Row>
  );
}

function Meter(props: { value: Accessor<number>; width: number }) {
  const color = () => (props.value() > 90 ? theme.danger.base : props.value() > 70 ? "#e5a50a" : theme.accent.base);
  return (
    <Box width={props.width} height={6} radius={3} background="#0000000f" align="start">
      <Box width={() => Math.max(2, (props.value() / 100) * props.width)} height={6} radius={3} background={color} />
    </Box>
  );
}

// ---- tabs --------------------------------------------------------------------

function Stat(props: { label: string; value: Accessor<string>; delta: Accessor<number> }) {
  return (
    <Card grow={1} gap={6}>
      <Text fontSize={12} color={theme.text.secondary}>{props.label}</Text>
      <Text fontSize={26} bold>{props.value}</Text>
      <Text fontSize={12} color={() => (props.delta() >= 0 ? "#1c7a45" : "#b3141b")}>
        {() => `${props.delta() >= 0 ? "▲" : "▼"} ${Math.abs(props.delta()).toFixed(1)}% vs. ontem`}
      </Text>
    </Card>
  );
}

function Overview() {
  const avgCpu = createMemo(() => services.reduce((a, s) => a + s.cpu(), 0) / services.length);
  const down = createMemo(() => services.filter((s) => s.status() === "down").length);
  const bars = Array.from({ length: 32 }, (_, i) => i);
  return (
    <Column gap={16} grow={1} minHeight={0}>
      <Row gap={12}>
        <Stat label="Requisições/s" value={() => (1200 + Math.round(Math.sin(tick() / 20) * 300)).toLocaleString("pt-BR")} delta={() => Math.sin(tick() / 20) * 12} />
        <Stat label="CPU média" value={() => `${avgCpu().toFixed(1)}%`} delta={() => avgCpu() - 50} />
        <Stat label="Serviços parados" value={() => `${down()} de ${services.length}`} delta={() => -down() / 10} />
        <Stat label="Latência p95" value={() => `${(80 + Math.cos(tick() / 13) * 25).toFixed(0)} ms`} delta={() => Math.cos(tick() / 13) * 5} />
      </Row>
      <Row gap={12} grow={1} minHeight={0}>
        <Card grow={2} gap={12}>
          <Row align="center">
            <Text bold grow={1}>Tráfego por minuto</Text>
            <Text fontSize={12} color={theme.text.secondary}>{() => `frame ${tick()}`}</Text>
          </Row>
          <Row grow={1} gap={4} align="end" minHeight={160}>
            <For each={bars}>
              {(i) => (
                <Box
                  grow={1}
                  radius={3}
                  height={() => 20 + (Math.sin(tick() / 15 + i / 3) + 1) * 60 + (i % 5) * 8}
                  background={() => {
                    // Bars fade toward their base: a gradient to the same color, translucent.
                    const color = i % 8 === 7 ? "#e5a50a" : theme.accent.base;
                    return { linear: [color, mixColor(color, "transparent", 0.65)] };
                  }}
                />
              )}
            </For>
          </Row>
          <Row justify="space-between">
            <For each={["00:00", "06:00", "12:00", "18:00", "24:00"]}>
              {(label) => <Text fontSize={11} color={theme.text.secondary}>{label}</Text>}
            </For>
          </Row>
        </Card>
        <Card grow={1} gap={10} minHeight={0}>
          <Text bold>Atividade recente</Text>
          <Scroll grow={1} gap={8}>
            <For each={activity}>
              {(item) => (
                <Row gap={10} align="center">
                  <Box width={8} height={8} radius={4} background={LEVEL[item.level]} />
                  <Column grow={1} gap={2}>
                    <Text fontSize={13}>{item.text}</Text>
                    <Text fontSize={11} color={theme.text.secondary}>{item.time}</Text>
                  </Column>
                </Row>
              )}
            </For>
          </Scroll>
        </Card>
      </Row>
    </Column>
  );
}

type SortKey = "id" | "name" | "cpu" | "mem";
const COLUMNS: { key: SortKey | null; label: string; width?: number }[] = [
  { key: "id", label: "#", width: 50 },
  { key: "name", label: "Serviço" },
  { key: null, label: "Região", width: 110 },
  { key: null, label: "Status", width: 80 },
  { key: "cpu", label: "CPU", width: 170 },
  { key: "mem", label: "Memória", width: 90 },
];

function ServiceRow(props: { s: Service }) {
  const { s } = props;
  const st = () => STATUS[s.status()];
  return (
    <Hoverable direction="row" align="center" gap={12} padding={[8, 12]} radius={6}>
      {(hovered: Accessor<boolean>) => (
        <>
          <Text width={50} fontSize={12} color={theme.text.secondary}>{String(s.id)}</Text>
          <Text grow={1} fontSize={13} bold={hovered}>{s.name}</Text>
          <Text width={110} fontSize={12} color={theme.text.secondary}>{s.region}</Text>
          <Row width={80}><Pill text={() => st().label} fg={() => st().fg} bg={() => st().bg} /></Row>
          <Row width={170} gap={8} align="center">
            <Meter value={s.cpu} width={110} />
            <Text fontSize={12}>{() => `${s.cpu()}%`}</Text>
          </Row>
          <Text width={90} fontSize={12}>{`${s.mem} MB`}</Text>
        </>
      )}
    </Hoverable>
  );
}

function Services(props: { query: Accessor<string> }) {
  const [sort, setSort] = createSignal<{ key: SortKey; desc: boolean }>({ key: "id", desc: false });
  const [onlyProblems, setOnlyProblems] = createSignal(false);
  const rows = createMemo(() => {
    const q = props.query().toLowerCase();
    const { key, desc } = sort();
    const list = services.filter(
      (s) => (!q || s.name.includes(q) || s.region.includes(q)) && (!onlyProblems() || s.status() !== "ok"),
    );
    const val = (s: Service) => (key === "cpu" ? s.cpu() : key === "mem" ? s.mem : key === "name" ? s.name : s.id);
    list.sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
    });
    return list;
  });
  const toggleSort = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key === "cpu" || key === "mem" }));

  return (
    <Card grow={1} minHeight={0} padding={0} gap={0}>
      <Row padding={[12, 16]} gap={12} align="center">
        <Text bold grow={1}>{() => `${rows().length} serviços`}</Text>
        <Checkbox checked={onlyProblems} onChange={setOnlyProblems} label="Só com problema" />
      </Row>
      <Divider />
      <Row gap={12} padding={[8, 24, 8, 12]} background="#00000006">
        <For each={COLUMNS}>
          {(col) => (
            <Text
              width={col.width ?? 0}
              grow={col.width ? 0 : 1}
              fontSize={12}
              bold
              color={() => (col.key && sort().key === col.key ? theme.accent.base : theme.text.secondary)}
              cursor={col.key ? "pointer" : "default"}
              onClick={() => col.key && toggleSort(col.key)}
            >
              {() => col.label + (col.key && sort().key === col.key ? (sort().desc ? " ↓" : " ↑") : "")}
            </Text>
          )}
        </For>
      </Row>
      <Divider />
      <Scroll grow={1} padding={[4, 12, 4, 0]}>
        <For each={rows} fallback={<Text padding={16} color={theme.text.secondary}>Nenhum serviço encontrado</Text>}>
          {(s) => <ServiceRow s={s} />}
        </For>
      </Scroll>
    </Card>
  );
}

function Logs() {
  const [levels, setLevels] = createSignal({ INFO: true, WARN: true, ERRO: true });
  const [paused, setPaused] = createSignal(false);
  let frozen: LogLine[] = [];
  const visible = createMemo(() => {
    const on = levels();
    if (paused()) return frozen;
    return (frozen = logs().filter((l) => on[l.level]));
  });
  const toggle = (k: keyof typeof LEVEL) => setLevels((l) => ({ ...l, [k]: !l[k] }));
  return (
    <Card grow={1} minHeight={0} gap={12}>
      <Row gap={16} align="center">
        <Text bold grow={1}>{() => `${visible().length} linhas`}</Text>
        <For each={["INFO", "WARN", "ERRO"] as const}>
          {(k) => <Checkbox checked={() => levels()[k]} onChange={() => toggle(k)} label={k} />}
        </For>
        <Button label={() => (paused() ? "Continuar" : "Pausar")} onClick={() => setPaused((p) => !p)} />
      </Row>
      <Scroll grow={1} gap={2} background="#1e1e24" radius={8} padding={[10, 12]}>
        <For each={visible}>
          {(l) => (
            <Row gap={10}>
              <Text fontSize={12} color="#8a8a96">{l.time}</Text>
              <Text fontSize={12} bold color={LEVEL[l.level]} width={40}>{l.level}</Text>
              <Text fontSize={12} color="#e8e8ee">{l.text}</Text>
            </Row>
          )}
        </For>
      </Scroll>
    </Card>
  );
}

function Segmented(props: { options: string[]; value: Accessor<number>; onChange: (i: number) => void }) {
  return (
    <Row background="#00000010" radius={8} padding={3} gap={2}>
      <For each={props.options}>
        {(label, i) => (
          <Button
            label={label}
            variant="flat"
            padding={[6, 14]}
            background={() => (props.value() === i() ? "#ffffff" : "#00000000")}
            onClick={() => props.onChange(i())}
          />
        )}
      </For>
    </Row>
  );
}

function Settings() {
  const [name, setName] = createSignal("Equipe de plataforma");
  const [email, setEmail] = createSignal("alertas@exemplo.com.br");
  const [interval, setInterval_] = createSignal(1);
  const flags = ["Notificar por e-mail", "Notificar no chat", "Resumo diário", "Pausar alertas à noite", "Modo compacto", "Mostrar serviços parados primeiro"].map((label, i) => {
    const [on, set] = createSignal(i % 2 === 0);
    return { label, on, set };
  });
  const Field = (p: { label: string; children: any }) => (
    <Column gap={6}>
      <Text fontSize={12} bold color={theme.text.secondary}>{p.label}</Text>
      {p.children}
    </Column>
  );
  return (
    <Scroll grow={1} gap={16} padding={[0, 12, 0, 0]}>
      <Card gap={14}>
        <Text bold fontSize={16}>Geral</Text>
        <Row gap={12}>
          <Column grow={1}><Field label="Nome da equipe"><TextField value={name} onInput={setName} /></Field></Column>
          <Column grow={1}><Field label="E-mail de alertas"><TextField value={email} onInput={setEmail} /></Field></Column>
        </Row>
        <Field label="Intervalo de coleta">
          <Row><Segmented options={["10 s", "30 s", "1 min", "5 min"]} value={interval} onChange={setInterval_} /></Row>
        </Field>
      </Card>
      <Card gap={12}>
        <Text bold fontSize={16}>Notificações</Text>
        <For each={flags}>{(f) => <Checkbox checked={f.on} onChange={f.set} label={f.label} />}</For>
      </Card>
      <Card gap={12} borderColor="#e01b2440">
        <Text bold fontSize={16} color={theme.danger.base}>Zona de perigo</Text>
        <Row gap={12} align="center">
          <Text grow={1} color={theme.text.secondary}>Remove todos os serviços e o histórico de métricas.</Text>
          <Button label="Apagar tudo" variant="danger" />
        </Row>
      </Card>
    </Scroll>
  );
}

// ---- shell -------------------------------------------------------------------

function NavItem(props: { index: number }) {
  const t = TABS[props.index]!;
  const active = () => tab() === props.index;
  return (
    <Hoverable direction="row" align="center" gap={10} padding={[9, 12]} radius={8} cursor="pointer" onClick={() => setTab(props.index)}
      background={() => (active() ? "#3584e41f" : "#00000000")}>
      {(hovered: Accessor<boolean>) => (
        <>
          <Box width={10} height={10} radius={5} background={t.dot} />
          <Text grow={1} bold={active} color={() => (active() ? theme.accent.pressed : hovered() ? theme.text.primary : theme.text.secondary)}>{t.label}</Text>
        </>
      )}
    </Hoverable>
  );
}

function TabBar() {
  return (
    <Row gap={4}>
      <For each={TABS.map((_, i) => i)}>
        {(i) => (
          <Hoverable gap={8} padding={[8, 12, 0, 12]} cursor="pointer" onClick={() => setTab(i)}>
            {(hovered: Accessor<boolean>) => (
              <>
                <Text bold={() => tab() === i} color={() => (tab() === i ? theme.text.primary : hovered() ? "#3a3a44" : theme.text.secondary)}>{TABS[i]!.label}</Text>
                <Box height={3} radius={2} background={() => (tab() === i ? theme.accent.base : "#00000000")} />
              </>
            )}
          </Hoverable>
        )}
      </For>
    </Row>
  );
}

function Dashboard() {
  const [query, setQuery] = createSignal("");
  return (
    <Window title={`Painel · ${ROWS} serviços${LIVE ? "" : " · estático"}${CYCLE ? ` · troca a cada ${CYCLE} frames` : ""}`} width={1200} height={800}>
      <Row grow={1} minHeight={0}>
        <Column width={220} padding={[16, 12]} gap={4} background="#f1f1f4">
          <Text bold fontSize={18} padding={[0, 12, 12, 12]}>Observa</Text>
          <For each={TABS.map((_, i) => i)}>{(i) => <NavItem index={i} />}</For>
          <Spacer size={16} />
          <Text fontSize={11} bold color={theme.text.secondary} padding={[0, 12]}>REGIÕES</Text>
          <For each={REGIONS}>
            {(r) => {
              const count = createMemo(() => services.filter((s) => s.region === r && s.status() === "down").length);
              return (
                <Row padding={[6, 12]} align="center">
                  <Text grow={1} fontSize={13}>{r}</Text>
                  <Show when={() => count() > 0}>
                    <Pill text={() => String(count())} fg={() => STATUS.down.fg} bg={() => STATUS.down.bg} />
                  </Show>
                </Row>
              );
            }}
          </For>
          <Spacer />
          <Text fontSize={11} color={theme.text.secondary} padding={[0, 12]}>{() => `frame ${tick()}`}</Text>
        </Column>
        <Column grow={1} minHeight={0} padding={[16, 20]} gap={12}>
          <Row gap={12} align="center">
            <Column grow={1} gap={2}>
              <Text bold fontSize={20}>{() => TABS[tab()]!.label}</Text>
              <Text fontSize={12} color={theme.text.secondary}>Ambiente de produção · atualizado ao vivo</Text>
            </Column>
            <TextField width={260} value={query} onInput={(v) => (setQuery(v), setTab(1))} placeholder="Buscar serviço ou região…" />
            <Button label="Exportar" />
            <Button label="Novo serviço" variant="primary" />
          </Row>
          <TabBar />
          <Divider />
          {() => {
            switch (tab()) {
              case 0: return <Overview />;
              case 1: return <Services query={query} />;
              case 2: return <Logs />;
              default: return <Settings />;
            }
          }}
        </Column>
      </Row>
    </Window>
  );
}

run(() => <Dashboard />);
