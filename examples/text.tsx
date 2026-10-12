// Text: paragraphs that wrap, alignment, line spacing, one-line truncation with an
// ellipsis, underlines (and a link underlined on hover), font weights, italics, letter
// spacing and a selectable paragraph cut at two lines.

import { Card, Column, Row, Text, Window, createSignal, run, theme } from "@nodebuilderjs/core";

const paragraph =
  "O nodebuilder desenha a interface com a GPU, sem navegador. Este parágrafo é longo de propósito, para quebrar em várias linhas dentro do card.";

function Link(props: { children: string }) {
  const [hovered, setHovered] = createSignal(false);
  return (
    <Text color={() => theme.accent.base} underline={hovered} cursor="pointer"
      onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      {props.children}
    </Text>
  );
}

run(() => (
  <Window title="Text" width={560} height={600}>
    <Column grow={1} padding={20} gap={12}>
      <Card>
        <Text>{paragraph}</Text>
      </Card>
      <Row gap={12}>
        <Card grow={1}>
          <Text textAlign="center" lineHeight={1.4}>{paragraph}</Text>
        </Card>
        <Card grow={1}>
          <Text textAlign="end" underline color={theme.text.secondary}>Aligned to the end, wrapping and underlined.</Text>
        </Card>
      </Row>
      <Row gap={8} align="center">
        <Text bold>Nome:</Text>
        <Text grow={1} maxLines={1}>um nome de arquivo muito comprido que não cabe nesta linha de jeito nenhum.pdf</Text>
        <Text color={theme.text.secondary}>12 MB</Text>
      </Row>
      <Row gap={16} align="center">
        <Text fontSize={22} underline>Underlined at 22 px</Text>
        <Link>A link (underlined on hover)</Link>
      </Row>
      <Row gap={10} align="end">
        {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
          <Column gap={2} align="center">
            <Text fontSize={22} fontWeight={w}>Ag</Text>
            <Text fontSize={11} color={theme.text.secondary}>{w}</Text>
          </Column>
        ))}
        <Column gap={2} align="center">
          <Text fontSize={22} italic>Ag</Text>
          <Text fontSize={11} color={theme.text.secondary}>italic</Text>
        </Column>
        <Column gap={2} align="center">
          <Text fontSize={22} fontWeight={800} italic>Ag</Text>
          <Text fontSize={11} color={theme.text.secondary}>800 italic</Text>
        </Column>
      </Row>
      <Row gap={16} align="center">
        <Text fontSize={12} bold letterSpacing={2} color={theme.text.secondary}>SECTION LABEL</Text>
        <Text fontSize={22} fontWeight={700} letterSpacing={-0.5}>Tight headline</Text>
        <Text italic letterSpacing={4} underline>spaced out</Text>
      </Row>
      <Text selectable maxLines={2}>{`${paragraph} ${paragraph}`}</Text>
    </Column>
  </Window>
));
