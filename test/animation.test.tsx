import { expect, test } from "bun:test";
import {
  Button, Column, Dialog, Toggle, animate, createPresence, createRoot, createSignal, createTween, easing, mixColor,
} from "@nodebuilderjs/core";
import { findByText, frames, interact, mount } from "@nodebuilderjs/core/testing";
import { commandsOf } from "./helpers.js";

test("without a window (and without frames()), animations jump to the end at once", () => {
  mount(() => null);
  const seen: number[] = [];
  let done = 0;
  animate(0, 10, (v) => seen.push(v), { duration: 300, onDone: () => done++ });
  expect([seen, done]).toEqual([[10], 1]);
  createRoot(() => {
    const [open, setOpen] = createSignal(true);
    const p = createPresence(open, { exit: 200 });
    setOpen(false);
    expect([p.mounted(), p.progress()]).toEqual([false, 0]);
  });
});

test("animate eases from start to end over the duration, then calls onDone once", () => {
  mount(() => null);
  const clock = frames();
  const seen: number[] = [];
  let done = 0;
  animate(0, 100, (v) => seen.push(Math.round(v)), { duration: 160, easing: easing.linear, onDone: () => done++ });
  expect(seen).toEqual([0]); // the start right away
  clock.advance(80);
  expect(seen.at(-1)).toBe(50);
  clock.advance(200);
  expect([seen.at(-1), done]).toEqual([100, 1]);
});

test("a tween follows its source, and a new target starts from where it is", () => {
  mount(() => null);
  const clock = frames();
  createRoot(() => {
    const [target, setTarget] = createSignal(0);
    const value = createTween(target, { duration: 100, easing: easing.linear });
    setTarget(100);
    clock.advance(48);
    expect(Math.round(value())).toBe(48);
    setTarget(0); // back from 48
    clock.advance(48);
    expect(Math.round(value())).toBe(25);
    clock.advance(100);
    expect(value()).toBe(0);
  });
});

test("createPresence keeps the content mounted while it fades out", () => {
  mount(() => null);
  const clock = frames();
  createRoot(() => {
    const [open, setOpen] = createSignal(false);
    const p = createPresence(open, { enter: 100, exit: 100, easing: easing.linear });
    setOpen(true);
    expect(p.mounted()).toBe(true);
    clock.advance(100);
    expect(p.progress()).toBe(1);
    setOpen(false);
    clock.advance(48);
    expect([p.mounted(), Math.round(p.progress() * 100)]).toEqual([true, 52]);
    clock.advance(100);
    expect([p.mounted(), p.progress()]).toEqual([false, 0]);
  });
});

test("mixColor blends two colors", () => {
  expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#808080ff");
  expect(mixColor("#ff000000", "#ff0000ff", 0.25)).toBe("#ff000040");
});

test("Dialog fades and slides in and out; it leaves the tree only when the exit ends", () => {
  const [open, setOpen] = createSignal(false);
  const { root, relayout } = mount(() => (
    <Column align="start">
      <Button label="Abrir" onClick={() => setOpen(true)} />
      <Dialog open={open} onClose={() => setOpen(false)} title="Oi" />
    </Column>
  ));
  const clock = frames();
  setOpen(true);
  relayout();
  const layer = root.layers[0]!;
  expect(layer.style.opacity).toBe(0);
  clock.advance(1000);
  expect(layer.style.opacity).toBe(1);
  expect(findByText(root, "Oi")!.parent!.style.translateY).toBe(0);
  setOpen(false);
  clock.advance(40);
  relayout();
  expect(root.layers).toHaveLength(1);
  expect(layer.style.opacity!).toBeLessThan(1);
  clock.advance(1000);
  relayout();
  expect(root.layers).toEqual([]);
});

test("Toggle slides its thumb", () => {
  const [on, setOn] = createSignal(false);
  const { root } = mount(() => (
    <Column align="start">
      <Toggle checked={on} onChange={setOn} />
    </Column>
  ));
  const toggle = root.children[0]!.children[0]!;
  const clock = frames();
  const ui = interact(root);
  const thumbX = () => commandsOf(toggle, "rect").find((r) => r.color.join() === "1,1,1,1")!.x - toggle.x;
  ui.press(toggle);
  ui.release(toggle);
  clock.advance(32);
  expect(thumbX()).toBeGreaterThan(2);
  expect(thumbX()).toBeLessThan(18);
  clock.advance(1000);
  expect(thumbX()).toBe(18);
});
