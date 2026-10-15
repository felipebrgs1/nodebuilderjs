// Flutter mirror of the benchmark scenes: SCENE=dashboard is examples/bench/dashboard.tsx /
// compare/electron/dashboard.js, anything else is the cell grid of examples/bench/bench.tsx /
// compare/electron/renderer.js. Same env vars, same seeded data, same fps cap and log format.
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

final env = Platform.environment;
final scene = env['SCENE'] ?? '';
final n = int.tryParse(env['N'] ?? '') ?? 1000;
final mode = env['MODE'] ?? 'one';
final maxFps = double.tryParse(env['NB_MAX_FPS'] ?? '') ?? 120;
final rowsCount = int.tryParse(env['ROWS'] ?? '') ?? 500;
final live = env['LIVE'] != '0';
final cycle = int.tryParse(env['CYCLE'] ?? '') ?? 0;

const ink = Color(0xFF1F1F24);
const muted = Color(0xFF6B6B76);
const accent = Color(0xFF3584E4);
const danger = Color(0xFFE01B24);
const warnColor = Color(0xFFE5A50A);

void main() => runApp(const BenchApp());

class BenchApp extends StatelessWidget {
  const BenchApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(scaffoldBackgroundColor: const Color(0xFFFAFAFA), colorSchemeSeed: accent),
      home: Material(
        color: const Color(0xFFFAFAFA),
        child: DefaultTextStyle(
          style: const TextStyle(fontSize: 14, color: ink),
          child: scene == 'dashboard' ? const DashboardPage() : const GridPage(),
        ),
      ),
    );
  }
}

/// Same cap and report as the JS versions: skip frames closer than 1000/MAX_FPS - 1.5 ms,
/// print `fps <n> | dart <ms> ms/frame` once per second.
class FrameMeter {
  final double minInterval = 1000 / maxFps - 1.5;
  double last = double.negativeInfinity;
  double since = 0;
  int frames = 0;
  double work = 0;

  bool shouldRun(double now) {
    if (now - last < minInterval) return false;
    last = now;
    return true;
  }

  void record(double now, double ms, [String suffix = '']) {
    work += ms;
    frames++;
    if (now - since >= 1000) {
      final fps = (frames * 1000 / (now - since)).round();
      stdout.writeln('fps $fps | dart ${(work / frames).toStringAsFixed(2)} ms/frame$suffix');
      frames = 0;
      work = 0;
      since = now;
    }
  }
}

double elapsedMs(Stopwatch s) => s.elapsedMicroseconds / 1000;

// ---- grid (renderer.js) ------------------------------------------------------

const hues = [Color(0xFFE8F0FE), Color(0xFFFDE8E8), Color(0xFFE6F4EA), Color(0xFFFEF7E0)];

class GridPage extends StatefulWidget {
  const GridPage({super.key});

  @override
  State<GridPage> createState() => _GridPageState();
}

class _GridPageState extends State<GridPage> with SingleTickerProviderStateMixin {
  final tick = ValueNotifier<int>(0);
  final meter = FrameMeter();
  late final Ticker ticker = createTicker(onFrame);

  @override
  void initState() {
    super.initState();
    if (mode != 'static') ticker.start();
  }

  void onFrame(Duration elapsed) {
    final now = elapsed.inMicroseconds / 1000;
    if (!meter.shouldRun(now)) return;
    final s = Stopwatch()..start();
    tick.value++;
    meter.record(now, elapsedMs(s));
  }

  @override
  void dispose() {
    ticker.dispose();
    super.dispose();
  }

  Widget cell(int i, int t) => Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
          decoration: BoxDecoration(
            color: hues[i % 4],
            borderRadius: BorderRadius.circular(6),
            border: Border.all(color: const Color(0x14000000)),
          ),
          child: Text(mode == 'all' ? '#$i · ${(t + i) % 1000}' : '#$i', style: const TextStyle(fontSize: 12)),
        ),
      );

  Widget grid(int t) {
    final rows = <Widget>[];
    for (var r = 0; r * 10 < n; r++) {
      rows.add(Row(spacing: 4, children: [for (var i = r * 10; i < math.min(n, r * 10 + 10); i++) cell(i, t)]));
    }
    return Column(spacing: 4, crossAxisAlignment: CrossAxisAlignment.stretch, children: rows);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: 8,
        children: [
          ValueListenableBuilder(
            valueListenable: tick,
            builder: (_, t, _) => Text('Frame $t', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          ),
          Expanded(
            child: SingleChildScrollView(
              // Only MODE=all changes the cells; otherwise they are built once.
              child: mode == 'all' ? ValueListenableBuilder(valueListenable: tick, builder: (_, t, _) => grid(t)) : grid(0),
            ),
          ),
        ],
      ),
    );
  }
}

