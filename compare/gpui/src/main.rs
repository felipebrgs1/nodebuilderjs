// GPUI baseline (Zed's framework): the same two scenes as compare/egui and compare/electron
// (renderer.js = grid, dashboard.js = dashboard), same data (same seeded RNG and call order),
// same fps cap rule and the same `fps ...` stdout lines that scripts/compare.sh averages.
// Options come from the env vars shared by every baseline: SCENE, N, MODE, NB_MAX_FPS, TAB,
// ROWS, LIVE, CYCLE. GPUI has no text input widget, so the dashboard's inputs are drawn as
// static boxes (they look the same; nothing types into them during the benchmark).
use gpui::{
    App, Application, Bounds, ClickEvent, Context, Div, FontWeight, Hsla, IntoElement, Render, SharedString,
    Stateful, Task, Timer, Window, WindowBounds, WindowOptions, div, prelude::*, px, relative, rgb, rgba, size,
};
use std::collections::VecDeque;
use std::io::Write;
use std::time::{Duration, Instant};

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.into())
}

const TEXT: u32 = 0x1f1f24;
const MUTED: u32 = 0x6b6b76;
const ACCENT: u32 = 0x3584e4;
const BORDER: u32 = 0x00000014;
const FONT: &str = "Noto Sans"; // fc-match sans-serif, what the Electron version gets

// ---- frame pacing (same rule as the other baselines) ------------------------------------

struct Pacer {
    interval: f64,
    /// Set by the ticker, taken by the next render.
    due: bool,
    frames: u32,
    work_ms: f64,
    since: Instant,
}

impl Pacer {
    fn new() -> Self {
        let max_fps: f64 = env("NB_MAX_FPS", "120").parse().unwrap_or(120.0);
        Self { interval: 1000.0 / max_fps, due: false, frames: 0, work_ms: 0.0, since: Instant::now() }
    }

    /// True once per tick. Gating on the time since the last render instead (the JS rule)
    /// drops ticks here: the render lands on the next vblank after the notify, so two
    /// renders can be closer than an interval minus 1.5 ms.
    fn ready(&mut self) -> bool {
        std::mem::take(&mut self.due)
    }

    /// Counts a stepped frame and prints once per second. `work` is only the view building
    /// (render()); GPUI lays out and paints after it returns.
    fn record(&mut self, work: Duration, suffix: &str) {
        self.frames += 1;
        self.work_ms += work.as_secs_f64() * 1000.0;
        let elapsed = self.since.elapsed().as_secs_f64();
        if elapsed >= 1.0 {
            println!("fps {} | rust {:.2} ms/frame{}", (self.frames as f64 / elapsed).round(), self.work_ms / self.frames as f64, suffix);
            let _ = std::io::stdout().flush();
            self.frames = 0;
            self.work_ms = 0.0;
            self.since = Instant::now();
        }
    }
}

/// Marks a step due and notifies the view once per interval (absolute deadlines, so it does
/// not drift); GPUI renders it on the next frame and render() takes the step. Renders for
/// other reasons (hover) do not step.
fn ticker<T: 'static>(cx: &mut Context<T>, interval_ms: f64, pacer: fn(&mut T) -> &mut Pacer) -> Task<()> {
    let interval = Duration::from_secs_f64(interval_ms / 1000.0);
    cx.spawn(async move |this, cx| {
        let mut next = Instant::now();
        loop {
            next += interval;
            let now = Instant::now();
            if next < now {
                next = now;
            }
            Timer::at(next).await;
            let marked = this.update(cx, |this, cx| {
                pacer(this).due = true;
                cx.notify();
            });
            if marked.is_err() {
                break;
            }
        }
    })
}

// ---- grid scene (renderer.js) ------------------------------------------------------------

struct Grid {
    n: usize,
    mode: String,
    tick: u64,
    pacer: Pacer,
    _ticker: Option<Task<()>>,
}

const HUES: [u32; 4] = [0xe8f0fe, 0xfde8e8, 0xe6f4ea, 0xfef7e0];

