// egui baseline: the same two scenes as compare/electron (renderer.js = grid, dashboard.js =
// dashboard), same data (same seeded RNG and call order), same fps cap rule and the same
// `fps ...` stdout lines that scripts/compare.sh averages. Options come from the env vars
// shared by every baseline: SCENE, N, MODE, NB_MAX_FPS, TAB, ROWS, LIVE, CYCLE.
use eframe::egui::{
    self, Align, Color32, CornerRadius, Frame, Layout, Margin, RichText, ScrollArea, Sense, Stroke, Ui, Vec2,
};
use std::collections::VecDeque;
use std::io::Write;
use std::time::{Duration, Instant};

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.into())
}

fn hex(s: &str) -> Color32 {
    let v = |i: usize| u8::from_str_radix(&s[i..i + 2], 16).unwrap();
    if s.len() == 9 { Color32::from_rgba_unmultiplied(v(1), v(3), v(5), v(7)) } else { Color32::from_rgb(v(1), v(3), v(5)) }
}

const TEXT: &str = "#1f1f24";
const MUTED: &str = "#6b6b76";
const ACCENT: &str = "#3584e4";

// ---- frame pacing (same rule as the JS baselines) -------------------------------

struct Pacer {
    /// 1000 / max fps; a step is due `min_interval` (1.5 ms tolerance) after the last one.
    interval: f64,
    min_interval: f64,
    last: Option<Instant>,
    frames: u32,
    work_ms: f64,
    since: Instant,
}

impl Pacer {
    fn new() -> Self {
        let max_fps: f64 = env("NB_MAX_FPS", "120").parse().unwrap_or(120.0);
        Self { interval: 1000.0 / max_fps, min_interval: 1000.0 / max_fps - 1.5, last: None, frames: 0, work_ms: 0.0, since: Instant::now() }
    }

    /// True when a new step is due; otherwise schedules a repaint for when it will be.
    fn ready(&mut self, ctx: &egui::Context) -> bool {
        let now = Instant::now();
        if let Some(last) = self.last {
            let elapsed = (now - last).as_secs_f64() * 1000.0;
            if elapsed < self.min_interval {
                ctx.request_repaint_after(Duration::from_secs_f64((self.min_interval - elapsed) / 1000.0));
                return false;
            }
        }
        self.last = Some(now);
        true
    }

    /// Counts a stepped frame, prints once per second and asks for the next frame one full
    /// interval after this step. In the browser the 1.5 ms tolerance is safe because rAF is
    /// vblank-aligned; egui's timed repaints are not, so scheduling at `min_interval` would
    /// overshoot the cap. A delayed repaint (not request_repaint) also keeps egui from
    /// building extra frames between steps.
    fn record(&mut self, ctx: &egui::Context, work: Duration, suffix: &str) {
        self.frames += 1;
        self.work_ms += work.as_secs_f64() * 1000.0;
        let elapsed = self.since.elapsed().as_secs_f64();
        if elapsed >= 1.0 {
            println!(
                "fps {} | rust {:.2} ms/frame{}",
                (self.frames as f64 / elapsed).round(),
                self.work_ms / self.frames as f64,
                suffix
            );
            let _ = std::io::stdout().flush();
            self.frames = 0;
            self.work_ms = 0.0;
            self.since = Instant::now();
        }
        let since_step = self.last.map_or(0.0, |l| l.elapsed().as_secs_f64() * 1000.0);
        ctx.request_repaint_after(Duration::from_secs_f64((self.interval - since_step).max(0.0) / 1000.0));
    }
}

// ---- grid scene (renderer.js) ------------------------------------------------------

struct Grid {
    n: usize,
    mode: String,
    tick: u64,
    pacer: Pacer,
}

const HUES: [&str; 4] = ["#e8f0fe", "#fde8e8", "#e6f4ea", "#fef7e0"];

