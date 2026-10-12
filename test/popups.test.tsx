import { expect, test } from "bun:test";
import { Button, Column, Dialog, Select, Tabs, Text, TextField, Tooltip, createSignal } from "@nodebuilderjs/core";
import { findByText, interact, mount } from "@nodebuilderjs/core/testing";
import { commandsOf } from "./helpers.js";

const FRUITS = [
  { value: "maca", label: "Maçã" },
  { value: "banana", label: "Banana", disabled: true },
  { value: "uva", label: "Uva" },
];

function click(ui: ReturnType<typeof interact>, node: Parameters<ReturnType<typeof interact>["press"]>[0]) {
  ui.press(node);
  ui.release(node);
}

// ---- Select ------------------------------------------------------------------

test("Select shows the chosen label; a click opens the list below it, a click on an option picks and closes", () => {
  const [fruit, setFruit] = createSignal<string | undefined>(undefined);
  const { root, relayout } = mount(() => (
    <Column align="start">
      <Select value={fruit} onChange={setFruit} options={FRUITS} placeholder="Escolha" width={160} />
    </Column>
  ));
  const select = root.children[0]!.children[0]!;
  const ui = interact(root);
  expect(findByText(root, "Escolha")).toBeDefined();
  click(ui, select);
  relayout();
  const list = root.layers[0]!;
  expect([list.x, list.width, list.y]).toEqual([select.x, 160, select.y + select.height + 4]);
  click(ui, findByText(root, "Banana")!); // disabled: nothing
  expect(fruit()).toBeUndefined();
  click(ui, findByText(root, "Uva")!);
  relayout();
  expect(fruit()).toBe("uva");
  expect(root.layers).toEqual([]);
  expect(findByText(root, "Uva")).toBe(select.children[0]);
});

test("Select with the keyboard: Down opens on the current option, arrows skip disabled ones, Enter picks, Escape cancels", () => {
  const [fruit, setFruit] = createSignal<string | undefined>("maca");
  const { root, relayout } = mount(() => (
    <Column align="start">
      <Select value={fruit} onChange={setFruit} options={FRUITS} />
    </Column>
  ));
  const ui = interact(root);
  ui.key("Tab");
  ui.key("Down");
  relayout();
  expect(root.layers).toHaveLength(1);
  ui.key("Down"); // skips "Banana"
  ui.key("Return");
  relayout();
  expect(fruit()).toBe("uva");
  expect(root.layers).toEqual([]);
  ui.key("space");
  ui.key("Up");
  ui.key("Escape");
  relayout();
  expect(fruit()).toBe("uva");
  expect(root.layers).toEqual([]);
  expect(ui.focused).toBe(root.children[0]!.children[0]!); // the trigger keeps the focus
});

test("Select: a press outside closes it; disabled, it does not open", () => {
  const [fruit, setFruit] = createSignal<string | undefined>(undefined);
  const [disabled, setDisabled] = createSignal(false);
  const { root, relayout } = mount(() => (
    <Column align="start" gap={100}>
      <Select value={fruit} onChange={setFruit} options={FRUITS} disabled={disabled} />
      <Text>fora</Text>
    </Column>
  ));
  const select = root.children[0]!.children[0]!;
  const ui = interact(root);
  click(ui, select);
  relayout();
  click(ui, findByText(root, "fora")!);
  relayout();
  expect(root.layers).toEqual([]);
  setDisabled(true);
  click(ui, select);
  relayout();
  expect(root.layers).toEqual([]);
});

// ---- Tabs --------------------------------------------------------------------

test("Tabs: a click selects; one Tab stop, Left/Right move and select, skipping disabled tabs; the active one is underlined", () => {
  const [tab, setTab] = createSignal("geral");
  const { root } = mount(() => (
    <Column align="start">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "geral", label: "Geral" },
          { value: "conta", label: "Conta", disabled: true },
          { value: "avancado", label: "Avançado" },
        ]}
      />
      <Button label="depois" />
    </Column>
  ));
  const ui = interact(root);
  click(ui, findByText(root, "Avançado")!);
  expect(tab()).toBe("avancado");
  expect(ui.focused?.children[0]?.label).toBe('Text "Avançado"'); // a click focuses it
  ui.key("Left"); // skips "Conta"
  expect(tab()).toBe("geral");
  expect(ui.focused?.children[0]?.label).toBe('Text "Geral"');
  ui.key("Tab");
  expect(ui.focused?.children[0]?.label).toBe('Text "depois"');
  ui.key("Tab", { shift: true }); // back into the group: the selected tab
  expect(ui.focused?.children[0]?.label).toBe('Text "Geral"');
  const geral = findByText(root, "Geral")!.parent!;
  const underline = commandsOf(geral, "rect").at(-1)!;
  expect([underline.x, underline.y + underline.h, underline.w]).toEqual([geral.x, geral.y + geral.height, geral.width]);
});

