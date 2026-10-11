---
name: nodebuilder-icones
description: Ícones e SVG no nodebuilder com o widget Icon, usando Lucide (lucide-static ou lucide) e Phosphor (@phosphor-icons/core). Use ao adicionar ícones a botões, menus, barras laterais ou listas, ao escolher uma biblioteca de ícones, ou ao mostrar qualquer arquivo .svg.
---

# Ícones

```sh
bun add lucide-static              # arquivos .svg do Lucide
bun add lucide                     # ou: os mesmos ícones como dados (import { Camera } from "lucide")
bun add @phosphor-icons/core       # Phosphor: assets/<peso>/<nome>.svg
```

```tsx
import { Button, Icon, Row, Text, createSignal, theme } from "@nodebuilderjs/core";
import camera from "lucide-static/icons/camera.svg" with { type: "text" };
import heart from "@phosphor-icons/core/assets/duotone/heart-duotone.svg" with { type: "text" };
import { Star } from "lucide";

const [ativo] = createSignal(false);

<Icon svg={camera} />                                  // 20 px, cor do texto ao redor
<Icon svg={heart} size={32} color="#e01b24" />
<Icon svg={Star} size={16} strokeWidth={1.5} />        // espessura do traço (ícones de contorno)
<Button variant="primary"><Icon svg={Star} size={16} /><Text>Favoritar</Text></Button>
<Row color={() => (ativo() ? theme.accent.base : theme.text.secondary)}>
  <Icon svg={camera} /><Text>Câmera</Text>              {/* ícone e texto mudam de cor juntos */}
</Row>
```

## Regras

- **Nunca** use `lucide-react`, `lucide-solid`, `@phosphor-icons/react`, `react-icons` ou
  `@heroicons/react`: eles exigem React/DOM. Use os pacotes acima.
- Importe arquivos `.svg` com `with { type: "text" }` (o import vira o texto do SVG e o
  `nodebuilder package` o embute). `with { type: "file" }` (caminho) também funciona.
- `svg` aceita: texto do SVG, caminho de um `.svg` ou os dados do pacote `lucide`. Pode ser
  uma função (`svg={() => (aberto() ? chevronUp : chevronDown)}`).
- `size` é a altura em px lógicos (padrão 20, `theme.icon.size`); a largura segue o
  `viewBox`. A cor vem de `color` no próprio `Icon` ou é herdada de um pai, como no `Text`.
- Trocar a cor é de graça (ícones de uma cor são tingidos na GPU); trocar o tamanho
  rasteriza de novo (~0,5 ms). Ficam nítidos em telas HiDPI.
- Pesos do Phosphor: `thin`, `light`, `regular`, `bold`, `fill`, `duotone` (pastas em
  `assets/`; nomes com o sufixo do peso, exceto `regular`: `heart.svg`, `heart-fill.svg`).

## Limites do SVG

Suportado: `path` (com arcos e curvas), `rect`, `circle`, `ellipse`, `line`, `polyline`,
`polygon`, `g`, `transform`, `fill`/`stroke` (cores, `currentColor`), espessura, pontas,
junções, `fill-rule`, opacidades e `style=""` inline.
Não suportado (o resto do desenho aparece): gradientes, padrões, texto, filtros, máscaras,
recortes, `<use>`, tracejado e `<style>`. Logos e ilustrações assim: exporte um PNG 2x e
use `Image`.
