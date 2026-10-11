// Vanilla DOM mirror of examples/dashboard.tsx: same data (same seeded RNG, same call order),
// same per-frame updates, and only the visible tab is mounted, like the <Show>-style switch there.
// Electron passes the scene options in the query string; the Tauri shell injects __BENCH_PARAMS__.
const params = new URLSearchParams(window.__BENCH_PARAMS__ ?? location.search);
// Tauri doesn't forward console.log to the terminal, so lines also go to its `report` command.
const report = (line) => (console.log(line), window.__TAURI__?.core.invoke("report", { line }));
const ROWS = Number(params.get("ROWS"));
const LIVE = params.get("LIVE") !== "0";
const CYCLE = Number(params.get("CYCLE"));
const MIN_INTERVAL = 1000 / Number(params.get("MAX_FPS")) - 1.5; // same cap rule as nodebuilder

const TABS = [
  { id: "overview", label: "Visão geral", dot: "#3584e4" },
  { id: "table", label: "Serviços", dot: "#26a269" },
  { id: "logs", label: "Logs", dot: "#e5a50a" },
  { id: "settings", label: "Configurações", dot: "#9141ac" },
];

let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = (list) => list[Math.floor(rand() * list.length)];

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const k in props ?? {}) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), props[k]);
    else if (k === "style") Object.assign(el.style, props[k]);
    else el[k] = props[k];
  }
  for (const c of children) if (c != null) el.append(c);
  return el;
}

// ---- data ------------------------------------------------------------------

const STATUS = {
  ok: { label: "ativo", fg: "#1c7a45", bg: "#e6f4ea" },
  warn: { label: "lento", fg: "#8a6100", bg: "#fef7e0" },
  down: { label: "parado", fg: "#b3141b", bg: "#fde8e8" },
};
const statusOf = (cpu) => (cpu > 90 ? "down" : cpu > 70 ? "warn" : "ok");

const NAMES = ["api", "auth", "billing", "cache", "search", "mailer", "queue", "gateway", "storage", "metrics"];
const REGIONS = ["sa-east-1", "us-east-1", "eu-west-1", "ap-south-1"];
const services = Array.from({ length: ROWS }, (_, id) => {
  const cpu = Math.round(rand() * 100);
  return { id, name: `${pick(NAMES)}-${id}`, region: pick(REGIONS), cpu, mem: Math.round(64 + rand() * 4000) };
});

