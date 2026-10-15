// The <Image> widget: natural size, aspect ratio, fit modes, a Grid of square covers, rounded corners and opacity.
// `with { type: "file" }` makes `bun build --compile` (and so `nodebuilder package`) embed the
// file; the import is its path, which works both in development and in the executable.
import { Button, Card, Column, Grid, Image, Row, Scroll, Text, Window, createSignal, run, theme } from "@nodebuilderjs/core";
import logo from "./assets/logo.png" with { type: "file" };
import photo from "./assets/plasma.png" with { type: "file" };
import photoJpeg from "./assets/photo.jpg" with { type: "file" };
import photoWebp from "./assets/photo.webp" with { type: "file" };
import photoAvif from "./assets/photo.avif" with { type: "file" };

// PNG, JPEG and WebP are decoded in TypeScript; AVIF (and HEIC) by the system's libheif.
const FORMATS = [
  { label: "PNG", src: photo },
  { label: "JPEG", src: photoJpeg },
  { label: "WebP", src: photoWebp },
  { label: "AVIF", src: photoAvif },
];

function Sample(props: { label: string; fit: "contain" | "cover" | "fill" }) {
  return (
    <Column gap={8} align="start">
      <Image src={photo} width={140} height={140} fit={props.fit} radius={12} background="#00000010" />
      <Text fontSize={12} color={theme.text.secondary}>{props.label}</Text>
    </Column>
  );
}

function App() {
  const [opacity, setOpacity] = createSignal(1);
  return (
    <Window title="Imagens" width={720} height={560}>
      <Scroll grow={1} padding={24} gap={20}>
        <Row gap={20} align="center">
          <Image src={logo} width={64} />
          <Column gap={4}>
            <Text fontSize={22} bold>Imagens</Text>
            <Text color={theme.text.secondary}>PNG, JPEG, WebP e AVIF, desenhados pela GPU</Text>
          </Column>
        </Row>
        <Card gap={12}>
          <Text bold>Formatos</Text>
          <Row gap={16}>
            {FORMATS.map((f) => (
              <Column gap={8} align="start">
                <Image src={f.src} width={140} height={93} fit="cover" radius={8} />
                <Text fontSize={12} color={theme.text.secondary}>{f.label}</Text>
              </Column>
            ))}
          </Row>
        </Card>
        <Card gap={12}>
          <Text bold>Grid of square covers</Text>
          {/* Equal columns that follow the window width; aspectRatio keeps every cover square. */}
          <Grid columns={6} gap={8}>
            {[...FORMATS, ...FORMATS, ...FORMATS].map((f) => (
              <Image src={f.src} aspectRatio={1} fit="cover" radius={8} />
            ))}
          </Grid>
        </Card>
        <Card gap={12}>
          <Text bold>Modos de ajuste (fit)</Text>
          <Row gap={16}>
            <Sample label="contain (padrão)" fit="contain" />
            <Sample label="cover" fit="cover" />
            <Sample label="fill" fit="fill" />
          </Row>
        </Card>
        <Card gap={12}>
          <Text bold>Opacidade e cantos</Text>
          <Row gap={16} align="center">
            <Image src={photo} height={100} radius={50} opacity={opacity} />
            <Image src={logo} width={100} opacity={opacity} />
            <Column gap={8}>
              <Text>{() => `opacidade ${Math.round(opacity() * 100)}%`}</Text>
              <Row gap={8}>
                <Button label="−" onClick={() => setOpacity((o) => Math.max(0, o - 0.25))} />
                <Button label="+" onClick={() => setOpacity((o) => Math.min(1, o + 0.25))} />
              </Row>
            </Column>
          </Row>
        </Card>
      </Scroll>
    </Window>
  );
}

run(() => <App />);
