// System clipboard (plain text). While the window is open the app runtime plugs in the
// native one; before that, and in tests, it is an in-memory clipboard.

import type { Native } from "./native.js";

export interface ClipboardBackend {
  write(text: string): void;
  read(): Promise<string>;
}

function memoryClipboard(): ClipboardBackend {
  let text = "";
  return {
    write: (t) => void (text = t),
    read: async () => text,
  };
}

let backend = memoryClipboard();

/** `null` goes back to an in-memory clipboard. */
export function setClipboardBackend(next: ClipboardBackend | null) {
  backend = next ?? memoryClipboard();
}

export const clipboard = {
  writeText: (text: string) => backend.write(text),
  /** Resolves to "" when the clipboard is empty or holds something that isn't text. */
  readText: () => backend.read(),
};

/**
 * The clipboard of the native core. Reading is asynchronous on every platform (another
 * app sends the data), so each read asks again and the next "clipboard" event, passed to
 * `received`, answers all of them: the platform replaces a request still in flight, and
 * asking again unsticks a source that never answered.
 */
export function nativeClipboard(native: Pick<Native, "writeClipboard" | "readClipboard">) {
  let waiting: ((text: string) => void)[] = [];
  const answer = (text: string) => {
    const resolve = waiting;
    waiting = [];
    for (const r of resolve) r(text);
  };
  return {
    write: (text: string) => native.writeClipboard(text),
    read: () =>
      new Promise<string>((resolve) => {
        waiting.push(resolve);
        native.readClipboard();
      }),
    received: answer,
    /** The window closed: nothing will answer anymore. */
    close: () => answer(""),
  };
}
