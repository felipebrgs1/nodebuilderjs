import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Button, Column, ErrorBoundary, For, Index, Overlay, Show, Text, UINode, batch, createContext, createEffect, createMemo,
  createRoot, createSignal, onCleanup, useContext,
} from "@nodebuilderjs/core";
import { click, findByText, interact, mount } from "@nodebuilderjs/core/testing";

const labels = (n: UINode): string[] => n.children.map((c) => c.label);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Boom(props: { message?: string }): never {
  throw new Error(props.message ?? "boom");
}

// --- Errors while creating the children ---

test("an error thrown by a child component shows the fallback", () => {
  const { root } = mount(() => (
    <ErrorBoundary fallback={<Text>falhou</Text>}>
      <Text>antes</Text>
      <Boom />
    </ErrorBoundary>
  ));
  expect(labels(root)).toEqual(['Text "falhou"']);
});

test("the fallback function gets the error; reset renders the children again", () => {
  let broken = true;
  function Flaky() {
    if (broken) throw new Error("ainda não");
    return <Text>pronto</Text>;
  }
  let reset = () => {};
  const { root } = mount(() => (
    <ErrorBoundary
      fallback={(err, r) => {
        reset = r;
        return <Text>{`erro: ${message(err)}`}</Text>;
      }}
    >
      <Flaky />
    </ErrorBoundary>
  ));
  expect(labels(root)).toEqual(['Text "erro: ainda não"']);
  reset(); // still broken: the fallback comes back
  expect(labels(root)).toEqual(['Text "erro: ainda não"']);
  broken = false;
  reset();
  expect(labels(root)).toEqual(['Text "pronto"']);
});

test("an error deep inside nested components and slots is caught", () => {
  const [on] = createSignal(true);
  const { root } = mount(() => (
    <Column>
      <ErrorBoundary fallback={<Text>falhou</Text>}>
        <Column>
          <Show when={on}>
            <Column>
              <Boom />
            </Column>
          </Show>
        </Column>
      </ErrorBoundary>
    </Column>
  ));
  expect(labels(root.children[0]!)).toEqual(['Text "falhou"']);
});

test("what the children created before the error is disposed", () => {
  const [n, setN] = createSignal(0);
  let runs = 0;
  let cleaned = 0;
  function Probe() {
    createEffect(() => {
      n();
      runs++;
    });
    onCleanup(() => cleaned++);
    return <Text>probe</Text>;
  }
  mount(() => (
    <ErrorBoundary fallback={<Text>falhou</Text>}>
      <Probe />
      <Boom />
    </ErrorBoundary>
  ));
  expect(cleaned).toBe(1);
  setN(1);
  expect(runs).toBe(1);
});

// --- Errors later, in effects and memos re-run by signals ---

test("an effect that throws when a signal changes switches to the fallback", () => {
  const [n, setN] = createSignal(1);
  let cleaned = 0;
  function Risky() {
    onCleanup(() => cleaned++);
    return (
      <Text>
        {() => {
          if (n() > 2) throw new Error(`n = ${n()}`);
          return `n = ${n()}`;
        }}
      </Text>
    );
  }
  const { root } = mount(() => (
    <Column>
      <ErrorBoundary fallback={(err) => <Text>{message(err)}</Text>}>
        <Risky />
      </ErrorBoundary>
    </Column>
  ));
  const col = root.children[0]!;
  setN(2);
  expect(labels(col)).toEqual(['Text "n = 2"']);
  setN(3);
  expect(labels(col)).toEqual(['Text "n = 3"']);
  expect(cleaned).toBe(1);
  setN(4); // the failed children are gone: nothing re-runs, nothing throws
  expect(labels(col)).toEqual(['Text "n = 3"']);
});

test("a memo that throws is caught too", () => {
  const [items, setItems] = createSignal<string[] | null>(["a"]);
  function Count() {
    const count = createMemo(() => items()!.length);
    return <Text>{() => `${count()} itens`}</Text>;
  }
  const { root } = mount(() => (
    <ErrorBoundary fallback={<Text>sem lista</Text>}>
      <Count />
    </ErrorBoundary>
  ));
  setItems(null);
  expect(labels(root)).toEqual(['Text "sem lista"']);
});

