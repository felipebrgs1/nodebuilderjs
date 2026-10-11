---
name: nodebuilder-desempenho
description: Medir e melhorar o desempenho de apps nodebuilder (fps, CPU, memória) e evitar padrões lentos em listas grandes, atualizações frequentes e animações. Use quando o app estiver lento, travando, usando muita CPU/memória, ou ao criar listas com centenas de itens, dados ao vivo ou animações.
---

# Desempenho

## Medir

```sh
NB_STATS=1 bun src/main.tsx      # por segundo: fps, ms de estado/layout/pintura/nativo, nós, memória
NB_MAX_FPS=60 bun src/main.tsx   # teto de fps (padrão 120); também run(app, { maxFps: 60 })
```

Parado, o app não desenha nada (0% de CPU). Mudanças de estado agendam um frame; várias
mudanças antes dele saem juntas no mesmo frame.

## Padrões

- **Listas grandes:** sempre dentro de `<Scroll>`; o que está fora da área visível não é
  posicionado nem desenhado. Mesmo assim cada item vira nós: com milhares, filtre ou pagine.
- **`<For>` é keyed por referência:** recriar os objetos (`lista.map((x) => ({ ...x }))`)
  destrói e recria todas as linhas. Mantenha as referências e mude só o que mudou; para
  campos que mudam muito, guarde um signal dentro do item (`{ id, cpu: createSignal(0) }`).
- **Atualize o mínimo:** um signal por valor que muda, e funções finas nos props
  (`text={() => fmt(item.cpu())}`) em vez de um signal gigante com o estado todo.
- **Várias mudanças juntas:** `batch(() => { setA(1); setB(2); })` gera um único frame e
  roda os effects uma vez.
- **Animação e dados ao vivo:** use `requestAnimationFrame(cb)` (ritmado pela tela), não
  `setInterval` curto. Para parar, simplesmente não peça o próximo frame.
- **Texto:** medidas ficam em cache; textos que mudam todo frame (contadores, relógios)
  custam pouco, mas evite gerar milhares de strings novas por frame.
- **Imagens:** decodificar é caro e síncrono; reutilize o mesmo arquivo (é compartilhado) e
  use arquivos do tamanho exibido.
- Trabalho pesado de CPU (parse de arquivos grandes, cálculos) trava a interface: divida em
  pedaços com `setTimeout(..., 0)` ou use um `Worker`.
