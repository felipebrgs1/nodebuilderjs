// Colors and sizes the widgets use, in a light and a dark preset. `theme` holds the current
// values: every leaf is a getter that tracks a version signal, so effects (and paint) that
// read `theme.text.primary` follow setTheme() and assignments like `theme.accent.base = "#..."`.

import { createSignal } from "./reactive/signals.js";
import { addColorTokens, atPath } from "./render/color.js";
import type { StyleProps } from "./widgets/props.js";
import { invalidate } from "./render/node.js";

export const lightTheme = {
  scheme: "light" as "light" | "dark",
  font: { size: 14 },
  icon: { size: 20 },
  radius: 8,
  window: { background: "#fafafa", border: "#00000026", radius: 12, titlebarHeight: 46 },
  text: { primary: "#1f1f24", secondary: "#6b6b76", inverted: "#ffffff" },
  accent: { base: "#3584e4", hover: "#4a92ea", pressed: "#2a6fc4", text: "#ffffff" },
  danger: { base: "#e01b24", hover: "#e9343c", pressed: "#c01820", text: "#ffffff" },
  control: { base: "#00000010", hover: "#0000001a", pressed: "#00000029", text: "#1f1f24" },
  field: { background: "#ffffff", border: "#00000024", focus: "#3584e4", placeholder: "#9a9aa4" },
  card: { background: "#ffffff", border: "#00000014" },
  focusRing: "#3584e480",
  selection: "#3584e44d",
  divider: "#0000001a",
  tooltip: { background: "#1f1f24eb", text: "#ffffff" },
  /** Dims what is behind a modal dialog. */
  backdrop: "#00000059",
  /** Opacity of disabled controls. */
  disabledOpacity: 0.45,
  /** Overlay scrollbars: a thin thumb that widens (to `hoverSize`) under the pointer. */
  scrollbar: { thumb: "#00000040", hover: "#00000066", pressed: "#00000080", track: "#0000000f", size: 4, hoverSize: 8, margin: 3, minThumb: 24 },
};

export type Theme = typeof lightTheme;

export const darkTheme: Theme = {
  ...lightTheme,
  scheme: "dark",
  window: { ...lightTheme.window, background: "#242428", border: "#ffffff1f" },
  text: { primary: "#f2f2f4", secondary: "#a2a2ab", inverted: "#1f1f24" },
  accent: { base: "#3584e4", hover: "#4f95ec", pressed: "#78aeed", text: "#ffffff" },
  danger: { base: "#e01b24", hover: "#ec3a42", pressed: "#ff6b70", text: "#ffffff" },
  control: { base: "#ffffff14", hover: "#ffffff1f", pressed: "#ffffff2e", text: "#f2f2f4" },
  field: { background: "#1e1e22", border: "#ffffff24", focus: "#4f95ec", placeholder: "#7c7c86" },
  card: { background: "#2e2e33", border: "#ffffff12" },
  focusRing: "#78aeed80",
  selection: "#3584e466",
  divider: "#ffffff1a",
  tooltip: { background: "#3a3a41f2", text: "#ffffff" },
  backdrop: "#00000080",
  disabledOpacity: 0.4,
  scrollbar: { ...lightTheme.scrollbar, thumb: "#ffffff40", hover: "#ffffff66", pressed: "#ffffff80", track: "#ffffff0f" },
};

const [version, bump] = createSignal(0, { equals: false });
let current: Theme = structuredClone(lightTheme);

function changed() {
  bump(0);
  invalidate();
}

/** An object shaped like the theme whose leaves read and write `current` (at `path`). */
function view(path: string[]): any {
  const out: Record<string, unknown> = {};
  let sample: any = lightTheme;
  for (const k of path) sample = sample[k];
  for (const key of Object.keys(sample)) {
    const at = () => {
      let o: any = current;
      for (const k of path) o = o[k];
      return o;
    };
    if (typeof sample[key] === "object" && sample[key] !== null) {
      const nested = view([...path, key]);
      Object.defineProperty(out, key, { enumerable: true, get: () => nested });
    } else {
      Object.defineProperty(out, key, {
        enumerable: true,
        get: () => (version(), at()[key]),
        set: (value) => {
          at()[key] = value;
          changed();
        },
      });
    }
  }
  return out;
}

/** The current theme. Read it inside functions (`color={() => theme.text.secondary}`) to follow changes. */
export const theme: Theme = view([]);

// Color props take theme paths by name: `color="text.secondary"`, resolved when painting.
addColorTokens((name) => atPath(current, name));

/** Switches every widget to `lightTheme`, `darkTheme` or a theme of your own (e.g. `{ ...darkTheme, accent: {...} }`). */
export function setTheme(next: Theme | "light" | "dark") {
  current = structuredClone(next === "light" ? lightTheme : next === "dark" ? darkTheme : next);
  changed();
}

/** "light" or "dark", following setTheme(). */
export const colorScheme = () => theme.scheme;

/**
 * Colors (or any values) of the app's own that follow setTheme like `theme` does: one set per
 * scheme. Color props take them by name (`background="sidebar"`, `color="graph.node"`), resolved
 * when painting, so they switch with the theme without an accessor; an app name wins over a
 * theme path with the same name. The returned object reads them in code, through getters
 * (`() => colors.sidebar` follows the theme). A custom theme takes the set of its `scheme`.
 */
export function createThemeTokens<T extends object>(sets: { light: T; dark: T }): T {
  addColorTokens((name) => atPath(sets[colorScheme()], name));
  const view = (path: string[]): any => {
    const out: Record<string, unknown> = {};
    let sample: any = sets.light;
    for (const k of path) sample = sample[k];
    for (const key of Object.keys(sample)) {
      if (typeof sample[key] === "object" && sample[key] !== null) {
        const nested = view([...path, key]);
        Object.defineProperty(out, key, { enumerable: true, get: () => nested });
        continue;
      }
      Object.defineProperty(out, key, {
        enumerable: true,
        get: () => {
          let o: any = sets[colorScheme()];
          for (const k of path) o = o[k];
          return o[key];
        },
      });
    }
    return out;
  };
  return view([]);
}

// ---- text variants -----------------------------------------------------------------

/** Text styles a `<Text variant>` takes: any style prop (sizes, weight, color or token name...). */
export type TextVariant = Partial<StyleProps>;

const variants: Record<string, TextVariant> = {
  muted: { color: "text.secondary" },
  caption: { fontSize: 12, color: "text.secondary" },
  title: { fontSize: 20, fontWeight: 700 },
};

/**
 * Adds the app's text variants, or replaces built-in ones (`muted`, `caption`, `title`):
 * `defineTextVariants({ label: { fontSize: 12, bold: true, color: "accent.base" } })`, then
 * `<Text variant="label">`. Props given on the Text win over its variant's.
 */
export function defineTextVariants(more: Record<string, TextVariant>) {
  Object.assign(variants, more);
}

/** The styles of variant `name`; an unknown name warns and gives none. */
export function textVariant(name: string): TextVariant {
  const v = variants[name];
  if (!v) console.warn(`nodebuilder: unknown text variant "${name}" (defineTextVariants adds one)`);
  return v ?? {};
}
