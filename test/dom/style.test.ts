// Style -> CSS for the DOM renderer: one case per Style key, written as the declarations
// the element gets (only what differs from the base stylesheet's defaults).
import { describe, expect, test } from "bun:test";
import { UINode } from "../../src/render/node.js";
import type { Style } from "../../src/render/node.js";
import { STYLE_KEYS } from "../../src/widgets/props.js";
import { CSS_KEYS, cssFeatures, cssVariations, nodeCss } from "../../src/dom/style.js";

function node(style: Style, setup?: (n: UINode) => void) {
  const n = new UINode();
  Object.assign(n.style, style);
  setup?.(n);
  return n;
}
const css = (style: Style, setup?: (n: UINode) => void) => nodeCss(node(style, setup));

/** `child` inside a parent with `parent`'s style. */
function inParent(parent: Style, child: Style, setup?: (p: UINode) => void) {
  const p = node(parent, setup);
  const c = node(child);
  p.setSlot(p.addSlot(), [c]);
  return nodeCss(c);
}

test("every Style key has a CSS mapping", () => {
  expect([...CSS_KEYS].sort()).toEqual([...STYLE_KEYS].sort());
});

test("an empty style writes nothing: the base stylesheet is a column flexbox", () => {
  expect(css({})).toEqual({});
});

