// node:url in the browser build: file URLs are just URLs there.
export const fileURLToPath = (url: string | URL) => (typeof url === "string" ? new URL(url) : url).href;
export const pathToFileURL = (path: string) => new URL(path, globalThis.location?.href);
