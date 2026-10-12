# {{title}}

Native Linux desktop app made with [nodebuilder](https://www.npmjs.com/package/@nodebuilderjs/core):
TSX components with SolidJS-style reactivity, drawn by a native core (Wayland/X11 + GLES).

```sh
bun run dev        # opens the window and restarts on save
bun start          # runs once
bun test           # tests without a window (test/)
bun run typecheck  # TypeScript 7
bun run screenshot # screenshot.png of the app, without opening a window
bun run package    # AppImage, .deb, .rpm and .tar.gz in dist/
```

## Structure

```
src/
  main.tsx             opens the window: run(() => <App />)
  App.tsx              screen layout and dark mode toggle; creates the state and passes it down
  state.ts             app signals and actions (counter, tasks, history)
  icons.ts             SVG icons used by the app
  components/
    Counter.tsx        buttons, reactive text and a tooltip
    Tasks.tsx          text field, list with For/Checkbox, Show and a confirmation Dialog
    Activity.tsx       chart (@nodebuilderjs/core/charts) that follows the state
test/
  App.test.tsx         tests without a window: mount + interact (click, type)
```

To remove the example and start from scratch, keep only the `<Window>` in `App.tsx`.

Requirements: Linux with Wayland or X11, [Bun](https://bun.sh) 1.4+.
