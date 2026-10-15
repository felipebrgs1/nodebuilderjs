import { describe, expect, test } from "bun:test";
import { keyEvent } from "../../src/web/keys.js";

const ev = (key: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; repeat: boolean }> = {}) => ({
  key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false, ...mods,
});

describe("DOM keys -> the names the native core sends", () => {
  test("named keys take their xkb names", () => {
    const names = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Backspace", "PageUp", "PageDown", " ", "ContextMenu", "Escape", "Tab", "Home", "End", "Delete", "F5"]
      .map((k) => keyEvent("keydown", ev(k)).key);
    expect(names).toEqual(["Up", "Down", "Left", "Right", "Return", "BackSpace", "Page_Up", "Page_Down", "space", "Menu", "Escape", "Tab", "Home", "End", "Delete", "F5"]);
  });

  test("printable keys carry their text; shortcuts and named keys carry none", () => {
    expect(keyEvent("keydown", ev("ç")).text).toBe("ç");
    expect(keyEvent("keydown", ev("A", { shiftKey: true }))).toMatchObject({ key: "A", text: "A", shift: true });
    expect(keyEvent("keydown", ev(","))).toMatchObject({ key: "comma", text: "," });
    expect(keyEvent("keydown", ev(" "))).toMatchObject({ key: "space", text: " " });
    expect(keyEvent("keydown", ev("c", { ctrlKey: true }))).toMatchObject({ key: "c", text: "", ctrl: true });
    expect(keyEvent("keydown", ev("Enter")).text).toBe("");
    expect(keyEvent("keydown", ev("😀")).text).toBe("😀");
  });

  test("modifiers, repeat and keyup", () => {
    expect(keyEvent("keyup", ev("x", { altKey: true, metaKey: true, repeat: true }))).toEqual({
      type: "keyup", key: "x", text: "", repeat: true, ctrl: false, shift: false, alt: true, super: true,
    });
    expect(keyEvent("keydown", ev("Control", { ctrlKey: true })).key).toBe("Control_L");
  });
});
