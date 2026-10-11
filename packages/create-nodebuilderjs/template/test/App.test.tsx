import { expect, test } from "bun:test";
import { click, findByText, mount } from "@nodebuilderjs/core/testing";
import { App } from "../src/App.js";

test("o botão conta os cliques", () => {
  const { root } = mount(() => <App />);
  expect(findByText(root, "Você clicou 0 vezes")).toBeDefined();

  click(findByText(root, "Clique aqui")!);
  expect(findByText(root, "Você clicou 1 vez")).toBeDefined();

  click(findByText(root, "Zerar")!);
  expect(findByText(root, "Você clicou 0 vezes")).toBeDefined();
});
