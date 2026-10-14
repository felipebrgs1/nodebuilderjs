// Percentages: width/height/min/max as `"50%"` of the parent's content box (inside its padding), as in CSS; an absolute child's, of the padding box.
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

test("percentages of an absolute child are of the parent's padding box, as in CSS", () => {
  const { root } = mount(() => (
    <Column align="start">
      <Box width={200} height={100} padding={20} borderWidth={5}>
        <Box position="absolute" left={0} top={0} width="50%" height="100%" />
      </Box>
    </Column>
  ));
  const child = root.children[0]!.children[0]!.children[0]!;
  expect([child.x, child.y, child.width, child.height]).toEqual([5, 5, 95, 90]);
});
