// The built-in controls side by side, enabled and disabled.
// OPEN=select|dialogo starts with the list or the dialog open; THEME=dark starts dark (for screenshots).

import {
  Box, Button, Card, Checkbox, Column, Dialog, Match, ProgressBar, RadioGroup, Row, Select, Slider, Spinner, Switch, Tabs, Text,
  TextArea, TextField, Toggle, Tooltip, Window, Scroll, colorScheme, createSignal, run, setTheme, theme,
} from "@nodebuilderjs/core";

const initial = process.env.OPEN;
if (process.env.THEME === "dark") setTheme("dark");
const CITIES = [
  { value: "poa", label: "Porto Alegre" },
  { value: "sp", label: "São Paulo" },
  { value: "rio", label: "Rio de Janeiro", disabled: true },
  { value: "rec", label: "Recife" },
];
const TAGS = ["typescript", "linux", "wayland", "x11", "signals", "gles2", "harfbuzz", "bun"];

function Controls() {
  const [wifi, setWifi] = createSignal(true);
  const [size, setSize] = createSignal("m");
  const [volume, setVolume] = createSignal(40);
  const [name, setName] = createSignal("");
  const [notes, setNotes] = createSignal("Multi-line text wraps at the width it gets.\nReturn adds a line; Ctrl+Z undoes.");
  const [agree, setAgree] = createSignal(false);
  const [tab, setTab] = createSignal(initial === "select" ? "lista" : "controles");
  const [city, setCity] = createSignal<string | undefined>(initial === "select" ? "sp" : undefined);
  const [confirm, setConfirm] = createSignal(initial === "dialogo");
  return (
    <Window title="Widgets" width={680} height={720}>
      <Scroll grow={1}>
      <Column padding={20} gap={16}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "controles", label: "Controles" },
          { value: "lista", label: "Seleção" },
          { value: "relatorios", label: "Relatórios", disabled: true },
        ]}
      />
      <Switch>
      <Match when={() => tab() === "controles"}>
      {/* Side by side when they fit, one under the other on a narrow window (a phone). */}
      <Row wrap gap={16} align="start">
        <Card width={280} grow={1} gap={14}>
          <Text bold>Ajustes</Text>
          <Toggle checked={wifi} onChange={setWifi} label="Wi-Fi" />
          <Toggle checked={() => colorScheme() === "dark"} onChange={(on) => setTheme(on ? "dark" : "light")} label="Tema escuro" />
          <Toggle checked={() => false} onChange={() => {}} label="Modo avião (indisponível)" disabled />
          <Text color={() => theme.text.secondary}>Tamanho</Text>
          <RadioGroup
            value={size}
            onChange={setSize}
            options={[
              { value: "p", label: "Pequeno" },
              { value: "m", label: "Médio" },
              { value: "g", label: "Grande (esgotado)", disabled: true },
            ]}
          />
          <Text color={() => theme.text.secondary}>{() => `Volume: ${volume()}`}</Text>
          <Slider value={volume} onChange={setVolume} width={220} />
          <Slider value={() => 70} onChange={() => {}} width={220} disabled />
        </Card>
        <Card width={280} grow={1} gap={14}>
          <Text bold>Formulário</Text>
          <TextField value={name} onInput={setName} placeholder="Nome" />
          <TextField value={() => "somente leitura"} onInput={() => {}} disabled />
          <TextArea value={notes} onInput={setNotes} placeholder="Notes" rows={3} />
          <Checkbox checked={agree} onChange={setAgree} label="Aceito os termos" />
          <Row gap={8}>
            <Tooltip text="Preencha o nome e aceite os termos">
              <Button label="Enviar" variant="primary" disabled={() => !agree() || !name()} />
            </Tooltip>
            <Button label="Excluir…" variant="danger" onClick={() => setConfirm(true)} />
          </Row>
          <Text color={() => theme.text.secondary}>Progresso</Text>
          <ProgressBar value={() => volume() / 100} />
          <ProgressBar />
          <Row gap={10} align="center">
            <Spinner />
            <Text color={() => theme.text.secondary}>Carregando…</Text>
          </Row>
          {/* A negative margin cancels the card's 16px padding: the rule runs edge to edge. */}
          <Box height={1} margin={[4, -16]} background={() => theme.divider} />
          <Text color={() => theme.text.secondary}>Tags</Text>
          <Row wrap gap={6}>
            {TAGS.map((tag) => (
              <Box padding={[4, 10]} radius={12} background={() => theme.control.base}>
                <Text fontSize={12}>{tag}</Text>
              </Box>
            ))}
          </Row>
        </Card>
      </Row>
      </Match>
      <Match when={() => tab() === "lista"}>
        <Card gap={12} align="start">
          <Text bold>Cidade</Text>
          <Select value={city} onChange={setCity} options={CITIES} placeholder="Escolha uma cidade" width={240} />
          <Text color={() => theme.text.secondary}>{() => `Escolhida: ${city() ?? "nenhuma"}`}</Text>
        </Card>
      </Match>
      </Switch>
      </Column>
      </Scroll>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Excluir arquivo?"
        actions={[
          <Button label="Cancelar" variant="flat" onClick={() => setConfirm(false)} />,
          <Button label="Excluir" variant="danger" onClick={() => setConfirm(false)} />,
        ]}
      >
        <Text color={() => theme.text.secondary}>Esta ação não pode ser desfeita. O arquivo some de todos os dispositivos.</Text>
      </Dialog>
    </Window>
  );
}

run(() => <Controls />);
