// What the browser build swaps in for Node (fonts as CSS, files from memory). The page itself
// runs only in a browser; see `nodebuilder web` in test/cli/web.test.ts.
import { describe, expect, test } from "bun:test";
import { existsSync, fileKey, files, readFileSync } from "../../src/web/shims/fs.js";
import { cssFont } from "../../src/web/text.js";
import { fontId, fontSpec } from "../../src/render/node.js";

describe("cssFont: a TEXT command's font as a CSS font", () => {
  const spec = (family: string) => fontSpec({ weight: 400, italic: false, letterSpacing: 0, family, features: "", variations: "" });

  test("weight, slant and size; the system UI font without a family", () => {
    expect(cssFont(fontId(400, false), "", 14)).toBe("400 14px system-ui, sans-serif");
    expect(cssFont(fontId(700, true), "", 21)).toBe("italic 700 21px system-ui, sans-serif");
  });

  test("named families are quoted, generic ones are not, and the UI font stays as the fallback", () => {
    expect(cssFont(fontId(500, false), spec("Inter, 'Noto Sans', monospace"), 12)).toBe(`500 12px "Inter", 'Noto Sans', monospace, system-ui, sans-serif`);
  });
});

describe("node:fs from memory", () => {
  test("files fetched by boot() are read synchronously by any spelling of their path", () => {
    files.set(fileKey("./assets/a.svg"), new TextEncoder().encode("<svg/>"));
    expect(readFileSync("/assets/a.svg", "utf8")).toBe("<svg/>");
    expect(readFileSync("assets/a.svg")).toBeInstanceOf(Uint8Array);
    expect(existsSync("./assets/b.svg")).toBe(false);
    expect(() => readFileSync("./assets/b.svg")).toThrow(/only files imported with \{ type: "file" \}/);
  });
});
