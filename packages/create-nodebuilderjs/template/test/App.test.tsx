import { expect, test } from "bun:test";
import { findAll, findByText, interact, mount } from "@nodebuilderjs/core/testing";
import { App } from "../src/App.js";

// Os testes rodam sem janela. interact() entrega mouse e teclado como no app de verdade.

test("o botão conta os cliques", () => {
  const { root, relayout } = mount(() => <App />);
  const ui = interact(root);
  expect(findByText(root, "Você clicou 0 vezes")).toBeDefined();

  ui.press(findByText(root, "Clique aqui")!);
  ui.release(findByText(root, "Clique aqui")!);
  relayout();
  expect(findByText(root, "Você clicou 1 vez")).toBeDefined();

  ui.press(findByText(root, "Zerar")!);
  ui.release(findByText(root, "Zerar")!);
  relayout();
  expect(findByText(root, "Você clicou 0 vezes")).toBeDefined();
});

test("adicionar, concluir e limpar tarefas", () => {
  const { root, relayout } = mount(() => <App />, { width: 800, height: 900 });
  const ui = interact(root);
  const clique = (texto: string) => {
    const alvo = findByText(root, texto)!;
    ui.press(alvo);
    ui.release(alvo);
    relayout();
  };
  expect(findByText(root, "2 pendentes")).toBeDefined();

  // Digita no campo e confirma com Enter; texto vazio não vira tarefa.
  ui.press(findAll(root, (n) => n.label === "TextField")[0]!);
  ui.type("Escrever um teste");
  ui.key("Return");
  ui.key("Return");
  relayout();
  expect(findByText(root, "Escrever um teste")).toBeDefined();
  expect(findByText(root, "3 pendentes")).toBeDefined();

  clique("Ler o README"); // o texto da tarefa também marca a caixa
  expect(findByText(root, "2 pendentes")).toBeDefined();

  clique("Limpar concluídas");
  expect(findByText(root, "Ler o README")).toBeUndefined();
  expect(findByText(root, "2 pendentes")).toBeDefined();
});
