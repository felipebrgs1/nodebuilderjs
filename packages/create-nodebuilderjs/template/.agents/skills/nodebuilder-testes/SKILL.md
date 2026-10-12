---
name: nodebuilder-testes
description: Escrever e depurar testes de apps nodebuilder com bun test, sem abrir janela (mount, findByText, click, interact para mouse e teclado, layout, debugTree). Use ao criar testes, ao verificar uma mudança de comportamento ou layout, ou quando um teste de componente falha.
---

# Testes sem janela

`bun test` roda os arquivos de `test/`. Nada abre janela: `mount` monta a árvore com
métricas de texto falsas (**8 px por caractere, linha de 20 px**), então o layout é
determinístico.

```tsx
import { expect, test } from "bun:test";
import { click, findAll, findByText, mount } from "@nodebuilderjs/core/testing";
import { debugTree } from "@nodebuilderjs/core";
import { App } from "../src/App.js";

test("adiciona uma tarefa", () => {
  const { root, relayout, dispose } = mount(() => <App />, { width: 800, height: 600 });
  click(findByText(root, "Adicionar")!);          // sobe até o pai com onClick (o Button)
  expect(findByText(root, /1 tarefa/)).toBeDefined();
  relayout();                                     // recalcula posições após mudanças
  const item = findByText(root, "Nova tarefa")!;
  expect(item.y).toBeGreaterThan(0);
  dispose();                                      // descarta effects e signals do app
});
```

## API (`@nodebuilderjs/core/testing`)

- `mount(view, size?)` → `{ root, relayout, dispose }`. Layout feito uma vez no `mount`;
  chame `relayout()` antes de checar `x`, `y`, `width`, `height` depois de mudar estado.
- `findByText(root, "texto" | /regex/)`: primeiro `Text` cujo conteúdo inteiro bate.
- `findAll(root, (n) => ...)`: busca livre; `n.label` é `"Text \"...\""`, `"Button"`, `"Row"`...
- `click(node)`: dispara o `onClick` do nó ou do ancestral mais próximo (atalho rápido).
- `interact(root)`: mouse e teclado entregues como no app de verdade (hover, foco, captura
  ao arrastar, Tab): `hover(n)`, `press(n)`, `release(n)`, `drag(n, dx, dy)`, `move(x, y)`,
  `down(x, y)`/`up(x, y)` (botão numa posição da janela, ex.: na barra de rolagem),
  `scroll(n, dy, { dx, shift })`, `key("Return")`, `key("c", { ctrl: true })`,
  `type("texto")`, `focused` e `cursor` (o cursor que a janela mostraria).

```tsx
const ui = interact(root);
ui.press(campo);            // foca o TextField
ui.type("Ana");             // digita no campo focado
ui.key("Return");           // dispara o onSubmit
ui.drag(slider, 80, 0);     // arrasta 80 px para a direita
```
- `debugTree(node)` (de `@nodebuilderjs/core`): árvore com posições, ótimo para ver o layout.
- `ref={(el) => el.focus()}` (foco ao criar) vale num microtask: crie o `interact(root)` e
  faça `await Promise.resolve()` antes de digitar. `onResize` dispara a cada `relayout()`
  em que o tamanho mudou.
- Rolagem: `n.scrollY`/`n.scrollX` dizem a posição; `ui.scroll(n, 60)` usa a roda,
  `ui.key("Next")` (PageDown; PageUp é `"Prior"`) o teclado. `scrollTo` e `scrollIntoView()`
  valem no próximo layout: chame `relayout()` antes de conferir.
- Overlays são posicionados no layout: depois de abrir ou fechar um, chame `relayout()`.
  O conteúdo fica em `root.layers` (não em `root.children`); `findByText(root, ...)` busca
  nos dois.

## Área de transferência e seleção

Nos testes, `clipboard` é uma área em memória (sem janela, sem sistema). Para conferir uma
cópia, leia de volta; ler é assíncrono, então o teste vira `async`:

```tsx
import { expect, test } from "bun:test";
import { Column, Text, clipboard } from "@nodebuilderjs/core";
import { interact, mount } from "@nodebuilderjs/core/testing";

test("copia o id selecionando o texto", async () => {
  const { root } = mount(() => <Column align="start"><Text selectable>id-42</Text></Column>);
  const ui = interact(root);
  const id = root.children[0]!.children[0]!;
  ui.press(id);                 // o clique dá o foco ao texto
  ui.release(id);
  ui.key("a", { ctrl: true });  // Ctrl+A: tudo (ou ui.drag(id, dx, 0) para um trecho)
  ui.key("c", { ctrl: true });
  expect(await clipboard.readText()).toBe("id-42");
});
```

Para testar colar num `TextField`, escreva antes com `clipboard.writeText(...)`, foque o
campo, `ui.key("v", { ctrl: true })` e espere uma volta do loop
(`await new Promise((r) => setImmediate(r))`) antes de conferir o valor. A área em memória
é compartilhada no arquivo: escreva o valor esperado no começo de cada teste.

## Dicas

- Estado muda na hora (signals são síncronos); não há `await` nem `act()` (a exceção é
  ler a área de transferência, acima).
- Prefira `interact` a chamar handlers à mão: ele testa também foco, hover e propagação.
  Depois de mudanças que movem nós, chame `relayout()` antes de interagir de novo.
- Teste cálculos de layout com tamanhos fixos (`width`, `height`) para não depender das
  métricas falsas.
- Antes de concluir uma tarefa: `bun run typecheck && bun test`.
