import { expect, test } from "bun:test";
import {
  Column, For, Index, Match, Show, Switch, Text, UINode, createContext, createSignal, onCleanup, useContext,
} from "@nodebuilderjs/core";
import { mount } from "@nodebuilderjs/core/testing";

const labels = (n: UINode): string[] => n.children.map((c) => c.label);

function counter() {
  const log = { created: 0, disposed: 0 };
  function Probe(props: { name: string }) {
    log.created++;
    onCleanup(() => log.disposed++);
    return <Text>{props.name}</Text>;
  }
  return { log, Probe };
}

// --- Switch / Match ---

test("Switch renders the first Match whose condition holds, or the fallback", () => {
  const [n, setN] = createSignal(0);
  const { root } = mount(() => (
    <Switch fallback={<Text>zero</Text>}>
      <Match when={() => n() > 10}>
        <Text>big</Text>
      </Match>
      <Match when={() => n() > 0}>
        <Text>small</Text>
      </Match>
      <Match when={() => n() > 5}>
        <Text>never (shadowed)</Text>
      </Match>
    </Switch>
  ));
  expect(labels(root)).toEqual(['Text "zero"']);
  setN(3);
  expect(labels(root)).toEqual(['Text "small"']);
  setN(7);
  expect(labels(root)).toEqual(['Text "small"']);
  setN(20);
  expect(labels(root)).toEqual(['Text "big"']);
  setN(-1);
  expect(labels(root)).toEqual(['Text "zero"']);
});

test("Switch only recreates the content when the chosen Match changes", () => {
  const { log, Probe } = counter();
  const [n, setN] = createSignal(1);
  mount(() => (
    <Switch>
      <Match when={n}>
        <Probe name="truthy" />
      </Match>
    </Switch>
  ));
  expect(log).toEqual({ created: 1, disposed: 0 });
  setN(2);
  setN(3);
  expect(log).toEqual({ created: 1, disposed: 0 });
  setN(0);
  expect(log).toEqual({ created: 1, disposed: 1 });
  setN(4);
  expect(log).toEqual({ created: 2, disposed: 1 });
});

test("Match is lazy: content of a Match that never wins is never created", () => {
  const { log, Probe } = counter();
  mount(() => (
    <Switch>
      <Match when={true}>
        <Text>first</Text>
      </Match>
      <Match when={true}>
        <Probe name="second" />
      </Match>
    </Switch>
  ));
  expect(log.created).toBe(0);
});

test("Match takes a function child that receives the value as an accessor", () => {
  const [user, setUser] = createSignal<{ name: string } | null>({ name: "Ana" });
  let renders = 0;
  const { root } = mount(() => (
    <Switch fallback={<Text>anônimo</Text>}>
      <Match when={user}>
        {(u) => {
          renders++;
          return <Text>{() => `olá ${u().name}`}</Text>;
        }}
      </Match>
    </Switch>
  ));
  expect(labels(root)).toEqual(['Text "olá Ana"']);
  setUser({ name: "Bia" });
  expect(labels(root)).toEqual(['Text "olá Bia"']);
  expect(renders).toBe(1);
  setUser(null);
  expect(labels(root)).toEqual(['Text "anônimo"']);
});

test("Switch is disposed with its owner", () => {
  const { log, Probe } = counter();
  const { dispose } = mount(() => (
    <Switch>
      <Match when={true}>
        <Probe name="x" />
      </Match>
    </Switch>
  ));
  dispose();
  expect(log).toEqual({ created: 1, disposed: 1 });
});

test("Switch rejects other children and Match outside a Switch", () => {
  expect(() =>
    mount(() => (
      <Switch>
        <Text>solto</Text>
      </Switch>
    )),
  ).toThrow("<Switch> only takes <Match> children");
  expect(() =>
    mount(() => (
      <Match when={true}>
        <Text>x</Text>
      </Match>
    )),
  ).toThrow("<Match> must be a direct child of <Switch>");
});

test("Switch skips conditional (false/null) children", () => {
  const extra = false;
  const { root } = mount(() => (
    <Switch>
      {extra && (
        <Match when={true}>
          <Text>extra</Text>
        </Match>
      )}
      <Match when={true}>
        <Text>base</Text>
      </Match>
    </Switch>
  ));
  expect(labels(root)).toEqual(['Text "base"']);
});

// --- Show with a function child (same form as Match) ---

test("Show takes a function child that receives the value as an accessor", () => {
  const [count, setCount] = createSignal(0);
  let renders = 0;
  const { root } = mount(() => (
    <Show when={count} fallback={<Text>nenhum</Text>}>
      {(c) => {
        renders++;
        return <Text>{() => `${c()} itens`}</Text>;
      }}
    </Show>
  ));
  expect(labels(root)).toEqual(['Text "nenhum"']);
  setCount(2);
  setCount(3);
  expect(labels(root)).toEqual(['Text "3 itens"']);
  expect(renders).toBe(1);
});

test("a zero-argument function child of Show is still a reactive child", () => {
  const [n, setN] = createSignal(1);
  const { root } = mount(() => <Show when={true}>{() => `n=${n()}`}</Show>);
  expect(labels(root)).toEqual(['Text "n=1"']);
  setN(2);
  expect(labels(root)).toEqual(['Text "n=2"']);
});

// --- Nesting: a change inside never rebuilds the components around it ---