impl Grid {
    fn ui(&mut self, ui: &mut Ui) {
        let t0 = Instant::now();
        let ctx = ui.ctx().clone();
        let stepped = self.mode != "static" && self.pacer.ready(&ctx);
        if stepped {
            self.tick += 1;
        }
        let all = self.mode == "all";
        egui::CentralPanel::default()
            .frame(Frame::new().fill(hex("#fafafa")).inner_margin(Margin::same(12)))
            .show(ui, |ui| {
                ui.spacing_mut().item_spacing = Vec2::splat(8.0);
                ui.label(RichText::new(format!("Frame {}", self.tick)).size(16.0).strong().color(hex(TEXT)));
                ScrollArea::vertical().auto_shrink(false).show(ui, |ui| {
                    ui.spacing_mut().item_spacing = Vec2::splat(4.0);
                    let stroke = Stroke::new(1.0, hex("#00000014"));
                    let cell_w = ((ui.available_width() - 9.0 * 4.0) / 10.0).floor();
                    for row in 0..self.n.div_ceil(10) {
                        ui.horizontal(|ui| {
                            for i in row * 10..(row * 10 + 10).min(self.n) {
                                let label = if all { format!("#{i} · {}", (self.tick + i as u64) % 1000) } else { format!("#{i}") };
                                Frame::new()
                                    .fill(hex(HUES[i % 4]))
                                    .stroke(stroke)
                                    .corner_radius(CornerRadius::same(6))
                                    .inner_margin(Margin::symmetric(8, 6))
                                    .show(ui, |ui| {
                                        ui.set_width(cell_w - 18.0);
                                        ui.label(RichText::new(label).size(12.0).color(hex(TEXT)));
                                    });
                            }
                        });
                    }
                });
            });
        if stepped {
            self.pacer.record(&ctx, t0.elapsed(), "");
        }
    }
}

// ---- dashboard scene (dashboard.js) ---------------------------------------------------

const TABS: [(&str, &str, &str); 4] = [
    ("overview", "Visão geral", "#3584e4"),
    ("table", "Serviços", "#26a269"),
    ("logs", "Logs", "#e5a50a"),
    ("settings", "Configurações", "#9141ac"),
];
const NAMES: [&str; 10] = ["api", "auth", "billing", "cache", "search", "mailer", "queue", "gateway", "storage", "metrics"];
const REGIONS: [&str; 4] = ["sa-east-1", "us-east-1", "eu-west-1", "ap-south-1"];
const MESSAGES: [&str; 9] = [
    "requisição concluída em 12 ms", "conexão com o banco reaberta", "cache invalidado para /usuarios",
    "tempo de resposta acima do limite", "job de faturamento agendado", "certificado renovado",
    "falha ao enviar e-mail: tempo esgotado", "réplica sincronizada", "novo deploy recebido (v2.14.3)",
];
const LEVELS: [(&str, &str); 3] = [("INFO", "#3584e4"), ("WARN", "#e5a50a"), ("ERRO", "#e01b24")];

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
fn status_style(s: Status) -> (&'static str, &'static str, &'static str) {
    match s {
        Status::Ok => ("ativo", "#1c7a45", "#e6f4ea"),
        Status::Warn => ("lento", "#8a6100", "#fef7e0"),
        Status::Down => ("parado", "#b3141b", "#fde8e8"),
    }
}

