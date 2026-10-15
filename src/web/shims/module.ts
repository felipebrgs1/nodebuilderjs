// node:module in the browser build: the addon loader is never used (boot.ts installs the web native).
export function createRequire(): never {
  throw new Error("require is not available on the web");
}