test("errors in rows of For and Index created later are caught", () => {
  const [items, setItems] = createSignal([1]);
  function Row(props: { n: number }) {
    if (props.n > 1) throw new Error("linha ruim");
    return <Text>{String(props.n)}</Text>;
  }
  const keyed = mount(() => (
    <ErrorBoundary fallback={<Text>falhou</Text>}>
      <For each={items}>{(n) => <Row n={n} />}</For>
    </ErrorBoundary>
  ));
  const byPosition = mount(() => (
    <ErrorBoundary fallback={<Text>falhou</Text>}>
      <Index each={items}>{(n) => <Row n={n()} />}</Index>
    </ErrorBoundary>
  ));
  expect(labels(keyed.root)).toEqual(['Text "1"']);
  setItems([1, 2]);
  expect(labels(keyed.root)).toEqual(['Text "falhou"']);
  expect(labels(byPosition.root)).toEqual(['Text "falhou"']);
});

test("an error in a branch shown later by Show is caught", () => {
  const [on, setOn] = createSignal(false);
  const { root } = mount(() => (
    <ErrorBoundary fallback={<Text>falhou</Text>}>
      <Show when={on} fallback={<Text>oculto</Text>}>
        <Boom />
      </Show>
    </ErrorBoundary>
  ));
  expect(labels(root)).toEqual(['Text "oculto"']);
  setOn(true);
  expect(labels(root)).toEqual(['Text "falhou"']);
});

test("the first error wins until reset", () => {
  const [n, setN] = createSignal(0);
  let shown: string[] = [];
  mount(() => (
    <ErrorBoundary fallback={(err) => (shown.push(message(err)), <Text>falhou</Text>)}>
      <Text>{() => (n() > 0 ? Boom({ message: "a" }) : "ok")}</Text>
      <Text>{() => (n() > 0 ? Boom({ message: "b" }) : "ok")}</Text>
    </ErrorBoundary>
  ));
  setN(1);
  expect(shown).toEqual(["a"]);
});

// --- Nesting and the rest of the tree ---

test("the nearest boundary catches; an error in a fallback goes to the next one", () => {
  const { root } = mount(() => (
    <Column>
      <ErrorBoundary fallback={<Text>externo</Text>}>
        <ErrorBoundary fallback={<Text>interno</Text>}>
          <Boom />
        </ErrorBoundary>
      </ErrorBoundary>
      <ErrorBoundary fallback={<Text>externo</Text>}>
        <ErrorBoundary fallback={() => <Boom />}>
          <Boom />
        </ErrorBoundary>
      </ErrorBoundary>
    </Column>
  ));
  expect(labels(root.children[0]!)).toEqual(['Text "interno"', 'Text "externo"']);
});

test("siblings outside the boundary keep working", () => {
  const [n, setN] = createSignal(0);
  const { root } = mount(() => (
    <Column>
      <Text>{() => `fora ${n()}`}</Text>
      <ErrorBoundary fallback={<Text>falhou</Text>}>
        <Text>{() => (n() > 0 ? Boom({}) : "dentro")}</Text>
      </ErrorBoundary>
    </Column>
  ));
  setN(1);
  expect(labels(root.children[0]!)).toEqual(['Text "fora 1"', 'Text "falhou"']);
});

test("children and fallback see the context around the boundary", () => {
  const Lang = createContext("pt");
  function Greeting() {
    return <Text>{useContext(Lang) === "pt" ? "Olá" : "Hello"}</Text>;
  }
  const [fail, setFail] = createSignal(false);
  const { root } = mount(() => (
    <Lang.Provider value="en">
      <ErrorBoundary fallback={<Greeting />}>
        <Greeting />
        <Show when={fail}>
          <Boom />
        </Show>
      </ErrorBoundary>
    </Lang.Provider>
  ));
  expect(labels(root)).toEqual(['Text "Hello"']);
  setFail(true);
  expect(labels(root)).toEqual(['Text "Hello"']);
  expect(findByText(root, "Hello")).toBeDefined();
});

test("an overlay inside the failed children is removed", () => {
  const [fail, setFail] = createSignal(false);
  const { root, relayout } = mount(() => (
    <ErrorBoundary fallback={<Text>falhou</Text>}>
      <Overlay>
        <Text>menu</Text>
      </Overlay>
      <Show when={fail}>
        <Boom />
      </Show>
    </ErrorBoundary>
  ));
  expect(findByText(root, "menu")).toBeDefined();
  setFail(true);
  relayout();
  expect(findByText(root, "menu")).toBeUndefined();
  expect(findByText(root, "falhou")).toBeDefined();
});

