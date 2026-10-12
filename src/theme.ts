// Default look (light). Widgets read from here; apps may mutate it before run().
export const theme = {
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
  /** Opacity of disabled controls. */
  disabledOpacity: 0.45,
  /** Overlay scrollbars: a thin thumb that widens (to `hoverSize`) under the pointer. */
  scrollbar: { thumb: "#00000040", hover: "#00000066", pressed: "#00000080", track: "#0000000f", size: 4, hoverSize: 8, margin: 3, minThumb: 24 },
};