// ---- dashboard data (dashboard.js) ----------------------------------------------

const tabs = [
  (id: 'overview', label: 'Visão geral', dot: Color(0xFF3584E4)),
  (id: 'table', label: 'Serviços', dot: Color(0xFF26A269)),
  (id: 'logs', label: 'Logs', dot: Color(0xFFE5A50A)),
  (id: 'settings', label: 'Configurações', dot: Color(0xFF9141AC)),
];

// Same doubles and operation order as JS, so the data matches the other versions.
double seed = 42;
double rand() {
  seed = (seed * 1103515245 + 12345).remainder(2147483648.0);
  return seed / 2147483648.0;
}

T pick<T>(List<T> list) => list[(rand() * list.length).floor()];
int jsRound(double x) => (x + 0.5).floor();

typedef Status = ({String label, Color fg, Color bg});
const statusOk = (label: 'ativo', fg: Color(0xFF1C7A45), bg: Color(0xFFE6F4EA));
const statusWarn = (label: 'lento', fg: Color(0xFF8A6100), bg: Color(0xFFFEF7E0));
const statusDown = (label: 'parado', fg: Color(0xFFB3141B), bg: Color(0xFFFDE8E8));
Status statusOf(int cpu) => cpu > 90 ? statusDown : (cpu > 70 ? statusWarn : statusOk);

const names = ['api', 'auth', 'billing', 'cache', 'search', 'mailer', 'queue', 'gateway', 'storage', 'metrics'];
const regions = ['sa-east-1', 'us-east-1', 'eu-west-1', 'ap-south-1'];

class Service {
  Service(this.id, this.name, this.region, this.cpu, this.mem);
  final int id;
  final String name;
  final String region;
  int cpu;
  final int mem;
}

final services = List.generate(rowsCount, (id) {
  final cpu = jsRound(rand() * 100);
  final name = '${pick(names)}-$id';
  final region = pick(regions);
  return Service(id, name, region, cpu, jsRound(64 + rand() * 4000));
});

const levelColor = {'INFO': Color(0xFF3584E4), 'WARN': Color(0xFFE5A50A), 'ERRO': Color(0xFFE01B24)};
const messages = [
  'requisição concluída em 12 ms', 'conexão com o banco reaberta', 'cache invalidado para /usuarios',
  'tempo de resposta acima do limite', 'job de faturamento agendado', 'certificado renovado',
  'falha ao enviar e-mail: tempo esgotado', 'réplica sincronizada', 'novo deploy recebido (v2.14.3)',
];

typedef LogLine = ({int id, String time, String level, String text});
int logId = 0;
String two(int v) => v.toString().padLeft(2, '0');
LogLine makeLog() {
  final r = rand();
  final s = logId++;
  final time = '${two((s ~/ 3600) % 24)}:${two((s ~/ 60) % 60)}:${two(s % 60)}';
  final level = r < 0.75 ? 'INFO' : (r < 0.93 ? 'WARN' : 'ERRO');
  return (id: s, time: time, level: level, text: '${pick(names)}: ${pick(messages)}');
}

var logs = List.generate(200, (_) => makeLog());
var activity = List.generate(12, (_) => makeLog());

final tick = ValueNotifier<int>(0);
final query = ValueNotifier<String>('');
Set<Service> lastChanged = {};

// ---- dashboard shell -------------------------------------------------------------------

