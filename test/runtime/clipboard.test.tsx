import { afterEach, beforeEach, expect, test } from "bun:test";
import { Column, TextField, clipboard, createSignal } from "@nodebuilderjs/core";
import { interact, mount } from "@nodebuilderjs/core/testing";
import { nativeClipboard, setClipboardBackend } from "../../src/runtime/clipboard.js";

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Copying in other files (TextField, TextArea) leaves text in the shared in-memory clipboard.
beforeEach(() => setClipboardBackend(null));
afterEach(() => setClipboardBackend(null));

test("without a window the clipboard lives in memory", async () => {
  expect(await clipboard.readText()).toBe("");
  clipboard.writeText("olá");
  expect(await clipboard.readText()).toBe("olá");
});

test("native clipboard: writes go straight through, reads wait for the answer", async () => {
  const calls: string[] = [];
  const native = nativeClipboard({
    writeClipboard: (text) => calls.push(`write ${text}`),
    readClipboard: () => calls.push("read"),
  });
  setClipboardBackend(native);

  clipboard.writeText("abc");
  const first = clipboard.readText();
  const second = clipboard.readText(); // asks again: the platform replaces a request in flight
  native.received("colado");
  expect(await Promise.all([first, second])).toEqual(["colado", "colado"]);
  expect(calls).toEqual(["write abc", "read", "read"]);
});

test("native clipboard: closing answers pending reads with an empty string", async () => {
  const native = nativeClipboard({ writeClipboard() {}, readClipboard() {} });
  setClipboardBackend(native);
  const pending = clipboard.readText();
  native.close();
  expect(await pending).toBe("");
});

function field(initial: string) {
  const [value, setValue] = createSignal(initial);
  const { root } = mount(() => <Column><TextField value={value} onInput={setValue} /></Column>);
  const ui = interact(root);
  ui.press(root.children[0]!.children[0]!); // focus; the caret goes to the end
  return { value, ui };
}

test("TextField: Ctrl+V pastes at the caret", async () => {
  clipboard.writeText("mundo");
  const { value, ui } = field("olá ");
  ui.key("v", { ctrl: true });
  await settle();
  expect(value()).toBe("olá mundo");
  ui.type("!");
  expect(value()).toBe("olá mundo!"); // the caret moved past the pasted text
});

test("TextField: Shift+Insert pastes too, and line breaks become spaces", async () => {
  clipboard.writeText("um\ndois\r\ntrês\t!");
  const { value, ui } = field("");
  ui.key("Insert", { shift: true });
  await settle();
  expect(value()).toBe("um dois três !");
});
