// Editing shared by TextField and TextArea: the selection (anchor and focus, in code points),
// undo/redo, and the keys every text field understands. The value itself belongs to the app
// (`value` + `onInput`); this keeps what the widget needs around it. Each widget supplies how
// the caret moves between lines (TextArea) or not at all (TextField).

import { type Color, type Handlers, type KeyEvent, type Style, type UINode } from "../../render/node.js";
import { type Accessor, type MaybeAccessor, createEffect, createSignal, onCleanup, read, untrack } from "../../reactive/signals.js";
import { clipboard } from "../../runtime/clipboard.js";
import { theme } from "../../theme.js";
import { type InteractionState, type StyleProps, applyProps, disableable, interaction } from "../props.js";
import { wordAt } from "./text-selection.js";

/** A selection in code points: `focus` is where the caret is, `anchor` the other end (equal: just a caret). */
export interface TextSelection {
  anchor: number;
  focus: number;
}

interface Snapshot {
  value: string;
  anchor: number;
  focus: number;
}

/** Consecutive edits of one kind (typing, deleting) undo together, up to a pause or a caret move. */
type EditKind = "type" | "delete" | "other";

const HISTORY = 200;
const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}\p{M}_]/u.test(ch);

export interface EditHost {
  value(): string;
  /** The app's onInput. */
  setValue(value: string): void;
  /** The selection changed (or the value did): repaint, report, reveal the caret. */
  changed(): void;
}

export class EditSession {
  anchor = 0;
  focus = 0;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private lastKind: EditKind | null = null;
  /** The last value this session gave the app: anything else came from outside. */
  private emitted: string | null = null;
  private cachedValue = "";
  private cachedChars: string[] = [];

  constructor(private host: EditHost) {}

  get chars(): string[] {
    const v = this.host.value();
    if (v !== this.cachedValue) {
      this.cachedValue = v;
      this.cachedChars = Array.from(v);
    }
    return this.cachedChars;
  }

  range(): [number, number] {
    return [Math.min(this.anchor, this.focus), Math.max(this.anchor, this.focus)];
  }

  selectedText(): string {
    const [a, b] = this.range();
    return this.chars.slice(a, b).join("");
  }

  /** Sets the selection (clamped to the text); `changed` only when it moved. */
  select(anchor: number, focus = anchor) {
    const n = this.chars.length;
    anchor = Math.max(0, Math.min(n, anchor));
    focus = Math.max(0, Math.min(n, focus));
    if (anchor === this.anchor && focus === this.focus) return;
    this.anchor = anchor;
    this.focus = focus;
    this.lastKind = null; // a caret move ends the run of typing that undoes together
    this.host.changed();
  }

  /** Moves the caret to `to`, extending the selection with Shift. */
  moveTo(to: number, extend: boolean) {
    this.select(extend ? this.anchor : to, to);
  }

  /** The value changed and not through this session (the app set it): keep the selection inside it; the history no longer applies. */
  external() {
    const value = this.host.value();
    if (value === this.emitted) return;
    this.emitted = null;
    this.undoStack = [];
    this.redoStack = [];
    this.lastKind = null;
    const n = this.chars.length;
    if (this.anchor > n || this.focus > n) {
      this.anchor = Math.min(this.anchor, n);
      this.focus = Math.min(this.focus, n);
    }
    this.host.changed();
  }

  /** Replaces the selection with `text` (typing, pasting); the caret ends after it. */
  insert(text: string, kind: EditKind = "type") {
    const [a, b] = this.range();
    const typed = Array.from(text);
    this.apply([...this.chars.slice(0, a), ...typed, ...this.chars.slice(b)], a + typed.length, kind);
  }

  /** Backspace (`forward` false) or Delete: the selection, or one character / word next to the caret. */
  delete(forward: boolean, word: boolean) {
    const cs = this.chars;
    let [a, b] = this.range();
    if (a === b) {
      if (forward) b = word ? this.wordEnd(a) : Math.min(cs.length, a + 1);
      else a = word ? this.wordStart(a) : Math.max(0, a - 1);
    }
    if (a === b) return;
    this.apply([...cs.slice(0, a), ...cs.slice(b)], a, "delete");
  }

  /** The start of the word before `i` (skipping spaces first), as Ctrl+Left goes. */
  wordStart(i: number): number {
    const cs = this.chars;
    while (i > 0 && !isWordChar(cs[i - 1])) i--;
    while (i > 0 && isWordChar(cs[i - 1])) i--;
    return i;
  }