class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key});

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> with SingleTickerProviderStateMixin {
  int tab = math.max(0, tabs.indexWhere((t) => t.id == env['TAB']));
  final meter = FrameMeter();
  late final Ticker ticker = createTicker(onFrame);

  @override
  void initState() {
    super.initState();
    if (live || cycle > 0) ticker.start();
  }

  @override
  void dispose() {
    ticker.dispose();
    super.dispose();
  }

  void setTab(int i) => setState(() => tab = i);

  void step() {
    final t = tick.value + 1;
    final changed = <Service>{};
    for (var i = t % 10; i < services.length; i += 10) {
      final s = services[i];
      final next = math.max(0, math.min(100, s.cpu + jsRound((rand() - 0.5) * 20)));
      if (next != s.cpu) changed.add(s);
      s.cpu = next;
    }
    lastChanged = changed;
    logs = [...logs.sublist(logs.length >= 400 ? 2 : 0), makeLog(), makeLog()];
    if (t % 15 == 0) activity = [makeLog(), ...activity.sublist(0, 11)];
    if (cycle > 0 && t % cycle == 0) setTab((tab + 1) % tabs.length);
    tick.value = t;
  }

  void onFrame(Duration elapsed) {
    final now = elapsed.inMicroseconds / 1000;
    if (!meter.shouldRun(now)) return;
    final s = Stopwatch()..start();
    step();
    meter.record(now, elapsedMs(s), ' | ${tabs[tab].id}');
  }

  @override
  Widget build(BuildContext context) {
    final Widget content = switch (tab) {
      0 => const OverviewTab(key: ValueKey(0)),
      1 => const ServicesTab(key: ValueKey(1)),
      2 => const LogsTab(key: ValueKey(2)),
      _ => const SettingsTab(key: ValueKey(3)),
    };
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Sidebar(tab: tab, onSelect: setTab),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              spacing: 12,
              children: [
                Row(spacing: 12, children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, spacing: 2, children: [
                      Text(tabs[tab].label, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                      const Text('Ambiente de produção · atualizado ao vivo', style: TextStyle(fontSize: 12, color: muted)),
                    ]),
                  ),
                  SizedBox(
                    width: 260,
                    child: TextField(
                      decoration: const InputDecoration(
                        hintText: 'Buscar serviço ou região…',
                        isDense: true,
                        border: OutlineInputBorder(),
                      ),
                      onChanged: (v) {
                        query.value = v;
                        if (tab != 1) setTab(1);
                      },
                    ),
                  ),
                  const Btn('Exportar'),
                  const Btn('Novo serviço', background: accent, foreground: Colors.white, bold: true),
                ]),
                Row(spacing: 4, children: [
                  for (var i = 0; i < tabs.length; i++) TabLabel(label: tabs[i].label, active: tab == i, onTap: () => setTab(i)),
                ]),
                const Divider(height: 1, thickness: 1, color: Color(0x1A000000)),
                Expanded(child: content),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class Btn extends StatelessWidget {
  const Btn(this.label, {super.key, this.background = const Color(0x10000000), this.foreground = ink, this.bold = false, this.onTap});
  final String label;
  final Color background;
  final Color foreground;
  final bool bold;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: onTap ?? () {},
      style: TextButton.styleFrom(
        backgroundColor: background,
        foregroundColor: foreground,
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: TextStyle(fontSize: 14, fontWeight: bold ? FontWeight.bold : FontWeight.normal),
      ),
      child: Text(label),
    );
  }
}

class LabeledCheck extends StatelessWidget {
  const LabeledCheck({super.key, required this.label, required this.value, required this.onChanged});
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => onChanged(!value),
      child: Row(mainAxisSize: MainAxisSize.min, spacing: 6, children: [
        SizedBox(width: 20, height: 20, child: Checkbox(value: value, onChanged: (v) => onChanged(v ?? false))),
        Text(label),
      ]),
    );
  }
}

class Pill extends StatelessWidget {
  const Pill(this.text, this.status, {super.key});
  final String text;
  final Status status;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 2, horizontal: 8),
      decoration: BoxDecoration(color: status.bg, borderRadius: BorderRadius.circular(10)),
      child: Text(text, style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: status.fg)),
    );
  }
}

