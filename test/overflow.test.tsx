// Overflow warnings: layout notices content that needs more room than it gets and ends up hidden
// (clipped by an ancestor or the window), so a silently culled chip shows up in tests and dev runs.
import { describe, expect, test } from "bun:test";
import { Box, Column, Row, Scroll, Text, createSignal, debugTree } from "@nodebuilderjs/core";
import { layoutWarnings, mount } from "@nodebuilderjs/core/testing";

/** Three 110px chips with a 6px gap: 342px of content. */
const chips = (width: () => number = () => 110) => [
  <Text width={width}>Home</Text>,
  <Text width={width}>Albums</Text>,
  <Text width={width}>Artists</Text>,
];

describe("overflow warnings", () => {
  test("a row wider than its clipped panel names the hidden child, the clip and the numbers", () => {
    const { root, layoutWarnings } = mount(() => (
      <Box width={300} clip ariaLabel="panel">
        <Row gap={6}>{chips()}</Row>
      </Box>
    ));
    expect(layoutWarnings()).toEqual([
      'layout: Row > Text("Artists") overflows Box(panel) by 42px (children need 342px, 300px available)',
    ]);
    expect(debugTree(root)).toContain("Row [0,0 300x20] [overflow +42]");
  });

  test("the module-level helper reads the same warnings for any mounted root", () => {
    const { root } = mount(() => (
      <Box width={300} clip>
        <Row gap={6}>{chips()}</Row>
      </Box>
    ));
    expect(layoutWarnings(root)).toEqual([
      'layout: Row > Text("Artists") overflows Box by 42px (children need 342px, 300px available)',
    ]);
  });

  test("a horizontal Scroll does not warn: the rest is reachable", () => {
    const { root, layoutWarnings } = mount(() => (
      <Box width={300} clip>
        <Scroll horizontal gap={6} height={40}>{chips()}</Scroll>
      </Box>
    ));
    expect(layoutWarnings()).toEqual([]);
    expect(debugTree(root)).not.toContain("overflow");
  });

  test("making the children fit clears the warning", () => {
    const [width, setWidth] = createSignal(110);
    const { relayout, layoutWarnings } = mount(() => (
      <Box width={300} clip>
        <Row gap={6}>{chips(width)}</Row>
      </Box>
    ));
    expect(layoutWarnings()).toHaveLength(1);
    setWidth(96); // 3 * 96 + 2 * 6 = 300
    relayout();
    expect(layoutWarnings()).toEqual([]);
  });

  test("overflowing the window is reported too", () => {
    const { layoutWarnings } = mount(() => <Row gap={6}>{chips()}</Row>, { width: 300, height: 200 });
    expect(layoutWarnings()).toEqual([
      'layout: Row > Text("Artists") overflows the window by 42px (children need 342px, 300px available)',
    ]);
  });

  test("content that spills out but stays visible is not reported", () => {
    const { layoutWarnings } = mount(() => (
      <Column align="start">
        <Box width={300}>
          <Row gap={6}>{chips()}</Row>
        </Box>
      </Column>
    ));
    expect(layoutWarnings()).toEqual([]);
  });

  test("wrapping text shrinks instead of overflowing", () => {
    const { layoutWarnings } = mount(() => (
      <Box width={300} clip>
        <Row gap={6}>
          <Text>a label long enough to wrap onto a few lines</Text>
          <Text>and another one that also wraps nicely</Text>
        </Row>
      </Box>
    ));
    expect(layoutWarnings()).toEqual([]);
  });

  test("a child wider than its clipped column is reported across the axis", () => {
    const { layoutWarnings } = mount(() => (
      <Column width={300} clip ariaLabel="sidebar">
        <Box width={320} height={20} ariaLabel="banner" />
      </Column>
    ));
    expect(layoutWarnings()).toEqual([
      "layout: Column(sidebar) > Box(banner) overflows Column(sidebar) by 20px (it is 320px wide, 300px available)",
    ]);
  });

  test("spilling past a Scroll's edge is not reported: scrolling shows it", () => {
    // Each 30px cell has 10px inside its padding for a 20px line; the second one's text
    // reaches past the Scroll's 50px only because of where it is scrolled.
    const { layoutWarnings } = mount(() => (
      <Column align="start">
        <Scroll height={50} width={100}>
          {[1, 2, 3].map((i) => (
            <Box height={30} padding={[10, 0]}>
              <Text>{`row ${i}`}</Text>
            </Box>
          ))}
        </Scroll>
      </Column>
    ));
    expect(layoutWarnings()).toEqual([]);
  });

  test("nothing is reported from a culled subtree", () => {
    const { layoutWarnings } = mount(() => (
      <Scroll height={100}>
        <Box height={200} />
        <Box width={300} clip>
          <Row gap={6}>{chips()}</Row>
        </Box>
      </Scroll>
    ));
    expect(layoutWarnings()).toEqual([]);
  });
});