describe("layout", () => {
  test("direction", () => {
    expect(css({ direction: "row" })).toEqual({ "flex-direction": "row" });
    expect(css({ direction: "column" })).toEqual({});
  });

  test("gap is along the main axis; rowGap between wrapped lines (default: gap)", () => {
    expect(css({ gap: 8 })).toEqual({ gap: "8px" });
    expect(css({ direction: "row", gap: 8, wrap: true, rowGap: 4 })).toMatchObject({ "column-gap": "8px", "row-gap": "4px" });
    // A wrapping column's lines sit side by side.
    expect(css({ direction: "column", gap: 8, wrap: true, rowGap: 4 })).toMatchObject({ "row-gap": "8px", "column-gap": "4px" });
  });

  test("wrap packs the lines at the start", () => {
    expect(css({ direction: "row", wrap: true })).toEqual({ "flex-direction": "row", "flex-wrap": "wrap", "align-content": "flex-start" });
  });

  test("grid: equal columns, auto-fill with a minimum width, both", () => {
    expect(css({ direction: "grid", columns: 3, gap: 10 })).toEqual({
      display: "grid", "grid-template-columns": "repeat(3, minmax(0, 1fr))", gap: "10px",
    });
    expect(css({ direction: "grid", minColumnWidth: 120 })["grid-template-columns"]).toBe("repeat(auto-fill, minmax(min(100%, 120px), 1fr))");
    // At most `columns`: a cell is never narrower than an n-th of the row.
    expect(css({ direction: "grid", minColumnWidth: 120, columns: 4, gap: 8 })["grid-template-columns"]).toBe(
      "repeat(auto-fill, minmax(min(100%, max(120px, calc((100% - 24px) / 4))), 1fr))",
    );
    expect(css({ direction: "grid", columns: 2, gap: 8, rowGap: 2 })).toMatchObject({ "row-gap": "2px", "column-gap": "8px" });
  });

  test("padding and margin in CSS order", () => {
    expect(css({ padding: 4 })).toEqual({ padding: "4px" });
    expect(css({ padding: [4, 8] })).toEqual({ padding: "4px 8px" });
    expect(css({ margin: [1, 2, 3, 4] })).toEqual({ margin: "1px 2px 3px 4px" });
  });

  test("sizes in px, or the percentage the app gave", () => {
    expect(css({ width: 100, height: 50, minWidth: 10, minHeight: 0, maxWidth: 300, maxHeight: 200 })).toEqual({
      width: "100px", height: "50px", "min-width": "10px", "min-height": "0px", "max-width": "300px", "max-height": "200px",
    });
    expect(css({}, (n) => n.setPercent("width", 50))).toEqual({ width: "50%" });
  });

  test("grow", () => {
    expect(css({ grow: 1 })).toEqual({ "flex-grow": "1" });
  });

  test("align, alignSelf and justify", () => {
    expect(css({ align: "center", justify: "space-between" })).toEqual({ "align-items": "center", "justify-content": "space-between" });
    expect(css({ align: "start", justify: "end" })).toEqual({ "align-items": "flex-start", "justify-content": "flex-end" });
    expect(css({ alignSelf: "end" })).toEqual({ "align-self": "flex-end" });
    expect(css({ align: "stretch" })).toEqual({});
  });

  test("aspectRatio", () => {
    expect(css({ aspectRatio: 16 / 9 })).toEqual({ "aspect-ratio": String(16 / 9) });
  });

  test("absolute position from the padding box", () => {
    expect(css({ position: "absolute", left: 0, top: 4, right: 8, bottom: 2 })).toEqual({
      position: "absolute", left: "0px", top: "4px", right: "8px", bottom: "2px",
    });
    expect(css({ position: "flow", left: 4 })).toEqual({});
  });

  test("zIndex orders siblings", () => {
    expect(css({ zIndex: 2 })).toEqual({ "z-index": "2" });
  });

  test("clip hides what sticks out", () => {
    expect(css({ clip: true })).toEqual({ overflow: "hidden" });
  });

  test("a Scroll scrolls on its axes and does not shrink its children along them", () => {
    expect(css({}, (n) => (n.scrollable = true))).toEqual({ "overflow-x": "hidden", "overflow-y": "auto" });
    expect(css({ direction: "row" }, (n) => (n.scrollableX = true))).toEqual({ "flex-direction": "row", "overflow-x": "auto", "overflow-y": "hidden" });
    expect(inParent({}, {}, (p) => (p.scrollable = true))).toEqual({ "flex-shrink": "0" });
    expect(inParent({ direction: "row" }, {}, (p) => (p.scrollableX = true))).toEqual({ "flex-shrink": "0" });
    // Both ways (a column): a child is never narrower than its content, so it scrolls sideways.
    expect(inParent({}, {}, (p) => (p.scrollable = p.scrollableX = true))).toEqual({ "flex-shrink": "0", "min-width": "max-content" });
  });

  test("like the native layout, a fixed size along the parent's axis does not shrink", () => {
    expect(inParent({ direction: "row" }, { width: 250 })).toEqual({ width: "250px", "flex-shrink": "0" });
    expect(inParent({}, { height: 40 })).toEqual({ height: "40px", "flex-shrink": "0" });
    expect(inParent({}, { width: 250 })).toEqual({ width: "250px" }); // across a column it may
  });

  test("next to a child that grows, the others keep their size (the growing one gives up room first)", () => {
    const p = node({ direction: "row" });
    const label = node({}), fill = node({ grow: 1 });
    p.setSlot(p.addSlot(), [fill, label]);
    expect(nodeCss(label)).toEqual({ "flex-shrink": "0" });
    expect(nodeCss(fill)).toEqual({ "flex-grow": "1" });
  });

  test("a Scroll that grows along the axis it scrolls takes its room, not its content's (no measuring a long list)", () => {
    const list = (p: UINode) => p.children[0]!;
    const column = node({});
    const scroll = node({ grow: 1 }, (n) => (n.scrollable = true));
    column.setSlot(column.addSlot(), [scroll]);
    expect(nodeCss(list(column))).toMatchObject({ "flex-grow": "1", "flex-basis": "0px" });
    // Across the parent's axis, or without grow, its content still sizes it.
    const row = node({ direction: "row" });
    const across = node({ grow: 1 }, (n) => (n.scrollable = true));
    row.setSlot(row.addSlot(), [across]);
    expect(nodeCss(list(row))["flex-basis"]).toBeUndefined();
    expect(inParent({}, {}, (p) => (p.scrollable = true))["flex-basis"]).toBeUndefined();
  });

  test("translate", () => {
    expect(css({ translateX: 4 })).toEqual({ transform: "translate(4px, 0px)" });
    expect(css({ translateX: 4, translateY: -2 })).toEqual({ transform: "translate(4px, -2px)" });
  });
});