class TabLabel extends StatelessWidget {
  const TabLabel({super.key, required this.label, required this.active, required this.onTap});
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, spacing: 8, children: [
          Text(label, style: TextStyle(color: active ? ink : muted, fontWeight: active ? FontWeight.bold : FontWeight.normal)),
          Container(
            height: 3,
            decoration: BoxDecoration(color: active ? accent : Colors.transparent, borderRadius: BorderRadius.circular(2)),
          ),
        ]),
      ),
    );
  }
}

class Sidebar extends StatelessWidget {
  const Sidebar({super.key, required this.tab, required this.onSelect});
  final int tab;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 220,
      color: const Color(0xFFF1F1F4),
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, spacing: 4, children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(12, 0, 12, 12),
          child: Text('Observa', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        ),
        for (var i = 0; i < tabs.length; i++)
          GestureDetector(
            onTap: () => onSelect(i),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 12),
              decoration: BoxDecoration(
                color: tab == i ? const Color(0x1F3584E4) : Colors.transparent,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(spacing: 10, children: [
                Container(width: 10, height: 10, decoration: BoxDecoration(color: tabs[i].dot, shape: BoxShape.circle)),
                Expanded(
                  child: Text(tabs[i].label,
                      style: TextStyle(
                        color: tab == i ? const Color(0xFF2A6FC4) : muted,
                        fontWeight: tab == i ? FontWeight.bold : FontWeight.normal,
                      )),
                ),
              ]),
            ),
          ),
        const Padding(
          padding: EdgeInsets.fromLTRB(12, 16, 12, 0),
          child: Text('REGIÕES', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: muted)),
        ),
        // Recomputed every frame, like updateShell() in dashboard.js.
        ValueListenableBuilder(
          valueListenable: tick,
          builder: (_, _, _) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, spacing: 4, children: [
            for (final r in regions)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 12),
                child: Row(children: [
                  Expanded(child: Text(r, style: const TextStyle(fontSize: 13))),
                  Builder(builder: (_) {
                    final down = services.where((s) => s.region == r && statusOf(s.cpu) == statusDown).length;
                    return down > 0 ? Pill('$down', statusDown) : const SizedBox.shrink();
                  }),
                ]),
              ),
          ]),
        ),
        const Spacer(),
        ValueListenableBuilder(
          valueListenable: tick,
          builder: (_, t, _) => Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Text('frame $t', style: const TextStyle(fontSize: 11, color: muted)),
          ),
        ),
      ]),
    );
  }
}

class Panel extends StatelessWidget {
  const Panel({super.key, required this.child, this.padding = 16, this.borderColor = const Color(0x14000000)});
  final Widget child;
  final double padding;
  final Color borderColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.all(padding),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: borderColor),
        borderRadius: BorderRadius.circular(12),
      ),
      child: child,
    );
  }
}

// ---- overview ------------------------------------------------------------------------

String thousands(int v) {
  final s = v.abs().toString();
  final out = StringBuffer(v < 0 ? '-' : '');
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) out.write('.');
    out.write(s[i]);
  }
  return out.toString();
}

class OverviewTab extends StatelessWidget {
  const OverviewTab({super.key});