  /** The end of the word after `i`, as Ctrl+Right goes. */
  wordEnd(i: number): number {
    const cs = this.chars;
    while (i < cs.length && !isWordChar(cs[i])) i++;
    while (i < cs.length && isWordChar(cs[i])) i++;
    return i;
  }

  /** Double click: the word (or run of spaces/punctuation) at character `i`. */
  selectWord(i: number) {
    const [a, b] = wordAt(this.chars, Math.min(i, Math.max(0, this.chars.length - 1)));
    this.select(a, b);
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  private snapshot(): Snapshot {
    return { value: this.host.value(), anchor: this.anchor, focus: this.focus };
  }

  private restore(s: Snapshot) {
    this.lastKind = null;
    this.emitted = s.value;
    this.host.setValue(s.value);
    this.anchor = s.anchor;
    this.focus = s.focus;
    this.host.changed();
  }

  private apply(next: string[], caret: number, kind: EditKind) {
    // A run of typing (or of deleting) undoes in one step; anything else starts a new one.
    if (kind === "other" || kind !== this.lastKind) {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > HISTORY) this.undoStack.shift();
    }
    this.redoStack = [];
    const value = next.join("");
    this.emitted = value;
    this.host.setValue(value);
    this.anchor = this.focus = caret;
    this.lastKind = kind;
    this.host.changed();
  }
}

/** How the caret moves across lines; a single-line field leaves these out. */
export interface LineNavigation {
  /** Start and end (before a newline) of the visual line holding position `i`. */
  lineBounds(i: number): [number, number];
  /** The position on the line above (`-1`) or below (`1`), `lines` lines away, keeping the caret's x. */
  vertical(i: number, dir: -1 | 1, lines: number): number;
  /** Lines in a page (PageUp/PageDown). */
  pageLines(): number;
}

export interface EditKeyOptions {
  /** Return inserts a newline (TextArea). */
  multiline?: boolean;
  /** Password: nothing is copied or cut, and words are the whole value. */
  secret?: boolean;
  lines?: LineNavigation;
  /** Return (single line) or Ctrl+Return (multiline). */
  onSubmit?: () => void;
  /** After a caret move by keyboard, so a vertical move keeps the x it started from. */
  keepColumn?: (vertical: boolean) => void;
}

/** Handles an editing key; false when it is not one (the key goes on to the parents). */
export function editKey(s: EditSession, e: KeyEvent, o: EditKeyOptions): boolean {
  const key = e.key;
  const n = s.chars.length;
  const [a, b] = s.range();
  const word = e.ctrl && !o.secret;
  const move = (to: number, vertical = false) => {
    s.moveTo(to, e.shift);
    o.keepColumn?.(vertical);
  };

  if (e.ctrl && !e.alt) {
    switch (key) {
      case "a":
        s.select(0, n);
        return true;
      case "c":
      case "Insert":
        if (a !== b && !o.secret) clipboard.writeText(s.selectedText());
        return true;
      case "x":
        if (a !== b && !o.secret) {
          clipboard.writeText(s.selectedText());
          s.delete(false, false);
        }
        return true;
      case "v":
        void paste(s, o.multiline);
        return true;
      case "z":
        if (e.shift) s.redo();
        else s.undo();
        return true;
      case "y":
        s.redo();
        return true;
    }
  }
  if (e.shift && key === "Insert") {
    void paste(s, o.multiline);
    return true;
  }
  if (e.shift && key === "Delete" && a !== b) {
    if (!o.secret) clipboard.writeText(s.selectedText());
    s.delete(true, false);
    return true;
  }

  switch (key) {
    case "BackSpace":
      s.delete(false, word);
      return true;
    case "Delete":
      s.delete(true, word);
      return true;
    case "Left":
      if (a !== b && !e.shift) move(a);
      else move(e.ctrl ? (o.secret ? 0 : s.wordStart(s.focus)) : Math.max(0, s.focus - 1));
      return true;
    case "Right":
      if (a !== b && !e.shift) move(b);
      else move(e.ctrl ? (o.secret ? n : s.wordEnd(s.focus)) : Math.min(n, s.focus + 1));
      return true;
    case "Home":
      move(e.ctrl || !o.lines ? 0 : o.lines.lineBounds(s.focus)[0]);
      return true;
    case "End":
      move(e.ctrl || !o.lines ? n : o.lines.lineBounds(s.focus)[1]);
      return true;
    case "Up":
    case "Down":
    case "Page_Up":
    case "Page_Down": {
      if (!o.lines) return false;
      const dir = key === "Up" || key === "Page_Up" ? -1 : 1;
      const count = key.startsWith("Page") ? o.lines.pageLines() : 1;
      move(o.lines.vertical(s.focus, dir, count), true);
      return true;
    }
    case "Return":
      if (o.multiline && !e.ctrl) s.insert("\n", "other");
      else o.onSubmit?.();
      return true;
  }
  if (e.text && !e.ctrl && !e.alt) {
    s.insert(e.text, e.text === " " ? "other" : "type");
    return true;
  }
  return false;
}

