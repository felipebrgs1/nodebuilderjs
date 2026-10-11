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
  `scroll(n, dy)`, `key("Return")`, `type("texto")` e `focused`.

```tsx
const ui = interact(root);
ui.press(campo);            // foca o TextField
ui.type("Ana");             // digita no campo focado
ui.key("Return");           // dispara o onSubmit
ui.drag(slider, 80, 0);     // arrasta 80 px para a direita
```
- `debugTree(node)` (de `@nodebuilderjs/core`): árvore com posições, ótimo para ver o layout.

## Dicas

- Estado muda na hora (signals são síncronos); não há `await` nem `act()`.
- Prefira `interact` a chamar handlers à mão: ele testa também foco, hover e propagação.
  Depois de mudanças que movem nós, chame `relayout()` antes de interagir de novo.
- Teste cálculos de layout com tamanhos fixos (`width`, `height`) para não depender das
  métricas falsas.
- Antes de concluir uma tarefa: `bun run typecheck && bun test`.