  Widget stat(String label, String value, double delta) => Expanded(
        child: Panel(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, spacing: 6, children: [
            Text(label, style: const TextStyle(fontSize: 12, color: muted)),
            Text(value, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold)),
            Text('${delta >= 0 ? '▲' : '▼'} ${delta.abs().toStringAsFixed(1)}% vs. ontem',
                style: TextStyle(fontSize: 12, color: delta >= 0 ? const Color(0xFF1C7A45) : const Color(0xFFB3141B))),
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder(
      valueListenable: tick,
      builder: (_, t, _) {
        final avg = services.fold<int>(0, (a, s) => a + s.cpu) / services.length;
        final down = services.where((s) => statusOf(s.cpu) == statusDown).length;
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, spacing: 16, children: [
          Row(spacing: 12, children: [
            stat('Requisições/s', thousands(1200 + jsRound(math.sin(t / 20) * 300)), math.sin(t / 20) * 12),
            stat('CPU média', '${avg.toStringAsFixed(1)}%', avg - 50),
            stat('Serviços parados', '$down de ${services.length}', -down / 10),
            stat('Latência p95', '${(80 + math.cos(t / 13) * 25).toStringAsFixed(0)} ms', math.cos(t / 13) * 5),
          ]),
          Expanded(
            child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, spacing: 12, children: [
              Expanded(
                flex: 2,
                child: Panel(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, spacing: 12, children: [
                    Row(children: [
                      const Expanded(child: Text('Tráfego por minuto', style: TextStyle(fontWeight: FontWeight.bold))),
                      Text('frame $t', style: const TextStyle(fontSize: 12, color: muted)),
                    ]),
                    Expanded(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(minHeight: 160),
                        child: Row(crossAxisAlignment: CrossAxisAlignment.end, spacing: 4, children: [
                          for (var i = 0; i < 32; i++)
                            Expanded(
                              child: Container(
                                height: 20 + (math.sin(t / 15 + i / 3) + 1) * 60 + (i % 5) * 8,
                                decoration: BoxDecoration(
                                  color: i % 8 == 7 ? warnColor : accent,
                                  borderRadius: BorderRadius.circular(3),
                                ),
                              ),
                            ),
                        ]),
                      ),
                    ),
                    Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                      for (final l in ['00:00', '06:00', '12:00', '18:00', '24:00'])
                        Text(l, style: const TextStyle(fontSize: 11, color: muted)),
                    ]),
                  ]),
                ),
              ),
              Expanded(
                child: Panel(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, spacing: 10, children: [
                    const Text('Atividade recente', style: TextStyle(fontWeight: FontWeight.bold)),
                    Expanded(
                      // Plain children (not a builder): the feed is short, like the DOM list.
                      child: ListView(children: [
                        for (final a in activity)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Row(spacing: 10, children: [
                              Container(
                                width: 8,
                                height: 8,
                                decoration: BoxDecoration(color: levelColor[a.level], shape: BoxShape.circle),
                              ),
                              Expanded(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, spacing: 2, children: [
                                  Text(a.text, style: const TextStyle(fontSize: 13)),
                                  Text(a.time, style: const TextStyle(fontSize: 11, color: muted)),
                                ]),
                              ),
                            ]),
                          ),
                      ]),
                    ),
                  ]),
                ),
              ),
            ]),
          ),
        ]);
      },
    );
  }
}

// ---- services table ----------------------------------------------------------------------

const columns = [
  (key: 'id', label: '#', width: 50.0),
  (key: 'name', label: 'Serviço', width: 0.0),
  (key: '', label: 'Região', width: 110.0),
  (key: '', label: 'Status', width: 80.0),
  (key: 'cpu', label: 'CPU', width: 170.0),
  (key: 'mem', label: 'Memória', width: 90.0),
];

class ServicesTab extends StatefulWidget {
  const ServicesTab({super.key});

  @override
  State<ServicesTab> createState() => _ServicesTabState();
}

class _ServicesTabState extends State<ServicesTab> {
  String sortKey = 'id';
  bool desc = false;
  bool onlyProblems = false;
  List<Service> list = [];

  @override
  void initState() {
    super.initState();
    refresh();
    tick.addListener(onTick);
    query.addListener(onQuery);
  }

  @override
  void dispose() {
    tick.removeListener(onTick);
    query.removeListener(onQuery);
    super.dispose();
  }

  void onTick() => setState(() {
        if (lastChanged.isNotEmpty && (sortKey == 'cpu' || onlyProblems)) refresh();
      });

  void onQuery() => setState(refresh);

  Comparable val(Service s) => switch (sortKey) {
        'cpu' => s.cpu,
        'mem' => s.mem,
        'name' => s.name,
        _ => s.id,
      };

  void refresh() {
    final q = query.value.toLowerCase();
    list = services
        .where((s) => (q.isEmpty || s.name.contains(q) || s.region.contains(q)) && (!onlyProblems || statusOf(s.cpu) != statusOk))
        .toList()
      ..sort((a, b) => val(a).compareTo(val(b)) * (desc ? -1 : 1));
  }

  void toggleSort(String key) => setState(() {
        desc = sortKey == key ? !desc : (key == 'cpu' || key == 'mem');
        sortKey = key;
        refresh();
      });

  Widget sized(double width, Widget child) => width > 0 ? SizedBox(width: width, child: child) : Expanded(child: child);

