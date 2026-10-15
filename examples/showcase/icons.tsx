// <Icon>: SVG icons from Lucide and Phosphor, colored like text (and tinted on the GPU).
// The .svg files are imported as text so `nodebuilder package` embeds them.
import { Box, Button, Card, Column, For, Icon, Row, Scroll, Text, Window, createSignal, run, theme } from "@nodebuilderjs/core";
import lucideBell from "../assets/icons/lucide-bell.svg" with { type: "text" };
import lucideCamera from "../assets/icons/lucide-camera.svg" with { type: "text" };
import lucideDownload from "../assets/icons/lucide-download.svg" with { type: "text" };
import lucideHeart from "../assets/icons/lucide-heart.svg" with { type: "text" };
import lucideHouse from "../assets/icons/lucide-house.svg" with { type: "text" };
import lucideSearch from "../assets/icons/lucide-search.svg" with { type: "text" };
import lucideSettings from "../assets/icons/lucide-settings.svg" with { type: "text" };
import lucideStar from "../assets/icons/lucide-star.svg" with { type: "text" };
import lucideTrash from "../assets/icons/lucide-trash-2.svg" with { type: "text" };
import lucideUser from "../assets/icons/lucide-user.svg" with { type: "text" };
import phBell from "../assets/icons/phosphor-bell-duotone.svg" with { type: "text" };
import phCamera from "../assets/icons/phosphor-camera-duotone.svg" with { type: "text" };
import phGear from "../assets/icons/phosphor-gear-duotone.svg" with { type: "text" };
import phHeart from "../assets/icons/phosphor-heart-duotone.svg" with { type: "text" };
import phHouse from "../assets/icons/phosphor-house-duotone.svg" with { type: "text" };
import phSearch from "../assets/icons/phosphor-magnifying-glass-duotone.svg" with { type: "text" };
import phStar from "../assets/icons/phosphor-star-duotone.svg" with { type: "text" };
import phUser from "../assets/icons/phosphor-user-duotone.svg" with { type: "text" };

const LUCIDE = [lucideHouse, lucideSearch, lucideSettings, lucideBell, lucideUser, lucideCamera, lucideHeart, lucideStar, lucideDownload, lucideTrash];
const PHOSPHOR = [phHouse, phSearch, phGear, phBell, phUser, phCamera, phHeart, phStar];
const SIZES = [16, 20, 24, 32, 48];

function NavItem(props: { icon: string; label: string; index: number; selected: () => number; onSelect: (i: number) => void }) {
  const [hovered, setHovered] = createSignal(false);
  const active = () => props.selected() === props.index;
  return (
    <Row
      gap={10} padding={[8, 12]} radius={8} align="center" cursor="pointer"
      background={() => (active() ? "#3584e41f" : hovered() ? "#0000000a" : "transparent")}
      color={() => (active() ? theme.accent.base : hovered() ? theme.text.primary : theme.text.secondary)}
      onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onClick={() => props.onSelect(props.index)}
    >
      <Icon svg={props.icon} size={18} />
      <Text bold={active}>{props.label}</Text>
    </Row>
  );
}

function App() {
  const [selected, setSelected] = createSignal(0);
  const [stroke, setStroke] = createSignal(2);
  const nav = [[lucideHouse, "Início"], [lucideSearch, "Buscar"], [lucideBell, "Notificações"], [lucideSettings, "Ajustes"]] as const;
  return (
    <Window title="Ícones" width={760} height={600}>
      <Row grow={1} minHeight={0}>
        <Column width={200} padding={12} gap={2} background="#f2f2f4">
          {nav.map(([icon, label], i) => <NavItem icon={icon} label={label} index={i} selected={selected} onSelect={setSelected} />)}
        </Column>
        <Scroll grow={1} padding={20} gap={16}>
          <Card gap={12}>
            <Text bold>Lucide (contorno)</Text>
            <Row gap={16}><For each={LUCIDE}>{(svg) => <Icon svg={svg} size={24} strokeWidth={stroke} />}</For></Row>
            <Row gap={8} align="center">
              <Text color={theme.text.secondary}>{() => `strokeWidth ${stroke()}`}</Text>
              <Button label="−" onClick={() => setStroke((s) => Math.max(0.5, s - 0.5))} />
              <Button label="+" onClick={() => setStroke((s) => Math.min(3, s + 0.5))} />
            </Row>
          </Card>
          <Card gap={12}>
            <Text bold>Phosphor (duotone)</Text>
            <Row gap={16} color={theme.accent.base}><For each={PHOSPHOR}>{(svg) => <Icon svg={svg} size={28} />}</For></Row>
          </Card>
          <Card gap={12}>
            <Text bold>Tamanhos e cores</Text>
            <Row gap={16} align="end">
              <For each={SIZES}>{(size) => <Icon svg={lucideHeart} size={size} color="#e01b24" />}</For>
              <For each={SIZES}>{(size) => <Icon svg={phStar} size={size} color="#e5a50a" />}</For>
            </Row>
          </Card>
          <Card gap={12}>
            <Text bold>Em botões</Text>
            <Row gap={8}>
              <Button variant="primary"><Icon svg={lucideDownload} size={16} /><Text>Baixar</Text></Button>
              <Button><Icon svg={lucideStar} size={16} /><Text>Favoritar</Text></Button>
              <Button variant="danger"><Icon svg={lucideTrash} size={16} /><Text>Excluir</Text></Button>
              <Box padding={8} radius={8} background="#0000000a"><Icon svg={lucideCamera} /></Box>
            </Row>
          </Card>
        </Scroll>
      </Row>
    </Window>
  );
}

run(() => <App />);