struct Service { id: usize, name: String, region: &'static str, cpu: i32, mem: i32 }

#[derive(Clone)]
struct Log { time: String, level: usize, text: String }

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
    live: bool,
    cycle: u64,
    query: String,
    pacer: Pacer,
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
    team: String,
    email: String,
    interval: usize,
    flags: Vec<(&'static str, bool)>,
}

impl Dashboard {
    fn new() -> Self {
        let mut rng = Rng(42.0);
        let rows: usize = env("ROWS", "500").parse().unwrap_or(500);
        let services = (0..rows)
            .map(|id| {
                let cpu = js_round(rng.next() * 100.0);
                let name = format!("{}-{id}", rng.pick(&NAMES));
                let region = rng.pick(&REGIONS);
                let mem = js_round(64.0 + rng.next() * 4000.0);
                Service { id, name, region, cpu, mem }
            })
            .collect();
        let mut d = Self {
            rng,
            services,
            logs: VecDeque::new(),
            activity: VecDeque::new(),
            log_id: 0,
            tick: 0,
            tab: TABS.iter().position(|t| t.0 == env("TAB", "overview")).unwrap_or(0),
            live: env("LIVE", "1") != "0",
            cycle: env("CYCLE", "0").parse().unwrap_or(0),
            query: String::new(),
            pacer: Pacer::new(),
            sort: (SortKey::Id, false),
            only_problems: false,
            rows: Vec::new(),
            rows_dirty: true,
            levels: [true; 3],
            paused: false,
            frozen: Vec::new(),
            team: "Equipe de plataforma".into(),
            email: "alertas@exemplo.com.br".into(),
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
        let time = format!("{:02}:{:02}:{:02}", (s / 3600) % 24, (s / 60) % 60, s % 60);
        let level = if r < 0.75 { 0 } else if r < 0.93 { 1 } else { 2 };
        let text = format!("{}: {}", self.rng.pick(&NAMES), self.rng.pick(&MESSAGES));
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

    fn ui(&mut self, ui: &mut Ui) {
        let t0 = Instant::now();
        let ctx = ui.ctx().clone();
        let stepped = (self.live || self.cycle > 0) && self.pacer.ready(&ctx);
        if stepped {
            self.step();
        }
        self.side(ui);
        egui::CentralPanel::default()
            .frame(Frame::new().fill(hex("#fafafa")).inner_margin(Margin::symmetric(20, 16)))
            .show(ui, |ui| {
                ui.spacing_mut().item_spacing = Vec2::splat(12.0);
                self.header(ui);
                self.tab_bar(ui);
                ui.separator();
                match self.tab {
                    0 => self.overview(ui),
                    1 => self.services_tab(ui),
                    2 => self.logs_tab(ui),
                    _ => self.settings(ui),
                }
            });
        if stepped {
            let suffix = format!(" | {}", TABS[self.tab].0);
            self.pacer.record(&ctx, t0.elapsed(), &suffix);
        }
    }

    fn side(&mut self, ui: &mut Ui) {
        egui::Panel::left("side")
            .exact_size(220.0)
            .resizable(false)
            .frame(Frame::new().fill(hex("#f1f1f4")).inner_margin(Margin::symmetric(12, 16)))
            .show(ui, |ui| {
                ui.spacing_mut().item_spacing = Vec2::splat(4.0);
                ui.label(RichText::new("Observa").size(18.0).strong().color(hex(TEXT)));
                ui.add_space(8.0);
                for (i, (_, label, dot)) in TABS.iter().enumerate() {
                    let active = self.tab == i;
                    ui.horizontal(|ui| {
                        ui.label(RichText::new("●").color(hex(dot)));
                        let text = RichText::new(*label).color(hex(if active { "#2a6fc4" } else { MUTED }));
                        let text = if active { text.strong() } else { text };
                        if ui.add_sized([170.0, 30.0], egui::Button::selectable(active, text)).clicked() {
                            self.tab = i;
                        }
                    });
                }
                ui.add_space(16.0);
                ui.label(RichText::new("REGIÕES").size(11.0).strong().color(hex(MUTED)));
                for r in REGIONS {
                    let down = self.services.iter().filter(|s| s.region == r && status_of(s.cpu) == Status::Down).count();
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(r).size(13.0).color(hex(TEXT)));
                        if down > 0 {
                            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                let (_, fg, bg) = status_style(Status::Down);
                                pill(ui, &down.to_string(), fg, bg);
                            });
                        }
                    });
                }
                ui.with_layout(Layout::bottom_up(Align::Min), |ui| {
                    ui.label(RichText::new(format!("frame {}", self.tick)).size(11.0).color(hex(MUTED)));
                });
            });
    }

    fn header(&mut self, ui: &mut Ui) {
        ui.horizontal(|ui| {
            ui.vertical(|ui| {
                ui.spacing_mut().item_spacing.y = 2.0;
                ui.label(RichText::new(TABS[self.tab].1).size(20.0).strong().color(hex(TEXT)));
                ui.label(RichText::new("Ambiente de produção · atualizado ao vivo").size(12.0).color(hex(MUTED)));
            });
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                let _ = ui.add(egui::Button::new(RichText::new("Novo serviço").strong().color(Color32::WHITE)).fill(hex(ACCENT)));
                let _ = ui.button("Exportar");
                let search = ui.add(egui::TextEdit::singleline(&mut self.query).hint_text("Buscar serviço ou região…").desired_width(260.0));
                if search.changed() {
                    self.rows_dirty = true;
                    self.tab = 1;
                }
            });
        });
    }

    fn tab_bar(&mut self, ui: &mut Ui) {
        ui.horizontal(|ui| {
            for (i, (_, label, _)) in TABS.iter().enumerate() {
                let active = self.tab == i;
                let text = RichText::new(*label).color(hex(if active { TEXT } else { MUTED }));
                let text = if active { text.strong() } else { text };
                let r = ui.add(egui::Label::new(text).sense(Sense::click()));
                if active {
                    let rect = r.rect;
                    ui.painter().rect_filled(
                        egui::Rect::from_min_max(egui::pos2(rect.left(), rect.bottom() + 4.0), egui::pos2(rect.right(), rect.bottom() + 7.0)),
                        2,
                        hex(ACCENT),
                    );
                }
                if r.clicked() {
                    self.tab = i;
                }
                ui.add_space(12.0);
            }
        });
    }

    fn overview(&mut self, ui: &mut Ui) {
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
        ui.columns(4, |cols| {
            for (col, (label, value, delta)) in cols.iter_mut().zip(stats) {
                card().show(col, |ui| {
                    ui.set_width(ui.available_width());
                    ui.spacing_mut().item_spacing.y = 6.0;
                    ui.label(RichText::new(label).size(12.0).color(hex(MUTED)));
                    ui.label(RichText::new(value).size(26.0).strong().color(hex(TEXT)));
                    let arrow = if delta >= 0.0 { "▲" } else { "▼" };
                    let color = if delta >= 0.0 { "#1c7a45" } else { "#b3141b" };
                    ui.label(RichText::new(format!("{arrow} {:.1}% vs. ontem", delta.abs())).size(12.0).color(hex(color)));
                });
            }
        });
        let width = ui.available_width() - 12.0 - 2.0 * 34.0;
        let height = ui.available_height() - 34.0;
        ui.horizontal_top(|ui| {
            card().show(ui, |ui| {
                ui.set_width(width * 2.0 / 3.0);
                ui.set_height(height);
                ui.horizontal(|ui| {
                    ui.label(RichText::new("Tráfego por minuto").strong().color(hex(TEXT)));
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        ui.label(RichText::new(format!("frame {}", self.tick)).size(12.0).color(hex(MUTED)));
                    });
                });
                let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), (ui.available_height() - 30.0).max(160.0)), Sense::hover());
                let bar_w = (rect.width() - 31.0 * 4.0) / 32.0;
                for i in 0..32 {
                    let h = 20.0 + ((t / 15.0 + i as f64 / 3.0).sin() + 1.0) * 60.0 + (i % 5) as f64 * 8.0;
                    let x = rect.left() + i as f32 * (bar_w + 4.0);
                    let bar = egui::Rect::from_min_max(egui::pos2(x, rect.bottom() - h as f32), egui::pos2(x + bar_w, rect.bottom()));
                    ui.painter().rect_filled(bar, 3, hex(if i % 8 == 7 { "#e5a50a" } else { ACCENT }));
                }
                ui.horizontal(|ui| {
                    let labels = ["00:00", "06:00", "12:00", "18:00", "24:00"];
                    let gap = (ui.available_width() - 5.0 * 30.0) / 4.0;
                    for l in labels {
                        ui.label(RichText::new(l).size(11.0).color(hex(MUTED)));
                        ui.add_space(gap - ui.spacing().item_spacing.x);
                    }
                });
            });
            card().show(ui, |ui| {
                ui.set_width(width / 3.0);
                ui.set_height(height);
                ui.label(RichText::new("Atividade recente").strong().color(hex(TEXT)));
                ScrollArea::vertical().id_salt("activity").auto_shrink(false).show(ui, |ui| {
                    ui.spacing_mut().item_spacing.y = 8.0;
                    for a in &self.activity {
                        ui.horizontal(|ui| {
                            ui.label(RichText::new("●").size(10.0).color(hex(LEVELS[a.level].1)));
                            ui.vertical(|ui| {
                                ui.spacing_mut().item_spacing.y = 2.0;
                                ui.label(RichText::new(&a.text).size(13.0).color(hex(TEXT)));
                                ui.label(RichText::new(&a.time).size(11.0).color(hex(MUTED)));
                            });
                        });
                    }
                });
            });
        });
    }

    fn refresh_rows(&mut self) {
        let q = self.query.to_lowercase();
        let (key, desc) = self.sort;
        let mut rows: Vec<usize> = (0..self.services.len())
            .filter(|&i| {
                let s = &self.services[i];
                (q.is_empty() || s.name.contains(&q) || s.region.contains(&q)) && (!self.only_problems || status_of(s.cpu) != Status::Ok)
            })
            .collect();
        let sv = &self.services;
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

    fn services_tab(&mut self, ui: &mut Ui) {
        if self.rows_dirty {
            self.refresh_rows();
        }
        card().inner_margin(Margin::ZERO).show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.set_height(ui.available_height());
            ui.spacing_mut().item_spacing = Vec2::new(12.0, 0.0);
            Frame::new().inner_margin(Margin::symmetric(16, 12)).show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(RichText::new(format!("{} serviços", self.rows.len())).strong().color(hex(TEXT)));
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui.checkbox(&mut self.only_problems, "Só com problema").changed() {
                            self.rows_dirty = true;
                        }
                    });
                });
            });
            ui.separator();
            let columns: [(Option<SortKey>, &str, f32); 6] = [
                (Some(SortKey::Id), "#", 50.0),
                (Some(SortKey::Name), "Serviço", 0.0),
                (None, "Região", 110.0),
                (None, "Status", 80.0),
                (Some(SortKey::Cpu), "CPU", 170.0),
                (Some(SortKey::Mem), "Memória", 90.0),
            ];
            let fixed: f32 = columns.iter().map(|c| c.2).sum::<f32>() + 5.0 * 12.0 + 36.0;
            Frame::new().fill(hex("#00000006")).inner_margin(Margin { left: 12, right: 24, top: 8, bottom: 8 }).show(ui, |ui| {
                let name_w = (ui.available_width() - fixed + 36.0).max(60.0);
                ui.horizontal(|ui| {
                    for (key, label, w) in columns {
                        let active = key.is_some() && key == Some(self.sort.0);
                        let text = format!("{label}{}", if active { if self.sort.1 { " ↓" } else { " ↑" } } else { "" });
                        let w = if w == 0.0 { name_w } else { w };
                        let r = ui.add_sized(
                            [w, 16.0],
                            egui::Label::new(RichText::new(text).size(12.0).strong().color(hex(if active { ACCENT } else { MUTED }))).sense(Sense::click()),
                        );
                        if let (true, Some(k)) = (r.clicked(), key) {
                            self.sort = (k, if self.sort.0 == k { !self.sort.1 } else { k == SortKey::Cpu || k == SortKey::Mem });
                            self.rows_dirty = true;
                        }
                    }
                });
            });
            ui.separator();
            // Every row is laid out (no show_rows), like the DOM and nodebuilder versions.
            ScrollArea::vertical().id_salt("services").auto_shrink(false).show(ui, |ui| {
                Frame::new().inner_margin(Margin { left: 0, right: 12, top: 4, bottom: 4 }).show(ui, |ui| {
                    let name_w = (ui.available_width() - fixed).max(60.0);
                    if self.rows.is_empty() {
                        ui.label(RichText::new("Nenhum serviço encontrado").color(hex(MUTED)));
                    }
                    for &i in &self.rows {
                        let s = &self.services[i];
                        let row_rect = egui::Rect::from_min_size(ui.cursor().min, Vec2::new(ui.available_width(), 32.0));
                        let hovered = ui.rect_contains_pointer(row_rect);
                        ui.allocate_ui_with_layout(Vec2::new(ui.available_width(), 32.0), Layout::left_to_right(Align::Center), |ui| {
                            ui.add_space(12.0);
                            ui.add_sized([50.0, 16.0], egui::Label::new(RichText::new(s.id.to_string()).size(12.0).color(hex(MUTED))));
                            let name = RichText::new(&s.name).size(13.0).color(hex(TEXT));
                            ui.add_sized([name_w, 16.0], egui::Label::new(if hovered { name.strong() } else { name }));
                            ui.add_sized([110.0, 16.0], egui::Label::new(RichText::new(s.region).size(12.0).color(hex(MUTED))));
                            ui.allocate_ui_with_layout(Vec2::new(80.0, 20.0), Layout::left_to_right(Align::Center), |ui| {
                                let (label, fg, bg) = status_style(status_of(s.cpu));
                                pill(ui, label, fg, bg);
                            });
                            ui.allocate_ui_with_layout(Vec2::new(170.0, 20.0), Layout::left_to_right(Align::Center), |ui| {
                                ui.spacing_mut().item_spacing.x = 8.0;
                                meter(ui, s.cpu);
                                ui.label(RichText::new(format!("{}%", s.cpu)).size(12.0).color(hex(TEXT)));
                            });
                            ui.add_sized([90.0, 16.0], egui::Label::new(RichText::new(format!("{} MB", s.mem)).size(12.0).color(hex(TEXT))));
                        });
                    }
                });
            });
        });
    }

    fn logs_tab(&mut self, ui: &mut Ui) {
        if !self.paused {
            self.frozen = self.logs.iter().filter(|l| self.levels[l.level]).cloned().collect();
        }
        card().show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.set_height(ui.available_height());
            ui.horizontal(|ui| {
                ui.label(RichText::new(format!("{} linhas", self.frozen.len())).strong().color(hex(TEXT)));
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if ui.button(if self.paused { "Continuar" } else { "Pausar" }).clicked() {
                        self.paused = !self.paused;
                    }
                    for i in (0..3).rev() {
                        ui.checkbox(&mut self.levels[i], LEVELS[i].0);
                    }
                });
            });
            Frame::new().fill(hex("#1e1e24")).corner_radius(CornerRadius::same(8)).inner_margin(Margin::symmetric(12, 10)).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.set_height(ui.available_height());
                ScrollArea::vertical().id_salt("logs").auto_shrink(false).show(ui, |ui| {
                    ui.spacing_mut().item_spacing = Vec2::new(10.0, 2.0);
                    for l in &self.frozen {
                        ui.horizontal(|ui| {
                            ui.label(RichText::new(&l.time).size(12.0).color(hex("#8a8a96")));
                            ui.add_sized([40.0, 14.0], egui::Label::new(RichText::new(LEVELS[l.level].0).size(12.0).strong().color(hex(LEVELS[l.level].1))));
                            ui.label(RichText::new(&l.text).size(12.0).color(hex("#e8e8ee")));
                        });
                    }
                });
            });
        });
    }

    fn settings(&mut self, ui: &mut Ui) {
        ScrollArea::vertical().id_salt("settings").auto_shrink(false).show(ui, |ui| {
            ui.spacing_mut().item_spacing.y = 16.0;
            card().show(ui, |ui| {
                ui.set_width(ui.available_width() - 12.0);
                ui.spacing_mut().item_spacing.y = 14.0;
                ui.label(RichText::new("Geral").size(16.0).strong().color(hex(TEXT)));
                ui.columns(2, |cols| {
                    for (col, (label, value)) in cols.iter_mut().zip([("Nome da equipe", &mut self.team), ("E-mail de alertas", &mut self.email)]) {
                        col.label(RichText::new(label).size(12.0).strong().color(hex(MUTED)));
                        col.add(egui::TextEdit::singleline(value).desired_width(f32::INFINITY));
                    }
                });
                ui.label(RichText::new("Intervalo de coleta").size(12.0).strong().color(hex(MUTED)));
                ui.horizontal(|ui| {
                    for (i, l) in ["10 s", "30 s", "1 min", "5 min"].iter().enumerate() {
                        if ui.add(egui::Button::selectable(self.interval == i, *l)).clicked() {
                            self.interval = i;
                        }
                    }
                });
            });
            card().show(ui, |ui| {
                ui.set_width(ui.available_width() - 12.0);
                ui.spacing_mut().item_spacing.y = 12.0;
                ui.label(RichText::new("Notificações").size(16.0).strong().color(hex(TEXT)));
                for (label, on) in &mut self.flags {
                    ui.checkbox(on, *label);
                }
            });
            card().stroke(Stroke::new(1.0, hex("#e01b2440"))).show(ui, |ui| {
                ui.set_width(ui.available_width() - 12.0);
                ui.spacing_mut().item_spacing.y = 12.0;
                ui.label(RichText::new("Zona de perigo").size(16.0).strong().color(hex("#e01b24")));
                ui.horizontal(|ui| {
                    ui.label(RichText::new("Remove todos os serviços e o histórico de métricas.").color(hex(MUTED)));
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        let _ = ui.add(egui::Button::new(RichText::new("Apagar tudo").strong().color(Color32::WHITE)).fill(hex("#e01b24")));
                    });
                });
            });
        });
    }
}