  @override
  Widget build(BuildContext context) {
    const divider = Divider(height: 1, thickness: 1, color: Color(0x1A000000));
    return Panel(
      padding: 0,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
          child: Row(spacing: 12, children: [
            Expanded(child: Text('${list.length} serviços', style: const TextStyle(fontWeight: FontWeight.bold))),
            LabeledCheck(
              label: 'Só com problema',
              value: onlyProblems,
              onChanged: (v) => setState(() {
                onlyProblems = v;
                refresh();
              }),
            ),
          ]),
        ),
        divider,
        Container(
          color: const Color(0x06000000),
          padding: const EdgeInsets.fromLTRB(12, 8, 24, 8),
          child: Row(spacing: 12, children: [
            for (final c in columns)
              sized(
                c.width,
                GestureDetector(
                  onTap: c.key.isEmpty ? null : () => toggleSort(c.key),
                  child: Text(
                    c.label + (c.key.isNotEmpty && sortKey == c.key ? (desc ? ' ↓' : ' ↑') : ''),
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: c.key.isNotEmpty && sortKey == c.key ? accent : muted,
                    ),
                  ),
                ),
              ),
          ]),
        ),
        divider,
        Expanded(
          child: list.isEmpty
              ? const Padding(padding: EdgeInsets.all(16), child: Text('Nenhum serviço encontrado', style: TextStyle(color: muted)))
              // Virtualized: only the visible rows exist, unlike the DOM and nodebuilder tables.
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(0, 4, 12, 4),
                  itemCount: list.length,
                  itemBuilder: (_, i) => ServiceRow(list[i]),
                ),
        ),
      ]),
    );
  }
}

class ServiceRow extends StatefulWidget {
  const ServiceRow(this.s, {super.key});
  final Service s;

  @override
  State<ServiceRow> createState() => _ServiceRowState();
}

class _ServiceRowState extends State<ServiceRow> {
  bool hovered = false;

  @override
  Widget build(BuildContext context) {
    final s = widget.s;
    final st = statusOf(s.cpu);
    return MouseRegion(
      onEnter: (_) => setState(() => hovered = true),
      onExit: (_) => setState(() => hovered = false),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
        child: Row(spacing: 12, children: [
          SizedBox(width: 50, child: Text('${s.id}', style: const TextStyle(fontSize: 12, color: muted))),
          Expanded(
            child: Text(s.name, style: TextStyle(fontSize: 13, fontWeight: hovered ? FontWeight.bold : FontWeight.normal)),
          ),
          SizedBox(width: 110, child: Text(s.region, style: const TextStyle(fontSize: 12, color: muted))),
          SizedBox(width: 80, child: Row(children: [Pill(st.label, st)])),
          SizedBox(
            width: 170,
            child: Row(spacing: 8, children: [
              Container(
                width: 110,
                height: 6,
                alignment: Alignment.centerLeft,
                decoration: BoxDecoration(color: const Color(0x0F000000), borderRadius: BorderRadius.circular(3)),
                child: Container(
                  width: math.max(2, s.cpu / 100 * 110),
                  height: 6,
                  decoration: BoxDecoration(
                    color: s.cpu > 90 ? danger : (s.cpu > 70 ? warnColor : accent),
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              ),
              Text('${s.cpu}%', style: const TextStyle(fontSize: 12)),
            ]),
          ),
          SizedBox(width: 90, child: Text('${s.mem} MB', style: const TextStyle(fontSize: 12))),
        ]),
      ),
    );
  }
}

// ---- logs ----------------------------------------------------------------------------------

class LogsTab extends StatefulWidget {
  const LogsTab({super.key});

  @override
  State<LogsTab> createState() => _LogsTabState();
}

class _LogsTabState extends State<LogsTab> {
  final levels = {'INFO': true, 'WARN': true, 'ERRO': true};
  bool paused = false;
  List<LogLine> visible = [];

  @override
  void initState() {
    super.initState();
    render();
    tick.addListener(onTick);
  }

  @override
  void dispose() {
    tick.removeListener(onTick);
    super.dispose();
  }

  void render() {
    if (!paused) visible = logs.where((l) => levels[l.level]!).toList();
  }