impl Render for Grid {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let t0 = Instant::now();
        let stepped = self.mode != "static" && self.pacer.ready();
        if stepped {
            self.tick += 1;
        }
        let all = self.mode == "all";
        let (n, tick) = (self.n, self.tick);
        let rows = (0..n.div_ceil(10)).map(move |row| {
            div().flex().gap(px(4.)).children((row * 10..(row * 10 + 10).min(n)).map(move |i| {
                let label = if all { format!("#{i} · {}", (tick + i as u64) % 1000) } else { format!("#{i}") };
                div()
                    .flex_1()
                    .py(px(6.))
                    .px(px(8.))
                    .rounded(px(6.))
                    .border_1()
                    .border_color(rgba(BORDER))
                    .bg(rgb(HUES[i % 4]))
                    .text_size(px(12.))
                    .child(label)
            }))
        });
        let el = div()
            .size_full()
            .flex()
            .flex_col()
            .p(px(12.))
            .gap(px(8.))
            .bg(rgb(0xfafafa))
            .font_family(FONT)
            .line_height(relative(1.36))
            .text_color(rgb(TEXT))
            .child(div().text_size(px(16.)).font_weight(FontWeight::BOLD).child(format!("Frame {}", self.tick)))
            .child(div().id("scroll").flex_1().min_h(px(0.)).overflow_y_scroll().flex().flex_col().gap(px(4.)).children(rows));
        if stepped {
            self.pacer.record(t0.elapsed(), "");
        }
        el
    }
}

// ---- dashboard scene (dashboard.js) ----------------------------------------------------------

const TABS: [(&str, &str, u32); 4] = [
    ("overview", "Visão geral", 0x3584e4),
    ("table", "Serviços", 0x26a269),
    ("logs", "Logs", 0xe5a50a),
    ("settings", "Configurações", 0x9141ac),
];
const NAMES: [&str; 10] = ["api", "auth", "billing", "cache", "search", "mailer", "queue", "gateway", "storage", "metrics"];
const REGIONS: [&str; 4] = ["sa-east-1", "us-east-1", "eu-west-1", "ap-south-1"];
const MESSAGES: [&str; 9] = [
    "requisição concluída em 12 ms", "conexão com o banco reaberta", "cache invalidado para /usuarios",
    "tempo de resposta acima do limite", "job de faturamento agendado", "certificado renovado",
    "falha ao enviar e-mail: tempo esgotado", "réplica sincronizada", "novo deploy recebido (v2.14.3)",
];
const LEVELS: [(&str, u32); 3] = [("INFO", 0x3584e4), ("WARN", 0xe5a50a), ("ERRO", 0xe01b24)];

/// Same arithmetic as the JS doubles, so every baseline sees the same data.
struct Rng(f64);
impl Rng {
    fn next(&mut self) -> f64 {
        self.0 = (self.0 * 1103515245.0 + 12345.0) % 2147483648.0;
        self.0 / 2147483648.0
    }
    fn pick<T: Copy>(&mut self, list: &[T]) -> T {
        list[(self.next() * list.len() as f64).floor() as usize]
    }
}
/// JS Math.round (halves go up, also for negatives).
fn js_round(x: f64) -> i32 {
    (x + 0.5).floor() as i32
}

#[derive(Clone, Copy, PartialEq)]
enum Status { Ok, Warn, Down }
fn status_of(cpu: i32) -> Status {
    if cpu > 90 { Status::Down } else if cpu > 70 { Status::Warn } else { Status::Ok }
}
fn status_style(s: Status) -> (&'static str, u32, u32) {
    match s {
        Status::Ok => ("ativo", 0x1c7a45, 0xe6f4ea),
        Status::Warn => ("lento", 0x8a6100, 0xfef7e0),
        Status::Down => ("parado", 0xb3141b, 0xfde8e8),
    }
}

