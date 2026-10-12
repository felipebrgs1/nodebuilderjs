// SVG icons (drawn for this template). For more: `bun add lucide-static`, then
// `bun run icons:add play pause` adds their imports below (see the nodebuilder-icons skill).
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const sparkle = svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>');
export const plus = svg('<path d="M12 5v14M5 12h14"/>');
export const list = svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>');
export const chart = svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>');
export const pointer = svg('<path d="M5 3l14 8-6 2-3 6z"/>');