describe("paint", () => {
  test("background: colors, token names, linear gradients", () => {
    expect(css({ background: "#ff0000" })).toEqual({ background: "#ff0000" });
    expect(css({ background: "oklch(0.7 0.2 30)" })).toEqual({ background: "oklch(0.7 0.2 30)" });
    expect(css({ background: "accent.base" }).background).toMatch(/^#/);
    expect(css({ background: { linear: ["#000", ["#fff", 0.25]], angle: 90 } })).toEqual({ background: "linear-gradient(90deg, #000 0%, #fff 25%)" });
    expect(css({ background: { linear: ["#000", "#fff"] } })).toEqual({ background: "linear-gradient(180deg, #000 0%, #fff 100%)" });
  });

  test("radius: one, or one per corner", () => {
    expect(css({ radius: 8 })).toEqual({ "border-radius": "8px" });
    expect(css({ radius: [0, 12, 12, 0] })).toEqual({ "border-radius": "0px 12px 12px 0px" });
  });

  test("the border is drawn inside the box without taking room, as in the native renderer", () => {
    expect(css({ borderWidth: 2, borderColor: "#123456" })).toEqual({ "box-shadow": "inset 0 0 0 2px #123456" });
    expect(css({ borderWidth: 0, borderColor: "#123456" })).toEqual({});
  });

  test("shadow, under the border", () => {
    expect(css({ shadow: { color: "#0004", blur: 12, y: 4 } })).toEqual({ "box-shadow": "0 4px 12px #0004" });
    expect(css({ shadow: { color: "#0004", blur: 12 }, borderWidth: 1, borderColor: "#ccc" })).toEqual({
      "box-shadow": "inset 0 0 0 1px #ccc, 0 0px 12px #0004",
    });
  });

  test("opacity", () => {
    expect(css({ opacity: 0.5 })).toEqual({ opacity: "0.5" });
    expect(css({ opacity: 1 })).toEqual({});
  });

  test("cursor is the input system's, not CSS", () => {
    expect(css({ cursor: "pointer" })).toEqual({});
  });
});

describe("text (inherited by CSS itself)", () => {
  test("color, size, weight, italic, spacing", () => {
    expect(css({ color: "#333", fontSize: 18, italic: true, letterSpacing: 0.5 })).toEqual({
      color: "#333", "font-size": "18px", "font-style": "italic", "letter-spacing": "0.5px",
    });
  });

  test("bold is 700 or 400; fontWeight on the same node wins", () => {
    expect(css({ bold: true })).toEqual({ "font-weight": "700" });
    expect(css({ bold: false })).toEqual({ "font-weight": "400" });
    expect(css({ bold: true, fontWeight: 300 })).toEqual({ "font-weight": "300" });
  });

  test("a family list falls back to the UI font, not the browser's serif", () => {
    expect(css({ fontFamily: "Inter, 'Noto Sans'" })).toEqual({ "font-family": "Inter, 'Noto Sans', system-ui, sans-serif" });
  });

  test("underline", () => {
    expect(css({ underline: true })).toEqual({ "text-decoration": "underline" });
    expect(css({ underline: false })).toEqual({ "text-decoration": "none" });
  });

  test("features and variations, from HarfBuzz syntax to CSS", () => {
    expect(cssFeatures("tnum, ss01, -liga")).toBe('"tnum", "ss01", "liga" 0');
    expect(cssFeatures("+kern, cv01=2")).toBe('"kern", "cv01" 2');
    expect(cssFeatures('"liga" 0')).toBe('"liga" 0');
    expect(cssVariations("wdth 75, opsz=12")).toBe('"wdth" 75, "opsz" 12');
    expect(css({ fontFeatures: "tnum", fontVariations: "wght 600" })).toEqual({
      "font-feature-settings": '"tnum"', "font-variation-settings": '"wght" 600',
    });
  });
});
