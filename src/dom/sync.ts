// The DOM renderer: one element per UINode, styled with CSS (style.ts), laid out by the
// browser. Each frame writes what changed (CSS diffed per element, children moved instead of
// recreated). A node's box (x, y, width, height, scroll and content sizes) becomes a getter that
// asks its element, once per frame and only when something reads it (input, overlays, refs,
// onResize, custom painters), so a long list costs nothing to read back.
//
// Nodes that draw themselves on the desktop get an adapter: <Text> is DOM text, text fields are
// <input>/<textarea>; any other node with `paint` draws into a <canvas> through the Canvas2D
// painter, and one with `measure` gets a hidden sizer that gives the box its measured size.

import { anchorBox, edges, layerPosition, rootOf } from "../render/layout.js";
import { type FontStyle, type Painter, type Size, type UINode, measureText, metricsGeneration, overlayLayers, revealRequests, scrolls } from "../render/node.js";
import { batch } from "../reactive/signals.js";
import { theme } from "../theme.js";
import { inherited, inheritedText } from "../widgets/props.js";
import { cssColor, cssFeatures, cssVariations, nodeCss, UI_FONT } from "./style.js";

type Css = Record<string, string>;

/** A Painter that draws into one canvas at a time, in window coordinates. */
export interface CanvasPainter extends Painter {
  /** Starts a canvas whose top-left corner is (x, y) in the window, at `scale` device px per px. */
  begin(canvas: HTMLCanvasElement, x: number, y: number, scale: number): void;
}

export interface DomRendererOptions {
  /** Draws the canvases of painted nodes (the Canvas2D painter). */
  painter: CanvasPainter;
  /** Device px per CSS px (devicePixelRatio). */
  scale(): number;
}

/** The stylesheet every renderer's page needs once (classes used below). */
export const BASE_CSS = `
.nb { box-sizing: border-box; position: relative; display: flex; flex-direction: column; isolation: isolate; margin: 0; padding: 0; border: 0; outline: none; scrollbar-width: thin; }
.nb-root { position: absolute; inset: 0; overflow: hidden; user-select: none; -webkit-user-select: none; font-family: ${UI_FONT}; line-height: normal; -webkit-tap-highlight-color: transparent; }
.nb-text { display: block; white-space: pre-wrap; overflow-wrap: normal; }
.nb-selectable { user-select: text; -webkit-user-select: text; }
.nb-sizer { flex: none; visibility: hidden; pointer-events: none; }
.nb-canvas { position: absolute; pointer-events: none; }
.nb-pass > * { pointer-events: auto; }
.nb-input { all: unset; position: absolute; box-sizing: border-box; font: inherit; color: inherit; letter-spacing: inherit; font-feature-settings: inherit; font-variation-settings: inherit; line-height: inherit; white-space: pre; }
textarea.nb-input { white-space: pre-wrap; overflow-wrap: normal; resize: none; overflow: auto; }
.nb-input::placeholder { color: var(--nb-placeholder); opacity: 1; }
.nb-root ::selection { background: var(--nb-selection); }
`;

type Kind = "box" | "text" | "field";

