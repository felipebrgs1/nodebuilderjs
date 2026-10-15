// Text: paragraphs that wrap, alignment, line spacing, one-line truncation with an
// ellipsis, underlines (and a link underlined on hover), font weights, italics, letter
// spacing, font families (generic ones and a picker of the installed ones), OpenType features
// a selectable paragraph cut at two lines, and a RichText paragraph (bold, italic, inline code, a link).

import { Card, Column, RichText, Row, Select, Text, Window, createSignal, fontFamilies, run, theme } from "@nodebuilderjs/core";

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

const installed = fontFamilies().map((family) => ({ value: family, label: family }));
const [family, setFamily] = createSignal<string | undefined>(installed.find((f) => /^(DejaVu Serif|Noto Serif|Liberation Serif)$/.test(f.value))?.value);

run(() => (
  <Window title="Text" width={560} height={860}>
    <Column grow={1} padding={20} gap={12}>
      <Card>
        <Text>{paragraph}</Text>
      </Card>
      <Card>
        <RichText spans={[
          "RichText mixes ", { text: "bold", bold: true }, ", ", { text: "italic", italic: true }, " and ",
          { text: "inline code", family: "monospace", background: "#8882" }, " in one paragraph, with ",
          { text: "a link", color: theme.accent.base, underline: true, onClick: () => console.log("link") },
          " that wraps across spans like any text.",
        ]} />
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
      <Row gap={16} align="center">
        <Text fontFamily="serif" fontSize={18}>Serif</Text>
        <Text fontFamily="monospace" fontSize={18}>Monospace</Text>
        <Text fontFamily="'No Such Font', cursive, sans-serif" fontSize={18}>Fallback list</Text>
      </Row>
      <Row gap={16} align="end">
        {["", "smcp", "onum", "frac, zero"].map((features) => (
          <Column gap={2}>
            <Text fontSize={18} fontFeatures={features}>Caps 1/2 1890</Text>
            <Text fontSize={11} color={theme.text.secondary}>{features || "no features"}</Text>
          </Column>
        ))}
      </Row>
      <Row gap={12} align="center">
        <Select width={220} value={family} onChange={setFamily} options={installed} placeholder="Installed family" />
        <Text grow={1} maxLines={1} fontSize={20} fontFamily={() => family() ?? ""}>The quick brown fox, 0123</Text>
      </Row>
      <Text selectable maxLines={2}>{`${paragraph} ${paragraph}`}</Text>
    </Column>
  </Window>
));