// ---- Tooltip -----------------------------------------------------------------

test("Tooltip shows above its child while the pointer is over it, and goes away when it leaves or is clicked", () => {
  const { root, relayout } = mount(() => (
    <Column align="start" padding={60}>
      <Tooltip text="Salva o arquivo" delay={0}>
        <Button label="Salvar" />
      </Tooltip>
    </Column>
  ));
  const target = findByText(root, "Salvar")!;
  const ui = interact(root);
  ui.hover(target);
  relayout();
  const tip = root.layers[0]!;
  expect(findByText(tip, "Salva o arquivo")).toBeDefined();
  expect(tip.y + tip.height).toBeLessThanOrEqual(target.parent!.y);
  ui.move(500, 500);
  relayout();
  expect(root.layers).toEqual([]);
  ui.hover(target);
  relayout();
  click(ui, target);
  relayout();
  expect(root.layers).toEqual([]);
});

test("Tooltip waits for its delay before showing", async () => {
  const { root, relayout } = mount(() => (
    <Column align="start">
      <Tooltip text="dica" delay={20}>
        <Text>alvo</Text>
      </Tooltip>
    </Column>
  ));
  const ui = interact(root);
  ui.hover(findByText(root, "alvo")!);
  relayout();
  expect(root.layers).toEqual([]);
  await Bun.sleep(40);
  relayout();
  expect(root.layers).toHaveLength(1);
});

// ---- Dialog ------------------------------------------------------------------

function dialogApp(dismissible = true) {
  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal("");
  let closes = 0;
  const app = mount(() => (
    <Column align="start">
      <Button label="Renomear" onClick={() => setOpen(true)} />
      <Dialog
        open={open}
        onClose={() => (closes++, setOpen(false))}
        title="Renomear arquivo"
        dismissible={dismissible}
        actions={<Button label="OK" variant="primary" onClick={() => setOpen(false)} />}
      >
        <TextField value={name} onInput={setName} />
      </Dialog>
    </Column>
  ));
  return { ...app, ui: interact(app.root), open, name, closes: () => closes };
}

test("Dialog opens over everything with its title, body and actions, and focuses its first control", async () => {
  const { root, relayout, ui, name } = dialogApp();
  const opener = findByText(root, "Renomear")!;
  click(ui, opener);
  relayout();
  expect(root.layers).toHaveLength(1);
  expect(findByText(root.layers[0]!, "Renomear arquivo")).toBeDefined();
  expect(findByText(root.layers[0]!, "OK")).toBeDefined();
  await Promise.resolve();
  ui.type("novo.txt");
  expect(name()).toBe("novo.txt");
});

test("Dialog: Escape or a press on the backdrop asks to close; closing gives the focus back", async () => {
  const { root, relayout, ui, open, closes } = dialogApp();
  const opener = findByText(root, "Renomear")!.parent!;
  click(ui, opener);
  relayout();
  await Promise.resolve();
  ui.key("Escape");
  relayout();
  expect([open(), closes()]).toEqual([false, 1]);
  expect(ui.focused).toBe(opener);
  click(ui, opener);
  relayout();
  ui.down(2, 590); // the backdrop, far from the card
  relayout();
  expect([open(), closes()]).toEqual([false, 2]);
});

test("Dialog with dismissible={false} only closes through its own buttons", () => {
  const { root, relayout, ui, open, closes } = dialogApp(false);
  click(ui, findByText(root, "Renomear")!);
  relayout();
  ui.key("Escape");
  ui.down(2, 590);
  relayout();
  expect([open(), closes()]).toEqual([true, 0]);
  click(ui, findByText(root, "OK")!);
  relayout();
  expect(open()).toBe(false);
});

test("a Select inside a Dialog: a press in the dialog or Escape closes only the list", () => {
  const [open, setOpen] = createSignal(true);
  const [fruit, setFruit] = createSignal<string | undefined>(undefined);
  const { root, relayout } = mount(() => (
    <Dialog open={open} onClose={() => setOpen(false)} title="Filtro">
      <Select value={fruit} onChange={setFruit} options={FRUITS} />
    </Dialog>
  ));
  relayout();
  const ui = interact(root);
  const select = findByText(root, "Filtro")!.parent!.children[1]!;
  click(ui, select);
  relayout();
  expect(root.layers).toHaveLength(2);
  click(ui, findByText(root, "Filtro")!); // inside the dialog, outside the list
  relayout();
  expect([root.layers.length, open()]).toEqual([1, true]);
  click(ui, select);
  relayout();
  ui.key("Escape");
  relayout();
  expect([root.layers.length, open()]).toEqual([1, true]);
  ui.key("Escape");
  relayout();
  expect(open()).toBe(false);
});
