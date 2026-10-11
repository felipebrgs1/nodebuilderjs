---
name: nodebuilder-desenho
description: Desenho livre e gráficos no nodebuilder com o widget Canvas (linhas, áreas, barras, pizza, rosca, medidores, sparklines, anotações). Use ao criar gráficos, visualizações de dados, indicadores circulares ou qualquer forma que não seja um retângulo, e no lugar de Chart.js, Recharts, D3 ou <canvas> do navegador.
---

# Desenho com `<Canvas>`

```tsx
import { Canvas, createSignal, theme } from "@nodebuilderjs/core";

const [dados, setDados] = createSignal([12, 40, 33, 70, 55, 90]);

<Canvas height={160} draw={(g) => {
  const v = dados();                                      // signals lidos aqui redesenham o canvas
  const x = (i: number) => (i / (v.length - 1)) * g.width;
  const y = (n: number) => g.height - (n / 100) * g.height;
  for (let n = 0; n <= 100; n += 25) g.line(0, y(n), g.width, y(n), "#0000001a", 1, "butt");  // grade
  const pts = v.flatMap((n, i) => [x(i), y(n)]);
  g.polygon([0, g.height, ...pts, g.width, g.height], "#3584e433");   // área
  g.polyline(pts, theme.accent.base, 2);                              // linha
  g.circle(x(v.length - 1), y(v[v.length - 1]!), 4, theme.accent.base);
  g.text("máx 100", 4, 0, theme.text.secondary, 11);
}} />
```

## API (`g`)

| Método | O quê |
|---|---|
| `g.width`, `g.height` | tamanho do canvas (dentro do `padding`) |
| `rect(x, y, w, h, cor, raio?)` | retângulo (barras) |
| `line(x0, y0, x1, y1, cor, largura = 1, ponta = "round")` | segmento; ponta `round`, `butt` (reta) ou `square` |
| `polyline(pontos, cor, largura = 1, { cap, closed })` | linha por vários pontos `[x0, y0, x1, y1, ...]`, junções redondas |
| `polygon(pontos, cor)` | polígono preenchido (côncavo pode; cruzando a si mesmo não desenha) |
| `circle(cx, cy, raio, cor)` | disco |
| `arc(cx, cy, raioExterno, raioInterno, início, varredura, cor)` | fatia (interno 0) ou anel; radianos, 0 = cima, sentido horário |
| `text(texto, x, y, cor, tamanho?, negrito?)`, `measureText(texto, tamanho?)` | rótulos; `y` é o topo da linha |

## Regras

- Dê tamanho ao canvas: `width`/`height` ou `grow`. Sem tamanho, `draw` não roda.
- Coordenadas locais, com `y` para baixo. Inverta para gráficos: `g.height - valor * escala`.
- `draw` deve só desenhar: nada de criar signals, effects ou chamar `set` lá dentro.
- O canvas redesenha quando um signal lido em `draw` muda ou o tamanho muda; a geometria
  fica gravada, então outras partes da janela redesenhando não custam nada aqui.
- Dados ao vivo: atualize o signal com `requestAnimationFrame`; milhares de pontos
  funcionam (5000 pontos de linha + área a ~120 fps).
- Pizza/rosca: some as fatias em radianos (`fração * 2 * Math.PI`); um pequeno vão
  (`- 0.03` na varredura) separa as fatias visualmente.
- Cores translúcidas em `polyline` escurecem nas junções: prefira cores opacas para linhas
  e translúcidas para áreas.
- Interação (tooltip, clique num ponto): use os eventos do próprio `Canvas`
  (`onPointerMove` ainda não existe; `onClick` dá `e.x`/`e.y` em coordenadas da janela).
