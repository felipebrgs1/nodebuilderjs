import { expect, test } from "bun:test";
import { Column, For, Show, Text, createContext, createSignal, onCleanup, useContext } from "@nodebuilderjs/core";
import type { Accessor } from "@nodebuilderjs/core";
import { findByText, mount } from "@nodebuilderjs/core/testing";

const Lang = createContext("pt");

function Greeting() {
  const lang = useContext(Lang);
  return <Text>{lang === "pt" ? "Olá" : "Hello"}</Text>;
}

test("useContext returns the default value without a provider", () => {
  const { root } = mount(() => <Greeting />);
  expect(findByText(root, "Olá")).toBeDefined();
});

test("a provider passes its value to descendants; the nearest one wins", () => {
  const { root } = mount(() => (
    <Column>
      <Lang.Provider value="en">
        <Column>
          <Greeting />
          <Lang.Provider value="pt">
            <Greeting />
          </Lang.Provider>
        </Column>
      </Lang.Provider>
      <Greeting />
    </Column>
  ));
  const texts = root.children[0]!.children.flatMap((c) => (c.label.startsWith("Text") ? [c] : c.children));
  expect(texts.map((t) => t.label)).toEqual(['Text "Hello"', 'Text "Olá"', 'Text "Olá"']);
});

test("components created later by <For> and <Show> still see the provider", () => {
  const [items, setItems] = createSignal(["a"]);
  const [visible, setVisible] = createSignal(false);
  const { root } = mount(() => (
    <Lang.Provider value="en">
      <Column>
        <For each={items}>{() => <Greeting />}</For>
        <Show when={visible}>
          <Greeting />
        </Show>
      </Column>
    </Lang.Provider>
  ));
  setItems(["a", "b"]);
  setVisible(true);
  const labels = root.children[0]!.children.map((c) => c.label);
  expect(labels).toEqual(['Text "Hello"', 'Text "Hello"', 'Text "Hello"']);
});

test("a reactive value goes through the context as an accessor", () => {
  const Theme = createContext<Accessor<string>>(() => "claro");
  const [mode, setMode] = createSignal("claro");
  function Label() {
    const theme = useContext(Theme);
    return <Text>{() => `tema ${theme()}`}</Text>;
  }
  const { root } = mount(() => (
    <Theme.Provider value={mode}>
      <Label />
    </Theme.Provider>
  ));
  setMode("escuro");
  expect(findByText(root, "tema escuro")).toBeDefined();
});

test("children inside a provider are disposed with it", () => {
  const [on, setOn] = createSignal(true);
  let cleaned = 0;
  function Probe() {
    useContext(Lang);
    onCleanup(() => cleaned++);
    return <Text>x</Text>;
  }
  mount(() => (
    <Show when={on}>
      <Lang.Provider value="en">
        <Probe />
      </Lang.Provider>
    </Show>
  ));
  setOn(false);
  expect(cleaned).toBe(1);
});
