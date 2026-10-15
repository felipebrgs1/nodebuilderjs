// Scrolling: a horizontal strip of cards, a long list with "go to" buttons
// (scrollIntoView/scrollTo through a ref) and a grid that scrolls both ways.
// Drag a thumb, press a track, use the wheel (Shift+wheel goes sideways) or the keys
// (PageUp/PageDown, Home/End, arrows) with a button of the list focused.

import { Box, Button, Card, Column, For, Row, Scroll, Text, Window, run, theme } from "@nodebuilderjs/core";
import type { ElementRef } from "@nodebuilderjs/core";

const colors = ["#3584e4", "#26a269", "#e5a50a", "#c64600", "#9141ac", "#2190a4"];
const items = Array.from({ length: 200 }, (_, i) => i);
const rowRefs: ElementRef[] = [];
let list: ElementRef | undefined;

run(() => (
  <Window title="Rolagem" width={720} height={560}>
    <Column grow={1} padding={20} gap={12}>
      <Text bold>Faixa horizontal</Text>
      <Scroll horizontal gap={12} padding={[0, 0, 14, 0]}>
        <For each={Array.from({ length: 12 }, (_, i) => i)}>
          {(i) => (
            <Card width={180} gap={6}>
              <Box height={60} radius={8} background={colors[i % colors.length]!} />
              <Text bold>{`Card ${i + 1}`}</Text>
              <Text color={theme.text.secondary}>Um texto que quebra dentro da largura fixa do card.</Text>
            </Card>
          )}
        </For>
      </Scroll>
      <Row grow={1} gap={12}>
        <Column width={250} gap={8}>
          <Row gap={8}>
            <Button label="Item 150" onClick={() => rowRefs[150]?.scrollIntoView()} />
            <Button label="Topo" onClick={() => list?.scrollTo(0)} />
          </Row>
          <Scroll ref={(el) => (list = el)} grow={1} radius={8} background="#ffffff" borderWidth={1} borderColor={theme.card.border}>
            <For each={items}>
              {(i) => (
                <Row ref={(el) => (rowRefs[i] = el)} padding={[8, 12]} gap={8} align="center" background={i === 150 ? "#3584e41a" : "transparent"}>
                  <Text grow={1}>{`Item ${i}`}</Text>
                  <Button label="Abrir" />
                </Row>
              )}
            </For>
          </Scroll>
        </Column>
        <Column grow={1} gap={8}>
          <Text bold>Grade nos dois eixos</Text>
          <Scroll horizontal vertical grow={1} radius={8} background="#ffffff" borderWidth={1} borderColor={theme.card.border}>
            <For each={Array.from({ length: 30 }, (_, r) => r)}>
              {(r) => (
                <Row>
                  <For each={Array.from({ length: 20 }, (_, c) => c)}>
                    {(c) => (
                      <Box width={64} height={36} padding={[10, 8]} borderWidth={0.5} borderColor="#0000000f">
                        <Text fontSize={12} color={theme.text.secondary}>{`${String.fromCharCode(65 + c)}${r + 1}`}</Text>
                      </Box>
                    )}
                  </For>
                </Row>
              )}
            </For>
          </Scroll>
        </Column>
      </Row>
    </Column>
  </Window>
));
