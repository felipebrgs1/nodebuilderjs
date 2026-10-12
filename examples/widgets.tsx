// The built-in controls side by side, enabled and disabled.

import {
  Button, Card, Checkbox, Column, ProgressBar, RadioGroup, Row, Slider, Spinner, Text, TextField, Toggle, Window,
  createSignal, run, theme,
} from "@nodebuilderjs/core";

function Controls() {
  const [wifi, setWifi] = createSignal(true);
  const [dark, setDark] = createSignal(false);
  const [size, setSize] = createSignal("m");
  const [volume, setVolume] = createSignal(40);
  const [name, setName] = createSignal("");
  const [agree, setAgree] = createSignal(false);
  return (
    <Window title="Widgets" width={640} height={520}>
      <Row grow={1} padding={20} gap={16} align="start">
        <Card grow={1} gap={14}>
          <Text bold>Ajustes</Text>
          <Toggle checked={wifi} onChange={setWifi} label="Wi-Fi" />
          <Toggle checked={dark} onChange={setDark} label="Tema escuro (em breve)" disabled />
          <Text color={theme.text.secondary}>Tamanho</Text>
          <RadioGroup
            value={size}
            onChange={setSize}
            options={[
              { value: "p", label: "Pequeno" },
              { value: "m", label: "Médio" },
              { value: "g", label: "Grande (esgotado)", disabled: true },
            ]}
          />
          <Text color={theme.text.secondary}>{() => `Volume: ${volume()}`}</Text>
          <Slider value={volume} onChange={setVolume} width={220} />
          <Slider value={() => 70} onChange={() => {}} width={220} disabled />
        </Card>
        <Card grow={1} gap={14}>
          <Text bold>Formulário</Text>
          <TextField value={name} onInput={setName} placeholder="Nome" />
          <TextField value={() => "somente leitura"} onInput={() => {}} disabled />
          <Checkbox checked={agree} onChange={setAgree} label="Aceito os termos" />
          <Row gap={8}>
            <Button label="Enviar" variant="primary" disabled={() => !agree() || !name()} />
            <Button label="Cancelar" variant="flat" />
          </Row>
          <Text color={theme.text.secondary}>Progresso</Text>
          <ProgressBar value={() => volume() / 100} />
          <ProgressBar />
          <Row gap={10} align="center">
            <Spinner />
            <Text color={theme.text.secondary}>Carregando…</Text>
          </Row>
        </Card>
      </Row>
    </Window>
  );
}

run(() => <Controls />);