/** Pastes the clipboard over the selection (when it arrives: reading is asynchronous). */
async function paste(s: EditSession, multiline = false) {
  let text = await clipboard.readText();
  // One line: breaks and tabs become spaces. Both drop the other control characters.
  text = multiline ? text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "") : text.replace(/\r\n|[\r\n\t]/g, " ").replace(/[\x00-\x1f\x7f]/g, "");
  if (text) s.insert(text, "other");
}

/** The props TextField and TextArea share. */
export type EditableProps = StyleProps & Handlers & {
  value: Accessor<string>;
  onInput: (value: string) => void;
  placeholder?: MaybeAccessor<string>;
  disabled?: MaybeAccessor<boolean>;
  /** Border color while focused. Default: the theme's focus color, unless `borderColor` is given (then it stays). */
  focusBorderColor?: MaybeAccessor<Color>;
  /** Border width while focused. Default: 2, unless `borderWidth` is given (then it stays). */
  focusBorderWidth?: MaybeAccessor<number>;
  /** Moves the caret or selects (in code points) whenever it changes, e.g. to split a line at the caret. */
  selection?: Accessor<TextSelection>;
  /** The caret moved or the selection changed (by the user, an edit or `selection`). */
  onSelectionChange?: (selection: TextSelection) => void;
};

/**
 * What a text input is around its text: border, background and focus ring (the app's own
 * win), disabled state, the edit session over `value`/`onInput`, the `selection` prop and
 * `onSelectionChange`, and a caret that blinks while focused. `changed` runs after every
 * selection or value change (TextArea scrolls to the caret there).
 */
export function editable(node: UINode, props: EditableProps, changedToo?: (state: InteractionState) => void) {
  Object.assign(node.style, { padding: [9, 12], radius: theme.radius } satisfies Style);
  if (props.borderWidth === undefined) node.style.borderWidth = 1;
  if (props.borderColor === undefined) createEffect(() => node.set("borderColor", theme.field.border));
  if (props.background === undefined) createEffect(() => node.set("background", theme.field.background));
  applyProps(node, props);
  disableable(node, props, "text");
  const state: InteractionState = interaction(node);
  // The focus ring is an override on top of whatever the base border is.
  createEffect(() => {
    const focused = state.focused();
    const width = props.focusBorderWidth !== undefined ? read(props.focusBorderWidth) : props.borderWidth === undefined ? 2 : undefined;
    const color = props.focusBorderColor !== undefined ? read(props.focusBorderColor) : props.borderColor === undefined ? theme.field.focus : undefined;
    node.override("borderWidth", focused ? width : undefined);
    node.override("borderColor", focused ? color : undefined);
  });

  // Selection and value changes come on every key, outside signals: `version` makes paint run again.
  const [version, setVersion] = createSignal(0);
  const [blinkOn, setBlinkOn] = createSignal(true);
  let blink: ReturnType<typeof setInterval> | undefined;
  const restartBlink = () => {
    clearInterval(blink);
    setBlinkOn(true);
    if (untrack(state.focused)) blink = setInterval(() => setBlinkOn((v) => !v), 530);
  };
  createEffect(() => {
    state.focused();
    restartBlink();
  });
  onCleanup(() => clearInterval(blink));

  let reported = { anchor: -1, focus: -1 };
  const session = new EditSession({
    value: () => props.value(),
    setValue: (v) => props.onInput(v),
    changed: () => {
      setVersion((v) => v + 1);
      restartBlink();
      if (reported.anchor !== session.anchor || reported.focus !== session.focus) {
        reported = { anchor: session.anchor, focus: session.focus };
        props.onSelectionChange?.({ ...reported });
      }
      changedToo?.(state);
    },
  });
  // The caret starts at the end; a value the app sets keeps the selection inside it.
  session.anchor = session.focus = session.chars.length;
  createEffect(() => {
    props.value();
    untrack(() => session.external());
  });
  if (props.selection) {
    const selection = props.selection;
    createEffect(() => {
      const { anchor, focus } = selection();
      untrack(() => session.select(anchor, focus));
    });
  }
  return { state, session, blinkOn, version };
}