struct Service { id: usize, name: SharedString, region: &'static str, cpu: i32, mem: i32 }

#[derive(Clone)]
struct Log { time: SharedString, level: usize, text: SharedString }

#[derive(Clone, Copy, PartialEq)]
enum SortKey { Id, Name, Cpu, Mem }

struct Dashboard {
    rng: Rng,
    services: Vec<Service>,
    logs: VecDeque<Log>,
    activity: VecDeque<Log>,
    log_id: u64,
    tick: u64,
    tab: usize,
    cycle: u64,
    pacer: Pacer,
    _ticker: Option<Task<()>>,
    // services tab
    sort: (SortKey, bool),
    only_problems: bool,
    rows: Vec<usize>,
    rows_dirty: bool,
    // logs tab
    levels: [bool; 3],
    paused: bool,
    frozen: Vec<Log>,
    // settings tab
    interval: usize,
    flags: Vec<(&'static str, bool)>,
}

impl Dashboard {
    fn new(cx: &mut Context<Self>) -> Self {
        let mut rng = Rng(42.0);
        let rows: usize = env("ROWS", "500").parse().unwrap_or(500);
        let services = (0..rows)
            .map(|id| {
                let cpu = js_round(rng.next() * 100.0);
                let name = format!("{}-{id}", rng.pick(&NAMES)).into();
                let region = rng.pick(&REGIONS);
                let mem = js_round(64.0 + rng.next() * 4000.0);
                Service { id, name, region, cpu, mem }
            })
            .collect();
        let live = env("LIVE", "1") != "0";
        let cycle = env("CYCLE", "0").parse().unwrap_or(0);
        let pacer = Pacer::new();
        let ticker = (live || cycle > 0).then(|| ticker(cx, pacer.interval, |d: &mut Dashboard| &mut d.pacer));
        let mut d = Self {
            rng,
            services,
            logs: VecDeque::new(),
            activity: VecDeque::new(),
            log_id: 0,
            tick: 0,
            tab: TABS.iter().position(|t| t.0 == env("TAB", "overview")).unwrap_or(0),
            cycle,
            pacer,
            _ticker: ticker,
            sort: (SortKey::Id, false),
            only_problems: false,
            rows: Vec::new(),
            rows_dirty: true,
            levels: [true; 3],
            paused: false,
            frozen: Vec::new(),
            interval: 1,
            flags: ["Notificar por e-mail", "Notificar no chat", "Resumo diário", "Pausar alertas à noite", "Modo compacto", "Mostrar serviços parados primeiro"]
                .iter()
                .enumerate()
                .map(|(i, l)| (*l, i % 2 == 0))
                .collect(),
        };
        for _ in 0..200 {
            let l = d.make_log();
            d.logs.push_back(l);
        }
        for _ in 0..12 {
            let l = d.make_log();
            d.activity.push_back(l);
        }
        d
    }

    fn make_log(&mut self) -> Log {
        let r = self.rng.next();
        let s = self.log_id;
        self.log_id += 1;
        let time = format!("{:02}:{:02}:{:02}", (s / 3600) % 24, (s / 60) % 60, s % 60).into();
        let level = if r < 0.75 { 0 } else if r < 0.93 { 1 } else { 2 };
        let text = format!("{}: {}", self.rng.pick(&NAMES), self.rng.pick(&MESSAGES)).into();
        Log { time, level, text }
    }

    fn step(&mut self) {
        self.tick += 1;
        let t = self.tick;
        let mut changed = false;
        let mut i = (t % 10) as usize;
        while i < self.services.len() {
            let delta = js_round((self.rng.next() - 0.5) * 20.0);
            let s = &mut self.services[i];
            let next = (s.cpu + delta).clamp(0, 100);
            changed |= next != s.cpu;
            s.cpu = next;
            i += 10;
        }
        if self.logs.len() >= 400 {
            self.logs.drain(..2);
        }
        let (a, b) = (self.make_log(), self.make_log());
        self.logs.push_back(a);
        self.logs.push_back(b);
        if t % 15 == 0 {
            let l = self.make_log();
            self.activity.push_front(l);
            self.activity.truncate(12);
        }
        if self.cycle > 0 && t % self.cycle == 0 {
            self.tab = (self.tab + 1) % TABS.len();
        }
        // The JS table only re-sorts/filters when cpu affects the order or the filter.
        if changed && (self.sort.0 == SortKey::Cpu || self.only_problems) {
            self.rows_dirty = true;
        }
    }