interface Entry {
  el: HTMLElement;
  kind: Kind;
  css: Css;
  attrs: Record<string, string>;
  /** Nodes of its own before the children's: the text, the <input>, the sizer, the canvas. */
  content: Node[];
  /** Its DOM children as last written: content, then the children's elements. */
  children: Node[];
  textNode?: Text;
  /** What was last written: the text, whether it is selectable, its line height and the font it came from. */
  text?: string;
  selectable?: boolean;
  line?: { size: number; face: FontStyle; factor: number; generation: number; px: string };
  input?: HTMLInputElement | HTMLTextAreaElement;
  /** The field value last written to or read from the <input>. */
  value?: string;
  sizer?: HTMLElement;
  sizerCss: Css;
  inputCss: Css;
  canvas?: HTMLCanvasElement;
  canvasCss: Css;
  /** The box as read in frame `stamp` (window coordinates). */
  box: Box;
  stamp: number;
  /** A scroll position the app set (scrollTo, keys), written with the next frame. */
  pendingX?: number;
  pendingY?: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A node's role and states as ARIA attributes. */
function ariaAttrs(node: UINode, out: Record<string, string>) {
  out.role = node.role!;
  if (node.disabled) out["aria-disabled"] = "true";
  const s = node.states?.();
  if (!s) return;
  if (s.checked !== undefined) out["aria-checked"] = String(s.checked);
  if (s.selected !== undefined) out["aria-selected"] = String(s.selected);
  if (s.expanded !== undefined) out["aria-expanded"] = String(s.expanded);
  if (s.modal) out["aria-modal"] = "true";
  if (s.value !== undefined) out["aria-valuenow"] = String(s.value);
  if (s.min !== undefined) out["aria-valuemin"] = String(s.min);
  if (s.max !== undefined) out["aria-valuemax"] = String(s.max);
}

/** How far a painted node may draw outside its box (focus rings, thumbs, shadows) and still show. */
const PAINT_MARGIN = 8;

export function createDomRenderer(container: HTMLElement, options: DomRendererOptions) {
  const doc = container.ownerDocument;
  const entries = new WeakMap<UINode, Entry>();
  /** Bumped after each frame's writes: boxes read before are stale. */
  let stamp = 0;
  let origin = { stamp: -1, left: 0, top: 0 };
  const boxOf = (e: Entry): Box => {
    if (e.stamp === stamp) return e.box;
    if (origin.stamp !== stamp) {
      const r = container.getBoundingClientRect();
      origin = { stamp, left: r.left, top: r.top };
    }
    const r = e.el.getBoundingClientRect();
    e.box = { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height };
    e.stamp = stamp;
    return e.box;
  };
  const owners = new WeakMap<Node, UINode>();
  let painted: UINode[] = [];
  let measured: UINode[] = [];
  let resized: UINode[] = [];

  function entryOf(node: UINode): Entry {
    let e = entries.get(node);
    if (e) return e;
    const kind: Kind = node.field ? "field" : node.text ? "text" : "box";
    const el = doc.createElement("div");
    el.className = kind === "text" ? "nb nb-text" : "nb";
    e = { el, kind, css: {}, attrs: {}, content: [], children: [], sizerCss: {}, inputCss: {}, canvasCss: {}, box: { x: 0, y: 0, width: 0, height: 0 }, stamp: -1 };
    if (kind === "text") {
      e.textNode = doc.createTextNode("");
      e.content.push(e.textNode);
    }
    if (kind === "field") {
      const field = node.field!;
      const input = doc.createElement(field.multiline ? "textarea" : "input");
      input.className = "nb-input";
      input.tabIndex = -1;
      input.addEventListener("input", () => {
        entry.value = input.value;
        field.input?.(input.value);
      });
      e.input = input;
      e.content.push(input);
      owners.set(input, node);
    }
    const entry = e;
    entries.set(node, e);
    owners.set(el, node);
    // The layout results of the node, from the browser's layout (writes from elsewhere are ignored).
    const ignore = () => {};
    Object.defineProperties(node, {
      x: { get: () => boxOf(entry).x, set: ignore, configurable: true },
      y: { get: () => boxOf(entry).y, set: ignore, configurable: true },
      width: { get: () => boxOf(entry).width, set: ignore, configurable: true },
      height: { get: () => boxOf(entry).height, set: ignore, configurable: true },
      contentWidth: { get: () => (scrolls(node) ? el.scrollWidth : boxOf(entry).width), set: ignore, configurable: true },
      contentHeight: { get: () => (scrolls(node) ? el.scrollHeight : boxOf(entry).height), set: ignore, configurable: true },
      scrollX: { get: () => entry.pendingX ?? el.scrollLeft, set: (v: number) => (entry.pendingX = v), configurable: true },
      scrollY: { get: () => entry.pendingY ?? el.scrollTop, set: (v: number) => (entry.pendingY = v), configurable: true },
      culled: { get: () => false, set: ignore, configurable: true },
    });
    return e;
  }

  function writeCss(el: HTMLElement, old: Css, next: Css) {
    for (const key in next) if (old[key] !== next[key]) el.style.setProperty(key, next[key]!);
    for (const key in old) if (!(key in next)) el.style.removeProperty(key);
  }

  function writeAttrs(e: Entry, next: Record<string, string>) {
    const target = e.input ?? e.el;
    for (const key in next) if (e.attrs[key] !== next[key]) target.setAttribute(key, next[key]!);
    for (const key in e.attrs) if (!(key in next)) target.removeAttribute(key);
    e.attrs = next;
  }

  /** Puts `want` as the element's children, touching the DOM only when they differ from the last ones. */
  function reconcile(e: Entry, want: Node[]) {
    const had = e.children;
    if (had.length === want.length && had.every((n, i) => n === want[i])) return;
    const parent = e.el;
    for (let i = 0; i < want.length; i++) {
      const at = parent.childNodes[i];
      if (at !== want[i]) parent.insertBefore(want[i]!, at ?? null);
    }
    while (parent.childNodes.length > want.length) parent.removeChild(parent.lastChild!);
    e.children = want;
  }

  /**
   * Line height of a Text or field in px: the font's (ascent + descent) times `factor`, as text.ts
   * lays it out; measured again only when the font or the metrics change.
   */
  function lineHeightOf(node: UINode, e: Entry, factor: number): string {
    const { size: own, face } = inheritedText(node, e.line?.face);
    const size = own ?? theme.font.size;
    const line = e.line;
    if (line && line.size === size && line.face === face && line.factor === factor && line.generation === metricsGeneration()) return line.px;
    const m = measureText("Ag", size, face);
    const px = `${Math.ceil(Math.ceil(m.ascent + m.descent) * factor)}px`;
    e.line = { size, face, factor, generation: metricsGeneration(), px };
    return px;
  }

  function textCss(node: UINode, e: Entry, out: Css) {
    const t = node.text!();
    out["line-height"] = lineHeightOf(node, e, t.lineHeight);
    if (t.align !== "start") out["text-align"] = t.align === "center" ? "center" : "end";
    if (t.maxLines === 1) Object.assign(out, { "white-space": "pre", overflow: "hidden", "text-overflow": "ellipsis" });
    else if (t.maxLines !== undefined) {
      Object.assign(out, { display: "-webkit-box", "-webkit-box-orient": "vertical", "-webkit-line-clamp": String(t.maxLines), overflow: "hidden" });
    } else if (!t.wrap) out["white-space"] = "pre";
    return t;
  }

  /** Text style a layer would inherit where its <Overlay> is declared: it lives in the root instead. */
  function inheritedCss(layer: UINode, out: Css) {
    const from = layer.parent;
    if (!from) return;
    const { size, face } = inheritedText(from);
    const color = inherited(from, "color");
    const underline = inherited(from, "underline");
    if (color !== undefined) out.color ??= cssColor(color);
    if (size !== undefined) out["font-size"] ??= `${size}px`;
    if (face.weight !== 400) out["font-weight"] ??= String(face.weight);
    if (face.italic) out["font-style"] ??= "italic";
    if (face.letterSpacing) out["letter-spacing"] ??= `${face.letterSpacing}px`;
    if (face.family) out["font-family"] ??= `${face.family}, ${UI_FONT}`;
    if (face.features) out["font-feature-settings"] ??= cssFeatures(face.features);
    if (face.variations) out["font-variation-settings"] ??= cssVariations(face.variations);
    if (underline) out["text-decoration"] ??= "underline";
  }

  function layerCss(layer: UINode, out: Css, width: number, height: number) {
    const o = layer.overlay!;
    inheritedCss(layer, out);
    out.position = "absolute";
    if ((!o.anchor && !o.at) || o.modal) {
      const [t, r, b, l] = edges(o.inset);
      Object.assign(out, { left: `${l}px`, top: `${t}px`, right: `${r}px`, bottom: `${b}px` });
      // Covering the window, the pointer goes through its empty space to what is below.
      if (!o.modal) out["pointer-events"] = "none";
      return;
    }
    // Anchored: its own natural size (or the anchor's width), placed after the boxes are read.
    const a = anchorBox(layer);
    out.width = o.matchWidth && a ? `${a.width}px` : "max-content";
    out["max-width"] ??= `${width}px`;
    out["max-height"] ??= `${height}px`;
    const e = entries.get(layer);
    out.left = `${e?.box.x ?? 0}px`;
    out.top = `${e?.box.y ?? 0}px`;
    if (!a) out.visibility = "hidden";
  }

  /** Writes `node` and its subtree; returns its element. */
  /**
   * Writes `node` and its subtree; returns its element and whether something inside scrolls or
   * clips (the native layout does not count that content toward the minimum size of its containers).
   */
  function write(node: UINode, root: UINode, siblingGrows = false): { el: HTMLElement; gives: boolean } {
    const e = entryOf(node);
    const kids: Node[] = [];
    const grows = node.children.some((c) => c.style.grow);
    let gives = false;
    for (const child of node.children) {
      const w = write(child, root, grows);
      kids.push(w.el);
      gives ||= w.gives || scrolls(child) || !!child.style.clip;
    }

    const css = nodeCss(node, siblingGrows);
    const parent = node.parent;
    if (gives && parent && !node.overlay && parent.style.direction !== "grid") {
      if (parent.style.direction === "row") css["min-width"] ??= "0px";
      else css["min-height"] ??= "0px";
    }
    const attrs: Record<string, string> = {};
    if (e.kind === "text") {
      const t = textCss(node, e, css);
      if (t.value !== e.text) e.textNode!.data = e.text = t.value;
      if (t.selectable !== e.selectable) e.el.classList.toggle("nb-selectable", (e.selectable = t.selectable));
    } else if (e.kind === "field") {
      const field = node.field!;
      const input = e.input!;
      const value = field.value();
      if (value !== e.value) input.value = e.value = value;
      const placeholder = field.placeholder();
      if (placeholder !== undefined) attrs.placeholder = placeholder;
      if (!field.multiline) attrs.type = field.secret?.() ? "password" : "text";
      if (!node.focusable) attrs.disabled = "";
    }
    if (node.overlay) {
      layerCss(node, css, root.width, root.height);
      e.el.classList.toggle("nb-pass", css["pointer-events"] === "none");
    }
    if (node.focusable) attrs.tabindex = "-1";
    if (node.ariaLabel !== undefined) attrs["aria-label"] = node.ariaLabel;
    if (node.role) ariaAttrs(node, attrs);
    writeCss(e.el, e.css, css);
    e.css = css;
    writeAttrs(e, attrs);

    if (e.kind !== "text" && node.measure) {
      e.sizer ??= Object.assign(doc.createElement("div"), { className: "nb-sizer" });
      measured.push(node);
      // The width of the last frame: reading it now would lay out the page in the middle of the writes.
      writeSizer(node, e, e.box.width);
    }
    if (e.kind === "box" && node.paint) {
      e.canvas ??= Object.assign(doc.createElement("canvas"), { className: "nb-canvas" });
      painted.push(node);
    }
    if (e.kind === "field") {
      // Over the content box the sizer gives the field (its measured size, as on the desktop).
      const [t, r, b, l] = edges(node.style.padding);
      const inset: Css = { left: `${l}px`, top: `${t}px`, right: `${r}px`, bottom: `${b}px`, "line-height": lineHeightOf(node, e, 1) };
      writeCss(e.input!, e.inputCss, inset);
      e.inputCss = inset;
    }
    if (e.kind !== "text") e.content = [e.canvas, e.input, e.sizer].filter((c): c is HTMLElement => !!c);
    if (e.pendingY !== undefined) e.el.scrollTop = e.pendingY;
    if (e.pendingX !== undefined) e.el.scrollLeft = e.pendingX;
    e.pendingX = e.pendingY = undefined;
    if (node.handlers.onResize) resized.push(node);
    reconcile(e, e.content.length ? [...e.content, ...kids] : kids);
    return { el: e.el, gives };
  }

  /** The sizer's size: the measured one, at the width the box had (text that wraps gets taller when narrower). */
  function writeSizer(node: UINode, e: Entry, width: number) {
    const [, pr, , pl] = edges(node.style.padding);
    const wraps = !!node.minContentWidth;
    const inner = wraps && width > 0 ? Math.max(0, width - pl - pr) : Infinity;
    const natural = node.measure!(Infinity);
    const height = inner === Infinity ? natural.height : node.measure!(inner).height;
    // With an aspect ratio the height follows the width, as the native layout does with measured nodes.
    const css: Css = node.style.aspectRatio ? {} : { height: `${height}px` };
    if (Number.isFinite(natural.width)) css.width = `${natural.width}px`;
    if (wraps) {
      // It may narrow down to its narrowest content, like CSS text.
      css["max-width"] = "100%";
      if (node.style.minWidth === undefined) {
        const min = `${node.minContentWidth!() + pl + pr}px`;
        if (e.css["min-width"] !== min) e.el.style.setProperty("min-width", min);
        e.css["min-width"] = min;
      }
    }
    writeCss(e.sizer!, e.sizerCss, css);
    e.sizerCss = css;
  }

  /** Anchored layers next to their anchors, now that the boxes are known; true if any moved. */
  function placeLayers(root: UINode): boolean {
    let moved = false;
    for (const layer of root.layers) {
      const o = layer.overlay!;
      if ((!o.anchor && !o.at) || o.modal) continue;
      const a = anchorBox(layer);
      const e = entries.get(layer)!;
      if (!a) continue;
      const set = (key: string, value: string) => {
        if (e.css[key] === value) return;
        e.el.style.setProperty(key, value);
        e.css[key] = value;
        moved = true;
      };
      if (o.matchWidth) set("width", `${a.width}px`);
      if (e.css.visibility) {
        e.el.style.removeProperty("visibility");
        delete e.css.visibility;
        moved = true;
      }
      if (moved) stamp++; // its size at the anchor's width
      const { x, y } = layerPosition(o, a, layer.width, layer.height, root.width, root.height);
      set("left", `${x}px`);
      set("top", `${y}px`);
    }
    return moved;
  }

  function paintCanvases() {
    const scale = options.scale();
    for (const node of painted) {
      const e = entries.get(node)!;
      const canvas = e.canvas!;
      const m = PAINT_MARGIN;
      const w = Math.max(0, node.width + 2 * m), h = Math.max(0, node.height + 2 * m);
      const css: Css = { left: `${-m}px`, top: `${-m}px`, width: `${w}px`, height: `${h}px` };
      writeCss(canvas, e.canvasCss, css);
      e.canvasCss = css;
      const bw = Math.ceil(w * scale), bh = Math.ceil(h * scale);
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      options.painter.begin(canvas, node.x - m, node.y - m, scale);
      options.painter.opacity = 1;
      node.paint!(options.painter, node);
    }
  }

  function reportSizes() {
    const changed = resized.filter((n) => n.reportedSize?.width !== n.width || n.reportedSize?.height !== n.height);
    if (!changed.length) return;
    for (const n of changed) n.reportedSize = { width: n.width, height: n.height } satisfies Size;
    batch(() => changed.forEach((n) => n.handlers.onResize?.(n.reportedSize!)));
  }

  function syncFocus(root: UINode) {
    const focused = root.focusHost?.focused ?? null;
    const active = doc.activeElement;
    if (focused) {
      const e = entries.get(focused);
      const target = e?.input ?? e?.el;
      if (target && active !== target) target.focus({ preventScroll: true });
    } else if (active && active !== container && container.contains(active)) {
      (active as HTMLElement).blur();
    }
  }

  function rootVars() {
    const vars: Css = {
      color: cssColor(theme.text.primary),
      "font-size": `${theme.font.size}px`,
      "--nb-placeholder": cssColor(theme.field.placeholder),
      "--nb-selection": cssColor(theme.selection),
    };
    const e = rootEntry;
    writeCss(container, e.css, vars);
    e.css = vars;
  }
  const rootEntry: Entry = { el: container, kind: "box", css: {}, attrs: {}, content: [], children: [], sizerCss: {}, inputCss: {}, canvasCss: {}, box: { x: 0, y: 0, width: 0, height: 0 }, stamp: -1 };
  container.classList.add("nb", "nb-root");

  return {
    /** Writes the tree, reads its boxes back, places the overlays and paints the canvases. */
    render(root: UINode) {
      owners.set(container, root);
      entries.set(root, rootEntry);
      painted = [];
      measured = [];
      resized = [];
      root.layers = [...overlayLayers].filter((l) => rootOf(l) === root);
      rootVars();
      const grows = root.children.some((c) => c.style.grow);
      const want: Node[] = root.children.map((c) => write(c, root, grows).el);
      for (const layer of root.layers) want.push(write(layer, root).el);
      reconcile(rootEntry, want);
      for (const [node] of revealRequests) {
        if (rootOf(node) !== root) continue;
        revealRequests.delete(node);
        entries.get(node)?.el.scrollIntoView({ block: "nearest", inline: "nearest" });
      }

      stamp++;
      const box = container.getBoundingClientRect();
      Object.assign(root, { x: 0, y: 0, width: box.width, height: box.height, contentWidth: box.width, contentHeight: box.height });
      if (placeLayers(root)) stamp++;

      // Text that wraps inside a measured node is taller when narrower: size it at the width it got.
      let remeasured = false;
      for (const node of measured) {
        if (!node.minContentWidth) continue;
        const e = entries.get(node)!;
        const before = e.sizerCss.height;
        writeSizer(node, e, boxOf(e).width);
        remeasured ||= e.sizerCss.height !== before;
      }
      if (remeasured) stamp++;

      paintCanvases();
      syncFocus(root);
      reportSizes();
    },
    /** The node under a window point: the element there, as the browser hit-tests it. */
    hitTest(x: number, y: number): UINode | null {
      const box = container.getBoundingClientRect();
      return this.nodeAt(doc.elementFromPoint(x + box.left, y + box.top));
    },
    /** The node an element (an event target) belongs to: the nearest one up its parents. */
    nodeAt(target: Node | null): UINode | null {
      for (let n = target; n; n = n.parentNode) {
        const node = owners.get(n);
        if (node) return node;
      }
      return null;
    },
    elementOf: (node: UINode): HTMLElement | undefined => entries.get(node)?.el,
    /** The <input>/<textarea> of a text field's node. */
    inputOf: (node: UINode) => entries.get(node)?.input,
  };
}

export type DomRenderer = ReturnType<typeof createDomRenderer>;