// --- Event handlers ---

test("a click that changes a signal and makes an effect throw is caught", () => {
  const [n, setN] = createSignal(0);
  const { root } = mount(() => (
    <ErrorBoundary fallback={<Text>falhou</Text>}>
      <Column>
        <Button label="mais" onClick={() => setN(n() + 1)} />
        <Text>{() => (n() > 0 ? Boom({}) : "ok")}</Text>
      </Column>
    </ErrorBoundary>
  ));
  click(findByText(root, "mais")!);
  expect(labels(root)).toEqual(['Text "falhou"']);
});

test("an error thrown by the handler itself is not caught: it reaches the caller", () => {
  const { root } = mount(() => (
    <ErrorBoundary fallback={<Text>falhou</Text>}>
      <Button label="quebrar" onClick={() => Boom({ message: "no handler" })} />
    </ErrorBoundary>
  ));
  const ui = interact(root);
  expect(() => {
    ui.press(findByText(root, "quebrar")!);
    ui.release(findByText(root, "quebrar")!);
  }).toThrow("no handler");
  expect(findByText(root, "quebrar")).toBeDefined();
});

// --- Without a boundary: errors stay visible and the queue keeps working ---

test("without a boundary, an error while mounting reaches the caller", () => {
  expect(() => mount(() => <Boom message="sem boundary" />)).toThrow("sem boundary");
});

test("without a boundary, an effect error reaches the setter; the other effects still run", () => {
  const [n, setN] = createSignal(0);
  const seen: number[] = [];
  const dispose = createRoot((d) => {
    createEffect(() => {
      if (n() === 1) throw new Error("effect");
    });
    createEffect(() => seen.push(n()));
    return d;
  });
  expect(() => setN(1)).toThrow("effect");
  expect(seen).toEqual([0, 1]);
  setN(2); // the queue is not stuck
  expect(seen).toEqual([0, 1, 2]);
  dispose();
});

test("an error inside batch is rethrown after every pending effect ran", () => {
  const [a, setA] = createSignal(0);
  const [b, setB] = createSignal(0);
  const seen: string[] = [];
  createRoot(() => {
    createEffect(() => {
      if (a() > 0) throw new Error("a");
    });
    createEffect(() => seen.push(`b=${b()}`));
  });
  expect(() =>
    batch(() => {
      setA(1);
      setB(1);
    }),
  ).toThrow("a");
  expect(seen).toEqual(["b=0", "b=1"]);
});

test("an update loop is reported (not a stack overflow) and leaves nothing pending", () => {
  const [n, setN] = createSignal(0);
  const [other, setOther] = createSignal(0);
  const seen: number[] = [];
  createRoot(() => {
    createEffect(() => {
      if (n() >= 100) setN(n() + 1);
    });
    createEffect(() => seen.push(other()));
  });
  expect(() => setN(100)).toThrow("reactive update loop");
  setOther(1);
  expect(seen).toEqual([0, 1]);
});

test("an unhandled error is reported from the app's code, not from where the framework passes it on", () => {
  // `bun test` prints the frames of the last `throw`: rethrowing an error in the framework hides
  // the app's frame. A fixture test file, run by `bun test`, shows what a user would see.
  const dir = mkdtempSync(join(tmpdir(), "nb-stack-"));
  const src = join(import.meta.dir, "../../src/index.ts");
  writeFileSync(join(dir, "stack.test.ts"), `
import { test } from "bun:test";
import { createEffect, createRoot, createSignal } from ${JSON.stringify(src)};
function appCode(d: any) { return d.getDate(); }
test("mount", () => { createRoot(() => createEffect(() => appCode(undefined))); });
test("queue", () => {
  const [s, set] = createSignal(0);
  createRoot(() => createEffect(() => { if (s()) appCode(undefined); }));
  createRoot(() => createEffect(() => { s(); }));
  set(1);
});
`);
  try {
    const run = Bun.spawnSync([process.execPath, "test", "./stack.test.ts"], { cwd: dir, env: { ...process.env, NO_COLOR: "1" } });
    const out = run.stderr.toString();
    // The first frame printed under each failure is the app's function.
    const firstFrames = [...out.matchAll(/^TypeError: [^\n]*\n\s+at ([^\s(]+)/gm)].map((m) => m[1]);
    expect(firstFrames).toEqual(["appCode", "appCode"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