    fn side(&self, cx: &mut Context<Self>) -> Div {
        let mut side = div()
            .w(px(220.))
            .flex_none()
            .h_full()
            .flex()
            .flex_col()
            .gap(px(4.))
            .py(px(16.))
            .px(px(12.))
            .bg(rgb(0xf1f1f4))
            .child(div().text_size(px(18.)).font_weight(FontWeight::BOLD).mb(px(8.)).child("Observa"));
        for (i, (_, label, dot)) in TABS.iter().enumerate() {
            let active = self.tab == i;
            side = side.child(
                div()
                    .id(("side-tab", i))
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .h(px(34.))
                    .px(px(10.))
                    .rounded(px(8.))
                    .cursor_pointer()
                    .when(active, |d| d.bg(rgba(0x3584e41f)).text_color(rgb(0x2a6fc4)).font_weight(FontWeight::BOLD))
                    .when(!active, |d| d.text_color(rgb(MUTED)).hover(|s| s.bg(rgba(0x0000000a))))
                    .child(div().size(px(8.)).rounded(px(4.)).bg(rgb(*dot)))
                    .child(*label)
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                        this.tab = i;
                        cx.notify();
                    })),
            );
        }
        side = side.child(div().mt(px(16.)).mb(px(4.)).text_size(px(11.)).font_weight(FontWeight::BOLD).text_color(rgb(MUTED)).child("REGIÕES"));
        for r in REGIONS {
            let down = self.services.iter().filter(|s| s.region == r && status_of(s.cpu) == Status::Down).count();
            side = side.child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .h(px(28.))
                    .px(px(10.))
                    .text_size(px(13.))
                    .child(r)
                    .when(down > 0, |d| {
                        let (_, fg, bg) = status_style(Status::Down);
                        d.child(pill(down.to_string(), fg, bg))
                    }),
            );
        }
        side.child(div().mt_auto().px(px(10.)).text_size(px(11.)).text_color(rgb(MUTED)).child(format!("frame {}", self.tick)))
    }

    fn header(&self) -> Div {
        div()
            .flex()
            .items_center()
            .gap(px(12.))
            .child(
                div()
                    .flex_1()
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .child(div().text_size(px(20.)).font_weight(FontWeight::BOLD).child(TABS[self.tab].1))
                    .child(div().text_size(px(12.)).text_color(rgb(MUTED)).child("Ambiente de produção · atualizado ao vivo")),
            )
            .child(input("Buscar serviço ou região…", true).w(px(260.)))
            .child(button("export", "Exportar"))
            .child(button("new", "Novo serviço").bg(rgb(ACCENT)).border_color(rgb(ACCENT)).text_color(rgb(0xffffff)).font_weight(FontWeight::BOLD))
    }

    fn tab_bar(&self, cx: &mut Context<Self>) -> Div {
        div().flex().gap(px(24.)).border_b_1().border_color(rgba(BORDER)).children(TABS.iter().enumerate().map(|(i, (_, label, _))| {
            let active = self.tab == i;
            div()
                .id(("tab", i))
                .pb(px(8.))
                .border_b(px(3.))
                .cursor_pointer()
                .when(active, |d| d.border_color(rgb(ACCENT)).font_weight(FontWeight::BOLD))
                .when(!active, |d| d.border_color(rgba(0)).text_color(rgb(MUTED)))
                .child(*label)
                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                    this.tab = i;
                    cx.notify();
                }))
        }))
    }

    fn overview(&self) -> Div {
        let t = self.tick as f64;
        let n = self.services.len() as f64;
        let avg = self.services.iter().map(|s| s.cpu as f64).sum::<f64>() / n;
        let down = self.services.iter().filter(|s| status_of(s.cpu) == Status::Down).count();
        let stats = [
            ("Requisições/s", thousands(1200 + js_round((t / 20.0).sin() * 300.0)), (t / 20.0).sin() * 12.0),
            ("CPU média", format!("{avg:.1}%"), avg - 50.0),
            ("Serviços parados", format!("{down} de {}", self.services.len()), -(down as f64) / 10.0),
            ("Latência p95", format!("{:.0} ms", 80.0 + (t / 13.0).cos() * 25.0), (t / 13.0).cos() * 5.0),
        ];
        let cards = div().flex().gap(px(12.)).children(stats.into_iter().map(|(label, value, delta)| {
            let arrow = if delta >= 0.0 { "▲" } else { "▼" };
            let color = if delta >= 0.0 { 0x1c7a45 } else { 0xb3141b };
            card()
                .flex_1()
                .gap(px(6.))
                .child(div().text_size(px(12.)).text_color(rgb(MUTED)).child(label))
                .child(div().text_size(px(26.)).font_weight(FontWeight::BOLD).child(value))
                .child(div().text_size(px(12.)).text_color(rgb(color)).child(format!("{arrow} {:.1}% vs. ontem", delta.abs())))
        }));
        let bars = div().flex_1().min_h(px(160.)).flex().items_end().gap(px(4.)).children((0..32).map(|i| {
            let h = 20.0 + ((t / 15.0 + i as f64 / 3.0).sin() + 1.0) * 60.0 + (i % 5) as f64 * 8.0;
            div().flex_1().h(px(h as f32)).rounded(px(3.)).bg(rgb(if i % 8 == 7 { 0xe5a50a } else { ACCENT }))
        }));
        let traffic = card()
            .flex_grow()
            .flex_basis(relative(0.))
            .flex_shrink()
            .min_w(px(0.))
            .size_full()
            .gap(px(12.))
            .child(
                div()
                    .flex()
                    .justify_between()
                    .child(div().font_weight(FontWeight::BOLD).child("Tráfego por minuto"))
                    .child(div().text_size(px(12.)).text_color(rgb(MUTED)).child(format!("frame {}", self.tick))),
            )
            .child(bars)
            .child(
                div()
                    .flex()
                    .justify_between()
                    .text_size(px(11.))
                    .text_color(rgb(MUTED))
                    .children(["00:00", "06:00", "12:00", "18:00", "24:00"]),
            );
        let activity = card()
            .w(relative(1. / 3.))
            .flex_none()
            .h_full()
            .gap(px(12.))
            .child(div().font_weight(FontWeight::BOLD).child("Atividade recente"))
            .child(div().id("activity").flex_1().min_h(px(0.)).overflow_y_scroll().flex().flex_col().gap(px(8.)).children(
                self.activity.iter().map(|a| {
                    div()
                        .flex()
                        .gap(px(10.))
                        .child(div().mt(px(6.)).size(px(8.)).flex_none().rounded(px(4.)).bg(rgb(LEVELS[a.level].1)))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(2.))
                                .child(div().text_size(px(13.)).child(a.text.clone()))
                                .child(div().text_size(px(11.)).text_color(rgb(MUTED)).child(a.time.clone())),
                        )
                }),
            ));
        div()
            .size_full()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(cards)
            .child(div().flex_1().min_h(px(0.)).flex().gap(px(12.)).child(traffic).child(activity))
    }

    fn refresh_rows(&mut self) {
        let (key, desc) = self.sort;
        let sv = &self.services;
        let mut rows: Vec<usize> = (0..sv.len()).filter(|&i| !self.only_problems || status_of(sv[i].cpu) != Status::Ok).collect();
        rows.sort_by(|&a, &b| {
            let (a, b) = (&sv[a], &sv[b]);
            let o = match key {
                SortKey::Id => a.id.cmp(&b.id),
                SortKey::Name => a.name.cmp(&b.name),
                SortKey::Cpu => a.cpu.cmp(&b.cpu),
                SortKey::Mem => a.mem.cmp(&b.mem),
            };
            if desc { o.reverse() } else { o }
        });
        self.rows = rows;
        self.rows_dirty = false;
    }

    fn services_tab(&mut self, cx: &mut Context<Self>) -> Div {
        if self.rows_dirty {
            self.refresh_rows();
        }
        let columns: [(Option<SortKey>, &str, f32); 6] = [
            (Some(SortKey::Id), "#", 50.0),
            (Some(SortKey::Name), "Serviço", 0.0),
            (None, "Região", 110.0),
            (None, "Status", 80.0),
            (Some(SortKey::Cpu), "CPU", 170.0),
            (Some(SortKey::Mem), "Memória", 90.0),
        ];
        let sort = self.sort;
        let head = div()
            .flex()
            .gap(px(12.))
            .py(px(8.))
            .pl(px(12.))
            .pr(px(24.))
            .bg(rgba(0x00000006))
            .border_b_1()
            .border_color(rgba(BORDER))
            .text_size(px(12.))
            .font_weight(FontWeight::BOLD)
            .children(columns.into_iter().enumerate().map(|(i, (key, label, w))| {
                let active = key.is_some() && key == Some(sort.0);
                let text = format!("{label}{}", if active { if sort.1 { " ↓" } else { " ↑" } } else { "" });
                div()
                    .id(("col", i))
                    .when(w == 0.0, |d| d.flex_1().min_w(px(0.)))
                    .when(w > 0.0, |d| d.w(px(w)).flex_none())
                    .text_color(rgb(if active { ACCENT } else { MUTED }))
                    .child(text)
                    .when_some(key, |d, k| {
                        d.cursor_pointer().on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                            this.sort = (k, if this.sort.0 == k { !this.sort.1 } else { k == SortKey::Cpu || k == SortKey::Mem });
                            this.rows_dirty = true;
                            cx.notify();
                        }))
                    })
            }));
        // Every row is built (no uniform_list), like the DOM, egui and nodebuilder versions.
        let rows = self.rows.iter().map(|&i| {
            let s = &self.services[i];
            let (label, fg, bg) = status_style(status_of(s.cpu));
            div()
                .id(("row", i))
                .flex()
                .flex_none()
                .items_center()
                .gap(px(12.))
                .h(px(32.))
                .px(px(12.))
                .hover(|st| st.bg(rgba(0x3584e40d)))
                .child(div().w(px(50.)).flex_none().text_size(px(12.)).text_color(rgb(MUTED)).child(s.id.to_string()))
                .child(div().flex_1().min_w(px(0.)).text_size(px(13.)).child(s.name.clone()))
                .child(div().w(px(110.)).flex_none().text_size(px(12.)).text_color(rgb(MUTED)).child(s.region))
                .child(div().w(px(80.)).flex_none().flex().child(pill(label.to_string(), fg, bg)))
                .child(div().w(px(170.)).flex_none().flex().items_center().gap(px(8.)).child(meter(s.cpu)).child(div().text_size(px(12.)).child(format!("{}%", s.cpu))))
                .child(div().w(px(90.)).flex_none().text_size(px(12.)).child(format!("{} MB", s.mem)))
        });
        let only = self.only_problems;
        card()
            .p(px(0.))
            .size_full()
            .overflow_hidden()
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .py(px(12.))
                    .px(px(16.))
                    .border_b_1()
                    .border_color(rgba(BORDER))
                    .child(div().font_weight(FontWeight::BOLD).child(format!("{} serviços", self.rows.len())))
                    .child(checkbox("only", only, "Só com problema").on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
                        this.only_problems = !this.only_problems;
                        this.rows_dirty = true;
                        cx.notify();
                    }))),
            )
            .child(head)
            .child(
                div()
                    .id("services")
                    .flex_1()
                    .min_h(px(0.))
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .py(px(4.))
                    .when(self.rows.is_empty(), |d| d.child(div().p(px(16.)).text_color(rgb(MUTED)).child("Nenhum serviço encontrado")))
                    .children(rows),
            )
    }

    fn logs_tab(&mut self, cx: &mut Context<Self>) -> Div {
        if !self.paused {
            self.frozen = self.logs.iter().filter(|l| self.levels[l.level]).cloned().collect();
        }
        let mut controls = div().flex().items_center().gap(px(12.));
        for i in 0..3 {
            controls = controls.child(checkbox(("level", i), self.levels[i], LEVELS[i].0).on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                this.levels[i] = !this.levels[i];
                cx.notify();
            })));
        }
        controls = controls.child(button("pause", if self.paused { "Continuar" } else { "Pausar" }).on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
            this.paused = !this.paused;
            cx.notify();
        })));
        card()
            .size_full()
            .gap(px(12.))
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .child(div().font_weight(FontWeight::BOLD).child(format!("{} linhas", self.frozen.len())))
                    .child(controls),
            )
            .child(
                div()
                    .id("logs")
                    .flex_1()
                    .min_h(px(0.))
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .py(px(10.))
                    .px(px(12.))
                    .rounded(px(8.))
                    .bg(rgb(0x1e1e24))
                    .text_size(px(12.))
                    .children(self.frozen.iter().map(|l| {
                        div()
                            .flex()
                            .flex_none()
                            .gap(px(10.))
                            .child(div().text_color(rgb(0x8a8a96)).child(l.time.clone()))
                            .child(div().w(px(40.)).flex_none().font_weight(FontWeight::BOLD).text_color(rgb(LEVELS[l.level].1)).child(LEVELS[l.level].0))
                            .child(div().text_color(rgb(0xe8e8ee)).child(l.text.clone()))
                    })),
            )
    }

    fn settings(&self, cx: &mut Context<Self>) -> Stateful<Div> {
        let field = |label: &'static str, value: &'static str| {
            div()
                .flex_1()
                .flex()
                .flex_col()
                .gap(px(6.))
                .child(div().text_size(px(12.)).font_weight(FontWeight::BOLD).text_color(rgb(MUTED)).child(label))
                .child(input(value, false))
        };
        let general = card()
            .gap(px(14.))
            .child(div().text_size(px(16.)).font_weight(FontWeight::BOLD).child("Geral"))
            .child(div().flex().gap(px(16.)).child(field("Nome da equipe", "Equipe de plataforma")).child(field("E-mail de alertas", "alertas@exemplo.com.br")))
            .child(div().text_size(px(12.)).font_weight(FontWeight::BOLD).text_color(rgb(MUTED)).child("Intervalo de coleta"))
            .child(div().flex().gap(px(8.)).children(["10 s", "30 s", "1 min", "5 min"].iter().enumerate().map(|(i, l)| {
                let active = self.interval == i;
                button(("interval", i), l)
                    .when(active, |d| d.bg(rgb(ACCENT)).border_color(rgb(ACCENT)).text_color(rgb(0xffffff)))
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                        this.interval = i;
                        cx.notify();
                    }))
            })));
        let mut notifications = card().gap(px(12.)).child(div().text_size(px(16.)).font_weight(FontWeight::BOLD).child("Notificações"));
        for (i, (label, on)) in self.flags.iter().enumerate() {
            notifications = notifications.child(checkbox(("flag", i), *on, label).on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                this.flags[i].1 = !this.flags[i].1;
                cx.notify();
            })));
        }
        let danger = card()
            .gap(px(12.))
            .border_color(rgba(0xe01b2440))
            .child(div().text_size(px(16.)).font_weight(FontWeight::BOLD).text_color(rgb(0xe01b24)).child("Zona de perigo"))
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .child(div().text_color(rgb(MUTED)).child("Remove todos os serviços e o histórico de métricas."))
                    .child(button("wipe", "Apagar tudo").bg(rgb(0xe01b24)).border_color(rgb(0xe01b24)).text_color(rgb(0xffffff)).font_weight(FontWeight::BOLD)),
            );
        div().id("settings").size_full().overflow_y_scroll().flex().flex_col().gap(px(16.)).child(general).child(notifications).child(danger)
    }
}

