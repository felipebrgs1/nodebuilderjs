---
name: nodebuilder-performance
description: Measure and improve the performance of nodebuilder apps (fps, CPU, memory) and avoid slow patterns in large lists, frequent updates and animations. Use when the app is slow, stuttering or freezing, using too much CPU/memory, or when building lists with hundreds of items, live data or animations.
---

# Performance

## Measure

```sh
NB_STATS=1 bun src/main.tsx      # per second: fps, ms of state/layout/paint/native, nodes, memory
NB_MAX_FPS=60 bun src/main.tsx   # fps cap (default 120); also run(app, { maxFps: 60 })
```

When idle, the app draws nothing (0% CPU). State changes schedule a frame; several changes
before it go out together in the same frame.

## Patterns

- **Large lists:** always inside `<Scroll>`; whatever is outside the visible area is not
  positioned or drawn. Even so, each item becomes nodes: with thousands, filter or paginate.
- **`<For>` is keyed by reference:** recreating the objects (`list.map((x) => ({ ...x }))`)
  destroys and recreates every row. Keep the references and change only what changed; for
  fields that change often, store a signal inside the item (`{ id, cpu: createSignal(0) }`).
  If the data always arrives as new objects (a JSON every second) or is primitive,
  use `<Index>`: rows stay by position and only the `item()` accessor changes.
- **Update the minimum:** one signal per changing value, and thin functions in props
  (`text={() => fmt(item.cpu())}`) instead of one giant signal holding all the state.
- **Several changes together:** `batch(() => { setA(1); setB(2); })` produces a single frame and
  runs the effects once.
- **Animation and live data:** to go from one value to another use `createTween`/`animate`; for
  a loop, `requestAnimationFrame(cb)` (paced by the display), not a short `setInterval`. To
  stop, do not request the next frame. `Spinner` and `ProgressBar` without a value request frames while
  they are on screen: hide them when the wait is over.
- **Text:** measurements are cached; texts that change every frame (counters, clocks)
  cost little, but avoid generating thousands of new strings per frame.
- **Images:** decoding is expensive and synchronous; reuse the same file (it is shared) and
  use files at the displayed size.
- Heavy CPU work (parsing large files, computations) freezes the interface: split it into
  chunks with `setTimeout(..., 0)` or use a `Worker`.
