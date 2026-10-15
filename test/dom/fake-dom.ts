// A minimal DOM for the DOM renderer's tests: elements with children, attributes, inline style
// (counting writes), classes, focus and listeners. Boxes come from `rect`, which a test sets: there
// is no CSS layout here (the browser is checked separately, in headless Chromium).

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

class FakeStyle {
  readonly props = new Map<string, string>();
  writes = 0;
  setProperty(key: string, value: string) {
    this.props.set(key, value);
    this.writes++;
  }
  removeProperty(key: string) {
    this.props.delete(key);
    this.writes++;
  }
  getPropertyValue(key: string) {
    return this.props.get(key) ?? "";
  }
}

/** A text node: what textContent and createTextNode make. */
export class FakeText {
  parentNode: FakeElement | null = null;
  readonly childNodes: never[] = [];
  readonly className = "";
  constructor(public data: string) {}
  get textContent() {
    return this.data;
  }
  get classList() {
    return { contains: () => false };
  }
  findAll(): FakeElement[] {
    return [];
  }
}

export class FakeElement {
  readonly style = new FakeStyle();
  readonly attributes = new Map<string, string>();
  childNodes: (FakeElement | FakeText)[] = [];
  parentNode: FakeElement | null = null;
  className = "";
  rect: Rect = { left: 0, top: 0, width: 0, height: 0 };
  scrollTop = 0;
  scrollLeft = 0;
  scrollWidth = 0;
  scrollHeight = 0;
  /** scrollTop/scrollLeft assignments made by the renderer. */
  scrollWrites = 0;
  tabIndex = 0;
  value = "";
  width = 0;
  height = 0;
  revealed = 0;
  private listeners = new Map<string, ((e: unknown) => void)[]>();

  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}

  get classList() {
    const list = () => new Set(this.className.split(" ").filter(Boolean));
    const save = (set: Set<string>) => (this.className = [...set].join(" "));
    return {
      add: (...names: string[]) => save(new Set([...list(), ...names])),
      remove: (...names: string[]) => save(new Set([...list()].filter((n) => !names.includes(n)))),
      toggle: (name: string, on?: boolean) => {
        const set = list();
        if (on ?? !set.has(name)) set.add(name);
        else set.delete(name);
        save(set);
      },
      contains: (name: string) => list().has(name),
    };
  }

  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(value: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (value) this.appendChild(new FakeText(value));
  }

  /** Child elements, without text nodes (the DOM's `children`). */
  get children(): FakeElement[] {
    return this.childNodes.filter((c): c is FakeElement => c instanceof FakeElement);
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  insertBefore<N extends FakeElement | FakeText>(node: N, ref: FakeElement | FakeText | null): N {
    node.parentNode?.removeChild(node);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(node);
    else this.childNodes.splice(i, 0, node);
    node.parentNode = this;
    this.ownerDocument.moves++;
    return node;
  }
  appendChild<N extends FakeElement | FakeText>(node: N): N {
    return this.insertBefore(node, null);
  }
  removeChild<N extends FakeElement | FakeText>(node: N): N {
    this.childNodes = this.childNodes.filter((c) => c !== node);
    node.parentNode = null;
    return node;
  }
  contains(node: FakeElement | FakeText | null): boolean {
    for (let n: FakeElement | FakeText | null = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  removeAttribute(key: string) {
    this.attributes.delete(key);
  }
  getAttribute(key: string) {
    return this.attributes.get(key) ?? null;
  }

  getBoundingClientRect() {
    const r = this.rect;
    return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height };
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }
  scrollIntoView() {
    this.revealed++;
  }

  addEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  dispatch(type: string, event: unknown = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  /** Child elements with this class (depth first). */
  findAll(cls: string, out: FakeElement[] = []): FakeElement[] {
    for (const c of this.childNodes) {
      if (!(c instanceof FakeElement)) continue;
      if (c.classList.contains(cls)) out.push(c);
      c.findAll(cls, out);
    }
    return out;
  }
}

export class FakeDocument {
  created = 0;
  moves = 0;
  readonly body: FakeElement;
  activeElement: FakeElement | null;
  constructor() {
    this.body = new FakeElement("body", this);
    this.activeElement = this.body;
  }
  /** What elementFromPoint returns (a test sets it), and the points asked. */
  hit: FakeElement | null = null;
  pointsAsked: string[] = [];
  elementFromPoint(x: number, y: number) {
    this.pointsAsked.push(`${x},${y}`);
    return this.hit;
  }
  createTextNode(data: string) {
    return new FakeText(data);
  }
  createElement(tag: string) {
    this.created++;
    return new FakeElement(tag, this);
  }
}

/** A container (the page's root element) in a fresh document, typed as the DOM's for the renderer. */
export function fakeContainer(rect: Rect = { left: 0, top: 0, width: 400, height: 300 }) {
  const doc = new FakeDocument();
  const container = doc.createElement("div");
  container.rect = rect;
  doc.body.appendChild(container);
  return { doc, container, el: container as unknown as HTMLElement };
}
