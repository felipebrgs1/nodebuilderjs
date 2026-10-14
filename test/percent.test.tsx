// Percentages: width/height/min/max as `"50%"` of the parent's content box (inside its padding), as in CSS.
import { expect, test } from "bun:test";
import { Box, Column, Row, createSignal } from "@nodebuilderjs/core";
import { mount } from "@nodebuilderjs/core/testing";

test('width="50%" is half of the parent\'s content box, from the first layout', () => {
  const { root } = mount(() => (
    <Row padding={10} width={420} height={100}>
      <Box width="50%" height={10} />
      <Box width="25%" height="100%" />
    </Row>
  ), { width: 800, height: 100 });
  const [half, quarter] = root.children[0]!.children;
  expect([half!.width, quarter!.width]).toEqual([200, 100]);
  expect(quarter!.height).toBe(80); // the row's 100 px height minus the padding
});

test("percentages follow the parent when it resizes, and a reactive value can switch to px", () => {
  const [w, setW] = createSignal<number | `${number}%`>("50%");
  const [outer, setOuter] = createSignal(300);
  const { root, relayout } = mount(() => (
    <Column align="start">
      <Column width={outer} align="start">
        <Box width={w} height={10} />
      </Column>
    </Column>
  ));
  const box = root.children[0]!.children[0]!.children[0]!;
  expect(box.width).toBe(150);
  setOuter(500);
  relayout();
  expect(box.width).toBe(250);
  setW(40);
  relayout();
  expect(box.width).toBe(40);
});

test("maxWidth as a percentage caps a growing child", () => {
  const { root } = mount(() => (
    <Row width={400}>
      <Box grow={1} maxWidth="30%" height={10} />
      <Box width={50} height={10} />
    </Row>
  ));
  expect(root.children[0]!.children[0]!.width).toBe(120);
});