fn card() -> Frame {
    Frame::new()
        .fill(Color32::WHITE)
        .stroke(Stroke::new(1.0, hex("#00000014")))
        .corner_radius(CornerRadius::same(12))
        .inner_margin(Margin::same(16))
}

fn pill(ui: &mut Ui, text: &str, fg: &str, bg: &str) {
    Frame::new().fill(hex(bg)).corner_radius(CornerRadius::same(10)).inner_margin(Margin::symmetric(8, 2)).show(ui, |ui| {
        ui.label(RichText::new(text).size(11.0).strong().color(hex(fg)));
    });
}

fn meter(ui: &mut Ui, value: i32) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(110.0, 6.0), Sense::hover());
    ui.painter().rect_filled(rect, 3, hex("#0000000f"));
    let color = if value > 90 { "#e01b24" } else if value > 70 { "#e5a50a" } else { ACCENT };
    let fill = egui::Rect::from_min_size(rect.min, Vec2::new((value as f32 / 100.0 * 110.0).max(2.0), 6.0));
    ui.painter().rect_filled(fill, 3, hex(color));
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

// ---- app -------------------------------------------------------------------------------

enum Scene {
    Grid(Grid),
    Dashboard(Box<Dashboard>),
}

impl eframe::App for Scene {
    fn ui(&mut self, ui: &mut Ui, _frame: &mut eframe::Frame) {
        match self {
            Scene::Grid(g) => g.ui(ui),
            Scene::Dashboard(d) => d.ui(ui),
        }
    }
}

fn main() -> eframe::Result {
    let dashboard = env("SCENE", "") == "dashboard";
    let size = if dashboard { [1200.0, 800.0] } else { [1000.0, 720.0] };
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_title("Bench (egui)").with_inner_size(size),
        ..Default::default()
    };
    eframe::run_native(
        "Bench (egui)",
        options,
        Box::new(move |cc| {
            cc.egui_ctx.set_visuals(egui::Visuals::light());
            cc.egui_ctx.all_styles_mut(|style| {
                for (text_style, font) in style.text_styles.iter_mut() {
                    if matches!(text_style, egui::TextStyle::Body | egui::TextStyle::Button) {
                        font.size = 14.0;
                    }
                }
            });
            Ok(Box::new(if dashboard {
                Scene::Dashboard(Box::new(Dashboard::new()))
            } else {
                Scene::Grid(Grid { n: env("N", "1000").parse().unwrap_or(1000), mode: env("MODE", "one"), tick: 0, pacer: Pacer::new() })
            }))
        }),
    )
}
