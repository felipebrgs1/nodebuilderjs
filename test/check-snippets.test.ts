import { expect, test } from "bun:test";
import { extractSnippets } from "../scripts/check-snippets.js";

const md = (...lines: string[]) => lines.join("\n");

test("extracts ts and tsx blocks with the markdown line of their first line of code", () => {
  const snippets = extractSnippets(
    md(
      "# Title", // 1
      "", // 2
      "```tsx", // 3
      'import { Text } from "@nodebuilderjs/core";', // 4
      "<Text>hi</Text>;", // 5
      "```", // 6
      "```sh", // 7
      "bun test", // 8
      "```", // 9
      "```ts", // 10
      'import { createSignal } from "@nodebuilderjs/core";', // 11
      "```", // 12
    ),
  );
  expect(snippets).toEqual([
    { lang: "tsx", line: 4, code: 'import { Text } from "@nodebuilderjs/core";\n<Text>hi</Text>;', check: true },
    { lang: "ts", line: 11, code: 'import { createSignal } from "@nodebuilderjs/core";', check: true },
  ]);
});

test("blocks without an import are illustrative and not checked", () => {
  const [s] = extractSnippets(md("```tsx", "<Text>{count}</Text>", "```"));
  expect(s!.check).toBe(false);
});

test("<!-- no-check --> and <!-- check --> before the fence override the import rule", () => {
  const snippets = extractSnippets(
    md(
      "<!-- no-check -->",
      "```tsx",
      'import { x } from "y";',
      "```",
      "<!-- check -->",
      "",
      "```ts",
      "const a: number = 1;",
      "```",
    ),
  );
  expect(snippets.map((s) => s.check)).toEqual([false, true]);
});

test("a ts fence inside another fence is not a block", () => {
  const snippets = extractSnippets(md("````md", "```ts", 'import "x";', "```", "````"));
  expect(snippets).toEqual([]);
});

test("an indented fence (inside a list) has its indentation removed", () => {
  const [s] = extractSnippets(md("- item", "  ```ts", '  import "x";', "    f();", "  ```"));
  expect(s).toEqual({ lang: "ts", line: 3, code: 'import "x";\n  f();', check: true });
});