test("a component inside Show is not recreated when a Show inside it toggles", () => {
  const [flag, setFlag] = createSignal(false);
  let created = 0;
  function Panel() {
    created++;
    return (
      <Show when={flag} fallback={<Text>off</Text>}>
        <Text>on</Text>
      </Show>
    );
  }
  const { root } = mount(() => (
    <Column>
      <Show when={true}>
        <Panel />
      </Show>
    </Column>
  ));
  setFlag(true);
  expect(labels(root.children[0]!)).toEqual(['Text "on"']);
  expect(created).toBe(1);
});

test("a For row is not recreated when a Switch inside it changes branch", () => {
  const [done, setDone] = createSignal(false);
  let rows = 0;
  const { root } = mount(() => (
    <Column>
      <For each={["a"]}>
        {(item) => {
          rows++;
          return (
            <Switch fallback={<Text>{`${item}: aberto`}</Text>}>
              <Match when={done}>
                <Text>{`${item}: feito`}</Text>
              </Match>
            </Switch>
          );
        }}
      </For>
    </Column>
  ));
  setDone(true);
  expect(labels(root.children[0]!)).toEqual(['Text "a: feito"']);
  expect(rows).toBe(1);
});

test("a list at the top of mount keeps its rows when it changes", () => {
  const [items, setItems] = createSignal(["a"]);
  let rows = 0;
  mount(() => (
    <For each={items}>
      {(item) => {
        rows++;
        return <Text>{item}</Text>;
      }}
    </For>
  ));
  setItems(["a", "b"]);
  expect(rows).toBe(2);
});

// --- Index ---

test("Index keeps rows by position: values update in place, index is a number", () => {
  const [items, setItems] = createSignal(["a", "b", "c"]);
  let renders = 0;
  const { root } = mount(() => (
    <Column>
      <Index each={items}>
        {(item, i) => {
          renders++;
          return <Text>{() => `${i}:${item()}`}</Text>;
        }}
      </Index>
    </Column>
  ));
  const col = root.children[0]!;
  const first = col.children[0];
  expect(labels(col)).toEqual(['Text "0:a"', 'Text "1:b"', 'Text "2:c"']);
  setItems(["c", "b", "a"]);
  expect(labels(col)).toEqual(['Text "0:c"', 'Text "1:b"', 'Text "2:a"']);
  expect(col.children[0]).toBe(first);
  expect(renders).toBe(3);
});

test("Index creates and disposes rows only when the length changes", () => {
  const { log, Probe } = counter();
  const [items, setItems] = createSignal([1, 2]);
  const { root } = mount(() => (
    <Column>
      <Index each={items}>{(item) => <Probe name={String(item())} />}</Index>
    </Column>
  ));
  expect(log).toEqual({ created: 2, disposed: 0 });
  setItems([1, 2, 3, 4]);
  expect(log).toEqual({ created: 4, disposed: 0 });
  expect(root.children[0]!.children.length).toBe(4);
  setItems([9]);
  expect(log).toEqual({ created: 4, disposed: 3 });
  expect(root.children[0]!.children.length).toBe(1);
});

test("Index updates only the positions whose value changed", () => {
  const [items, setItems] = createSignal([1, 2, 3]);
  const runs = [0, 0, 0];
  mount(() => (
    <Column>
      <Index each={items}>
        {(item, i) => (
          <Text>
            {() => {
              runs[i]!++;
              return String(item());
            }}
          </Text>
        )}
      </Index>
    </Column>
  ));
  setItems([1, 5, 3]);
  expect(runs).toEqual([1, 2, 1]);
});

test("Index shows the fallback for an empty list and disposes rows with its owner", () => {
  const { log, Probe } = counter();
  const [items, setItems] = createSignal<string[]>([]);
  const { root, dispose } = mount(() => (
    <Index each={items} fallback={<Text>vazio</Text>}>
      {(item) => <Probe name={item()} />}
    </Index>
  ));
  expect(labels(root)).toEqual(['Text "vazio"']);
  setItems(["x", "y"]);
  expect(labels(root)).toEqual(['Text "x"', 'Text "y"']);
  dispose();
  expect(log).toEqual({ created: 2, disposed: 2 });
});

test("Index stores functions as values (not as updaters)", () => {
  const f = () => "f";
  const g = () => "g";
  const [items, setItems] = createSignal([f]);
  const { root } = mount(() => <Index each={items}>{(item) => <Text>{() => item()()}</Text>}</Index>);
  setItems([g]);
  expect(labels(root)).toEqual(['Text "g"']);
});

test("rows of Index and content of Switch see the context around them", () => {
  const Lang = createContext("pt");
  function Greeting() {
    return <Text>{useContext(Lang) === "pt" ? "Olá" : "Hello"}</Text>;
  }
  const [items, setItems] = createSignal([1]);
  const [on, setOn] = createSignal(false);
  const { root } = mount(() => (
    <Lang.Provider value="en">
      <Column>
        <Index each={items}>{() => <Greeting />}</Index>
        <Switch>
          <Match when={on}>
            <Greeting />
          </Match>
        </Switch>
        <For each={[1]}>{() => <Greeting />}</For>
      </Column>
    </Lang.Provider>
  ));
  setItems([1, 2]);
  setOn(true);
  expect(labels(root.children[0]!)).toEqual(['Text "Hello"', 'Text "Hello"', 'Text "Hello"', 'Text "Hello"']);
});