impl Render for Dashboard {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t0 = Instant::now();
        let stepped = self._ticker.is_some() && self.pacer.ready();
        if stepped {
            self.step();
        }
        let content = match self.tab {
            0 => self.overview().into_any_element(),
            1 => self.services_tab(cx).into_any_element(),
            2 => self.logs_tab(cx).into_any_element(),
            _ => self.settings(cx).into_any_element(),
        };
        let el = div()
            .size_full()
            .flex()
            .font_family(FONT)
            .line_height(relative(1.36))
            .text_size(px(14.))
            .text_color(rgb(TEXT))
            .child(self.side(cx))
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.))
                    .h_full()
                    .flex()
                    .flex_col()
                    .gap(px(16.))
                    .py(px(16.))
                    .px(px(20.))
                    .bg(rgb(0xfafafa))
                    .child(self.header())
                    .child(self.tab_bar(cx))
                    .child(div().flex_1().min_h(px(0.)).child(content)),
            );
        if stepped {
            self.pacer.record(t0.elapsed(), &format!(" | {}", TABS[self.tab].0));
        }
        el
    }
}

fn card() -> Div {
    div().flex().flex_col().p(px(16.)).bg(rgb(0xffffff)).border_1().border_color(rgba(BORDER)).rounded(px(12.))
}

