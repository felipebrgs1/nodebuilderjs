// node:path in the browser build: paths are URLs relative to the page; resolve() keeps them as given.
export const resolve = (...parts: string[]) => parts[parts.length - 1] ?? "";
export const join = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");
export const dirname = (p: string) => p.replace(/\/[^/]*$/, "") || "/";
export const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