const LEVEL = { INFO: "#3584e4", WARN: "#e5a50a", ERRO: "#e01b24" };
const MESSAGES = [
  "requisição concluída em 12 ms", "conexão com o banco reaberta", "cache invalidado para /usuarios",
  "tempo de resposta acima do limite", "job de faturamento agendado", "certificado renovado",
  "falha ao enviar e-mail: tempo esgotado", "réplica sincronizada", "novo deploy recebido (v2.14.3)",
];
let logId = 0;
const makeLog = () => {
  const r = rand();
  const s = logId++;
  const time = `${String(Math.floor(s / 3600) % 24).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return { id: s, time, level: r < 0.75 ? "INFO" : r < 0.93 ? "WARN" : "ERRO", text: `${pick(NAMES)}: ${pick(MESSAGES)}` };
};
let logs = Array.from({ length: 200 }, makeLog);
let activity = Array.from({ length: 12 }, makeLog);

let tick = 0;
let tab = Math.max(0, TABS.findIndex((t) => t.id === params.get("TAB")));
let query = "";
let view = null; // the mounted tab: { update(changed: Set<service>, newActivity: boolean), refresh?() }

function step() {
  const t = ++tick;
  const changed = new Set();
  for (let i = t % 10; i < services.length; i += 10) {
    const s = services[i];
    const next = Math.max(0, Math.min(100, s.cpu + Math.round((rand() - 0.5) * 20)));
    if (next !== s.cpu) changed.add(s);
    s.cpu = next;
  }
  logs = [...logs.slice(logs.length >= 400 ? 2 : 0), makeLog(), makeLog()];
  const newActivity = t % 15 === 0;
  if (newActivity) activity = [makeLog(), ...activity.slice(0, 11)];
  if (CYCLE > 0 && t % CYCLE === 0) setTab((tab + 1) % TABS.length);
  updateShell();
  view.update(changed, newActivity);
}

// ---- pieces ------------------------------------------------------------------

const pill = () => h("span", { className: "pill" });
function setPill(el, st) {
  el.textContent = st.label;
  el.style.color = st.fg;
  el.style.background = st.bg;
}
const meterColor = (v) => (v > 90 ? "#e01b24" : v > 70 ? "#e5a50a" : "#3584e4");
function setMeter(fill, v) {
  fill.style.width = `${Math.max(2, (v / 100) * 110)}px`;
  fill.style.background = meterColor(v);
}
function check(label, checked, onChange) {
  return h("label", { className: "check" }, h("input", { type: "checkbox", checked, onchange: (e) => onChange(e.target.checked) }), label);
}

// ---- tabs --------------------------------------------------------------------

function Overview() {
  const avg = () => services.reduce((a, s) => a + s.cpu, 0) / services.length;
  const down = () => services.filter((s) => statusOf(s.cpu) === "down").length;
  const stats = [
    ["Requisições/s", () => (1200 + Math.round(Math.sin(tick / 20) * 300)).toLocaleString("pt-BR"), () => Math.sin(tick / 20) * 12],
    ["CPU média", () => `${avg().toFixed(1)}%`, () => avg() - 50],
    ["Serviços parados", () => `${down()} de ${services.length}`, () => -down() / 10],
    ["Latência p95", () => `${(80 + Math.cos(tick / 13) * 25).toFixed(0)} ms`, () => Math.cos(tick / 13) * 5],
  ].map(([label, value, delta]) => {
    const v = h("div", { className: "b", style: { fontSize: "26px" } });
    const d = h("div", { style: { fontSize: "12px" } });
    const card = h("div", { className: "card grow", style: { gap: "6px" } }, h("div", { className: "muted", style: { fontSize: "12px" } }, label), v, d);
    return { card, update() {
      v.textContent = value();
      const x = delta();
      d.textContent = `${x >= 0 ? "▲" : "▼"} ${Math.abs(x).toFixed(1)}% vs. ontem`;
      d.style.color = x >= 0 ? "#1c7a45" : "#b3141b";
    } };
  });
  const bars = Array.from({ length: 32 }, (_, i) => h("div", { style: { background: i % 8 === 7 ? "#e5a50a" : "#3584e4" } }));
  const frame = h("span", { className: "muted", style: { fontSize: "12px" } });
  const feed = h("div", { className: "col scroll grow", style: { gap: "8px" } });
  const items = new Map();
  const renderFeed = () => {
    const next = new Map();
    feed.replaceChildren(...activity.map((a) => {
      const el = items.get(a) ?? h("div", { className: "row center", style: { gap: "10px" } },
        h("div", { className: "dot", style: { width: "8px", height: "8px", background: LEVEL[a.level] } }),
        h("div", { className: "col grow", style: { gap: "2px" } },
          h("div", { style: { fontSize: "13px" } }, a.text),
          h("div", { className: "muted", style: { fontSize: "11px" } }, a.time)));
      next.set(a, el);
      return el;
    }));
    items.clear();
    for (const [k, v] of next) items.set(k, v);
  };
  const update = () => {
    for (const s of stats) s.update();
    bars.forEach((b, i) => (b.style.height = `${20 + (Math.sin(tick / 15 + i / 3) + 1) * 60 + (i % 5) * 8}px`));
    frame.textContent = `frame ${tick}`;
  };
  const el = h("div", { className: "col grow", style: { gap: "16px", minHeight: 0 } },
    h("div", { className: "row", style: { gap: "12px" } }, ...stats.map((s) => s.card)),
    h("div", { className: "row grow", style: { gap: "12px", minHeight: 0 } },
      h("div", { className: "card", style: { flex: 2, gap: "12px" } },
        h("div", { className: "row center" }, h("span", { className: "b grow" }, "Tráfego por minuto"), frame),
        h("div", { className: "row chart" }, ...bars),
        h("div", { className: "row", style: { justifyContent: "space-between" } },
          ...["00:00", "06:00", "12:00", "18:00", "24:00"].map((l) => h("span", { className: "muted", style: { fontSize: "11px" } }, l)))),
      h("div", { className: "card", style: { flex: 1, gap: "10px", minHeight: 0 } }, h("div", { className: "b" }, "Atividade recente"), feed)));
  update();
  renderFeed();
  return { el, update: (_changed, newActivity) => (update(), newActivity && renderFeed()) };
}

const COLUMNS = [
  { key: "id", label: "#", cls: "w50" },
  { key: "name", label: "Serviço", cls: "grow" },
  { key: null, label: "Região", cls: "w110" },
  { key: null, label: "Status", cls: "w80" },
  { key: "cpu", label: "CPU", cls: "w170" },
  { key: "mem", label: "Memória", cls: "w90" },
];

function Services() {
  let sort = { key: "id", desc: false };
  let onlyProblems = false;
  let list = [];
  const rows = new Map(); // service -> { el, pill, fill, pct }
  const rowOf = (s) => {
    let r = rows.get(s);
    if (r) return r;
    const p = pill(), fill = h("div"), pct = h("span", { style: { fontSize: "12px" } });
    const el = h("div", { className: "row tr" },
      h("span", { className: "w50 muted", style: { fontSize: "12px" } }, String(s.id)),
      h("span", { className: "grow name", style: { fontSize: "13px" } }, s.name),
      h("span", { className: "w110 muted", style: { fontSize: "12px" } }, s.region),
      h("div", { className: "w80 row" }, p),
      h("div", { className: "w170 row center", style: { gap: "8px" } }, h("div", { className: "meter" }, fill), pct),
      h("span", { className: "w90", style: { fontSize: "12px" } }, `${s.mem} MB`));
    r = { el, pill: p, fill, pct };
    paintRow(s, r);
    rows.set(s, r);
    return r;
  };
  const paintRow = (s, r) => {
    setPill(r.pill, STATUS[statusOf(s.cpu)]);
    setMeter(r.fill, s.cpu);
    r.pct.textContent = `${s.cpu}%`;
  };

  const count = h("span", { className: "b grow" });
  const body = h("div", { className: "col scroll grow", style: { padding: "4px 12px 4px 0" } });
  const empty = h("div", { className: "muted", style: { padding: "16px" } }, "Nenhum serviço encontrado");
  const heads = COLUMNS.map((c) => h("span", { className: `${c.cls}${c.key ? " sortable" : ""}`, onclick: () => c.key && toggleSort(c.key) }));
  const paintHeads = () => COLUMNS.forEach((c, i) => {
    const on = c.key && sort.key === c.key;
    heads[i].textContent = c.label + (on ? (sort.desc ? " ↓" : " ↑") : "");
    heads[i].classList.toggle("active", !!on);
  });
  const toggleSort = (key) => {
    sort = { key, desc: sort.key === key ? !sort.desc : key === "cpu" || key === "mem" };
    paintHeads();
    refresh();
  };
  const refresh = () => {
    const q = query.toLowerCase();
    const { key, desc } = sort;
    const next = services.filter((s) => (!q || s.name.includes(q) || s.region.includes(q)) && (!onlyProblems || statusOf(s.cpu) !== "ok"));
    const val = (s) => (key === "cpu" ? s.cpu : key === "mem" ? s.mem : key === "name" ? s.name : s.id);
    next.sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
    });
    if (next.length === list.length && next.every((s, i) => s === list[i])) return;
    const keep = new Set(next);
    for (const s of rows.keys()) if (!keep.has(s)) rows.delete(s);
    list = next;
    body.replaceChildren(...(list.length ? list.map((s) => rowOf(s).el) : [empty]));
    count.textContent = `${list.length} serviços`;
  };
  const el = h("div", { className: "card grow", style: { padding: 0, gap: 0, minHeight: 0 } },
    h("div", { className: "row center", style: { padding: "12px 16px", gap: "12px" } }, count,
      check("Só com problema", false, (v) => ((onlyProblems = v), refresh()))),
    h("div", { className: "divider" }),
    h("div", { className: "row th" }, ...heads),
    h("div", { className: "divider" }),
    body);
  paintHeads();
  refresh();
  return {
    el,
    refresh,
    update(changed) {
      for (const s of changed) {
        const r = rows.get(s);
        if (r) paintRow(s, r);
      }
      if (changed.size && (sort.key === "cpu" || onlyProblems)) refresh();
    },
  };
}

function Logs() {
  const levels = { INFO: true, WARN: true, ERRO: true };
  let paused = false;
  const lines = new Map();
  const count = h("span", { className: "b grow" });
  const box = h("div", { className: "col scroll grow log" });
  const render = () => {
    if (paused) return;
    const visible = logs.filter((l) => levels[l.level]);
    const next = new Map();
    box.replaceChildren(...visible.map((l) => {
      const el = lines.get(l) ?? h("div", { className: "row" },
        h("span", { style: { color: "#8a8a96" } }, l.time),
        h("span", { className: "b", style: { color: LEVEL[l.level], width: "40px", flex: "none" } }, l.level),
        h("span", { style: { color: "#e8e8ee" } }, l.text));
      next.set(l, el);
      return el;
    }));
    lines.clear();
    for (const [k, v] of next) lines.set(k, v);
    count.textContent = `${visible.length} linhas`;
  };
  const pause = h("button", { onclick: () => ((paused = !paused), (pause.textContent = paused ? "Continuar" : "Pausar"), render()) }, "Pausar");
  const el = h("div", { className: "card grow", style: { gap: "12px", minHeight: 0 } },
    h("div", { className: "row center", style: { gap: "16px" } }, count,
      ...Object.keys(levels).map((k) => check(k, true, (v) => ((levels[k] = v), render()))), pause),
    box);
  render();
  return { el, update: render };
}

function Settings() {
  const field = (label, value) =>
    h("div", { className: "col grow", style: { gap: "6px" } },
      h("div", { className: "b muted", style: { fontSize: "12px" } }, label), h("input", { type: "text", value }));
  const seg = h("div", { className: "row seg" });
  const segButtons = ["10 s", "30 s", "1 min", "5 min"].map((label, i) =>
    h("button", { className: i === 1 ? "on" : "", onclick: () => segButtons.forEach((b, j) => b.classList.toggle("on", i === j)) }, label));
  seg.append(...segButtons);
  const flags = ["Notificar por e-mail", "Notificar no chat", "Resumo diário", "Pausar alertas à noite", "Modo compacto", "Mostrar serviços parados primeiro"];
  const el = h("div", { className: "col scroll grow", style: { gap: "16px", paddingRight: "12px" } },
    h("div", { className: "card", style: { gap: "14px" } },
      h("div", { className: "b", style: { fontSize: "16px" } }, "Geral"),
      h("div", { className: "row", style: { gap: "12px" } }, field("Nome da equipe", "Equipe de plataforma"), field("E-mail de alertas", "alertas@exemplo.com.br")),
      h("div", { className: "col", style: { gap: "6px" } }, h("div", { className: "b muted", style: { fontSize: "12px" } }, "Intervalo de coleta"), h("div", { className: "row" }, seg))),
    h("div", { className: "card", style: { gap: "12px" } },
      h("div", { className: "b", style: { fontSize: "16px" } }, "Notificações"), ...flags.map((f, i) => check(f, i % 2 === 0, () => {}))),
    h("div", { className: "card", style: { gap: "12px", borderColor: "#e01b2440" } },
      h("div", { className: "b", style: { fontSize: "16px", color: "#e01b24" } }, "Zona de perigo"),
      h("div", { className: "row center", style: { gap: "12px" } },
        h("span", { className: "grow muted" }, "Remove todos os serviços e o histórico de métricas."),
        h("button", { className: "danger" }, "Apagar tudo"))));
  return { el, update() {} };
}

// ---- shell -------------------------------------------------------------------

const navs = TABS.map((t, i) => h("div", { className: "row center nav", onclick: () => setTab(i) }, h("div", { className: "dot", style: { background: t.dot } }), h("span", { className: "grow" }, t.label)));
const tabEls = TABS.map((t, i) => h("div", { className: "col tab", onclick: () => setTab(i) }, h("span", {}, t.label), h("div", { className: "bar" })));
const regionPills = REGIONS.map(() => pill());
const sideFrame = h("div", { className: "muted", style: { fontSize: "11px", padding: "0 12px" } });
const heading = h("div", { className: "b", style: { fontSize: "20px" } });
const content = h("div", { id: "content" });
const search = h("input", { type: "text", placeholder: "Buscar serviço ou região…", style: { width: "260px" }, oninput: (e) => {
  query = e.target.value;
  if (tab !== 1) setTab(1);
  else view.refresh();
} });

document.getElementById("side").append(
  h("div", { className: "brand" }, "Observa"),
  ...navs,
  h("div", { className: "section" }, "REGIÕES"),
  ...REGIONS.map((r, i) => h("div", { className: "row center region" }, h("span", { className: "grow" }, r), regionPills[i])),
  h("div", { className: "grow" }),
  sideFrame,
);
document.getElementById("main").append(
  h("div", { className: "row center", style: { gap: "12px" } },
    h("div", { className: "col grow", style: { gap: "2px" } }, heading,
      h("div", { className: "muted", style: { fontSize: "12px" } }, "Ambiente de produção · atualizado ao vivo")),
    search, h("button", {}, "Exportar"), h("button", { className: "primary" }, "Novo serviço")),
  h("div", { className: "row tabs" }, ...tabEls),
  h("div", { className: "divider" }),
  content,
);

function updateShell() {
  sideFrame.textContent = `frame ${tick}`;
  REGIONS.forEach((r, i) => {
    const n = services.filter((s) => s.region === r && statusOf(s.cpu) === "down").length;
    regionPills[i].style.display = n > 0 ? "" : "none";
    if (n > 0) setPill(regionPills[i], { ...STATUS.down, label: String(n) });
  });
}

function setTab(i) {
  tab = i;
  navs.forEach((n, j) => n.classList.toggle("on", i === j));
  tabEls.forEach((n, j) => n.classList.toggle("on", i === j));
  heading.textContent = TABS[i].label;
  view = [Overview, Services, Logs, Settings][i]();
  content.replaceChildren(view.el);
}

document.title = `Painel · ${ROWS} serviços${LIVE ? "" : " · estático"}${CYCLE ? ` · troca a cada ${CYCLE} frames` : ""} (Electron)`;
setTab(tab);
updateShell();

let last = -Infinity;
let frames = 0;
let jsTime = 0;
let since = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (now - last < MIN_INTERVAL) return;
  last = now;
  const t0 = performance.now();
  step();
  jsTime += performance.now() - t0;
  frames++;
  if (now - since >= 1000) {
    report(`fps ${Math.round((frames * 1000) / (now - since))} | js ${(jsTime / frames).toFixed(2)} ms/frame | nodes ${document.getElementsByTagName("*").length} | ${TABS[tab].id}`);
    frames = 0;
    jsTime = 0;
    since = now;
  }
}
if (LIVE || CYCLE > 0) requestAnimationFrame(frame);
