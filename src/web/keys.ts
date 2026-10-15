// DOM keyboard events -> the key events the native core sends (xkb keysym names), so shortcuts
// and text input work the same as on the desktop.

import type { NativeKeyEvent } from "../runtime/native.js";

/** The part of a DOM KeyboardEvent we read. */
export interface DomKey {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
}

// DOM `key` values whose xkb name differs; the rest (Tab, Home, End, Delete, Escape, F1...) match.
const NAMED: Record<string, string> = {
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Enter: "Return", Backspace: "BackSpace", PageUp: "Page_Up", PageDown: "Page_Down", ContextMenu: "Menu",
  Shift: "Shift_L", Control: "Control_L", Alt: "Alt_L", Meta: "Super_L", AltGraph: "ISO_Level3_Shift", CapsLock: "Caps_Lock",
};

// ASCII punctuation by its keysym name.
const PUNCTUATION: Record<string, string> = {
  " ": "space", "!": "exclam", '"': "quotedbl", "#": "numbersign", $: "dollar", "%": "percent", "&": "ampersand",
  "'": "apostrophe", "(": "parenleft", ")": "parenright", "*": "asterisk", "+": "plus", ",": "comma", "-": "minus",
  ".": "period", "/": "slash", ":": "colon", ";": "semicolon", "<": "less", "=": "equal", ">": "greater",
  "?": "question", "@": "at", "[": "bracketleft", "\\": "backslash", "]": "bracketright", "^": "asciicircum",
  _: "underscore", "`": "grave", "{": "braceleft", "|": "bar", "}": "braceright", "~": "asciitilde",
};

/** One printable character (a code point; emoji sequences count as text too). */
const printable = (key: string) => key.length === 1 || [...key].length === 1 || /\p{Extended_Pictographic}/u.test(key);

export function keyEvent(type: "keydown" | "keyup", e: DomKey): NativeKeyEvent {
  const isText = printable(e.key);
  const key = NAMED[e.key] ?? PUNCTUATION[e.key] ?? e.key;
  // Like xkb: Ctrl and Super shortcuts type nothing (Alt alone can be AltGr on some layouts).
  const text = isText && !e.ctrlKey && !e.metaKey ? e.key : "";
  return { type, key, text, repeat: e.repeat, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, super: e.metaKey };
}