fn pill(text: String, fg: u32, bg: u32) -> Div {
    div().px(px(8.)).py(px(2.)).rounded(px(10.)).bg(rgb(bg)).text_color(rgb(fg)).text_size(px(11.)).font_weight(FontWeight::BOLD).child(text)
}

fn meter(value: i32) -> Div {
    let color = if value > 90 { 0xe01b24 } else if value > 70 { 0xe5a50a } else { ACCENT };
    div()
        .w(px(110.))
        .h(px(6.))
        .flex_none()
        .rounded(px(3.))
        .bg(rgba(0x0000000f))
        .child(div().h_full().w(px((value as f32 / 100.0 * 110.0).max(2.0))).rounded(px(3.)).bg(rgb(color)))
}

fn button(id: impl Into<gpui::ElementId>, label: &'static str) -> Stateful<Div> {
    div()
        .id(id)
        .flex()
        .items_center()
        .h(px(32.))
        .px(px(14.))
        .rounded(px(8.))
        .border_1()
        .border_color(rgba(0x0000001f))
        .bg(rgb(0xffffff))
        .cursor_pointer()
        .child(label)
}

fn checkbox(id: impl Into<gpui::ElementId>, checked: bool, label: &'static str) -> Stateful<Div> {
    let mark = div()
        .size(px(16.))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(4.))
        .border_1()
        .text_size(px(11.))
        .text_color(rgb(0xffffff));
    let mark = if checked { mark.bg(rgb(ACCENT)).border_color(rgb(ACCENT)).child("✓") } else { mark.bg(rgb(0xffffff)).border_color(rgba(0x00000040)) };
    div().id(id).flex().items_center().gap(px(8.)).cursor_pointer().child(mark).child(label)
}