  void onTick() => setState(render);

  @override
  Widget build(BuildContext context) {
    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, spacing: 12, children: [
        Row(spacing: 16, children: [
          Expanded(child: Text('${visible.length} linhas', style: const TextStyle(fontWeight: FontWeight.bold))),
          for (final k in levels.keys)
            LabeledCheck(label: k, value: levels[k]!, onChanged: (v) => setState(() {
                  levels[k] = v;
                  render();
                })),
          Btn(paused ? 'Continuar' : 'Pausar', onTap: () => setState(() {
                paused = !paused;
                render();
              })),
        ]),
        Expanded(
          child: Container(
            decoration: BoxDecoration(color: const Color(0xFF1E1E24), borderRadius: BorderRadius.circular(8)),
            // Virtualized, unlike the DOM and nodebuilder log views.
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
              itemCount: visible.length,
              itemBuilder: (_, i) {
                final l = visible[i];
                return Padding(
                  padding: const EdgeInsets.only(bottom: 2),
                  child: Row(spacing: 10, children: [
                    Text(l.time, style: const TextStyle(fontSize: 12, color: Color(0xFF8A8A96))),
                    SizedBox(
                      width: 40,
                      child: Text(l.level, style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: levelColor[l.level])),
                    ),
                    Text(l.text, style: const TextStyle(fontSize: 12, color: Color(0xFFE8E8EE))),
                  ]),
                );
              },
            ),
          ),
        ),
      ]),
    );
  }
}

// ---- settings ---------------------------------------------------------------------------

class SettingsTab extends StatefulWidget {
  const SettingsTab({super.key});

  @override
  State<SettingsTab> createState() => _SettingsTabState();
}

class _SettingsTabState extends State<SettingsTab> {
  int interval = 1;
  final flags = [
    'Notificar por e-mail', 'Notificar no chat', 'Resumo diário', 'Pausar alertas à noite', 'Modo compacto',
    'Mostrar serviços parados primeiro',
  ];
  late final on = List.generate(flags.length, (i) => i % 2 == 0);

  Widget field(String label, String value) => Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, spacing: 6, children: [
          Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: muted)),
          TextFormField(initialValue: value, decoration: const InputDecoration(isDense: true, border: OutlineInputBorder())),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    const h = TextStyle(fontSize: 16, fontWeight: FontWeight.bold);
    return SingleChildScrollView(
      padding: const EdgeInsets.only(right: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, spacing: 16, children: [
        Panel(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, spacing: 14, children: [
            const Text('Geral', style: h),
            Row(spacing: 12, children: [
              field('Nome da equipe', 'Equipe de plataforma'),
              field('E-mail de alertas', 'alertas@exemplo.com.br'),
            ]),
            Column(crossAxisAlignment: CrossAxisAlignment.start, spacing: 6, children: [
              const Text('Intervalo de coleta', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: muted)),
              Container(
                padding: const EdgeInsets.all(3),
                decoration: BoxDecoration(color: const Color(0x10000000), borderRadius: BorderRadius.circular(8)),
                child: Row(mainAxisSize: MainAxisSize.min, spacing: 2, children: [
                  for (final (i, label) in ['10 s', '30 s', '1 min', '5 min'].indexed)
                    Btn(label,
                        background: interval == i ? Colors.white : Colors.transparent,
                        onTap: () => setState(() => interval = i)),
                ]),
              ),
            ]),
          ]),
        ),
        Panel(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, spacing: 12, children: [
            const Text('Notificações', style: h),
            for (var i = 0; i < flags.length; i++)
              LabeledCheck(label: flags[i], value: on[i], onChanged: (v) => setState(() => on[i] = v)),
          ]),
        ),
        Panel(
          borderColor: const Color(0x40E01B24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, spacing: 12, children: [
            const Text('Zona de perigo', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: danger)),
            const Row(spacing: 12, children: [
              Expanded(child: Text('Remove todos os serviços e o histórico de métricas.', style: TextStyle(color: muted))),
              Btn('Apagar tudo', background: danger, foreground: Colors.white, bold: true),
            ]),
          ]),
        ),
      ]),
    );
  }
}