/// A text box as it looks unfocused (GPUI ships no text input; see the header comment).
fn input(text: &'static str, placeholder: bool) -> Div {
    let color: Hsla = if placeholder { rgb(0x8a8a96).into() } else { rgb(TEXT).into() };
    div()
        .flex()
        .items_center()
        .h(px(32.))
        .px(px(10.))
        .rounded(px(8.))
        .border_1()
        .border_color(rgba(0x0000001f))
        .bg(rgb(0xffffff))
        .text_color(color)
        .child(text)
}

/// 1234 -> "1.234" (pt-BR, like toLocaleString in the JS version).
fn thousands(v: i32) -> String {
    let s = v.abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push('.');
        }
        out.push(c);
    }
    if v < 0 { format!("-{out}") } else { out }
}

// ---- app ---------------------------------------------------------------------------------

fn main() {
    let dashboard = env("SCENE", "") == "dashboard";
    Application::new().run(move |cx: &mut App| {
        let (w, h) = if dashboard { (1200., 800.) } else { (1000., 720.) };
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(None, size(px(w), px(h)), cx))),
            app_id: Some("nodebuilder-gpui-baseline".into()),
            ..Default::default()
        };
        if dashboard {
            cx.open_window(options, |_, cx| cx.new(Dashboard::new)).unwrap();
        } else {
            cx.open_window(options, |_, cx| {
                cx.new(|cx| {
                    let pacer = Pacer::new();
                    let mode = env("MODE", "one");
                    let ticker = (mode != "static").then(|| ticker(cx, pacer.interval, |g: &mut Grid| &mut g.pacer));
                    Grid { n: env("N", "1000").parse().unwrap_or(1000), mode, tick: 0, pacer, _ticker: ticker }
                })
            })
            .unwrap();
        }
        cx.activate(true);
    });
}
