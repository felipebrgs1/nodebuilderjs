// node:fs in the browser build: the app's files (imports `with { type: "file" }`) are fetched
// before the app starts (boot.ts) and read from memory, so synchronous reads keep working.

export const files = new Map<string, Uint8Array>();

/** The key of a path or URL: absolute against the page, so "./a.png" and "/a.png" meet. */
export const fileKey = (path: string | URL) => new URL(String(path), globalThis.location?.href ?? "http://localhost/").href;

export function readFileSync(path: string | URL, encoding?: string | { encoding?: string }): any {
  const bytes = files.get(fileKey(path));
  if (!bytes) throw Object.assign(new Error(`ENOENT: no such file (on the web, only files imported with { type: "file" } exist): ${path}`), { code: "ENOENT" });
  const enc = typeof encoding === "string" ? encoding : encoding?.encoding;
  return enc ? new TextDecoder().decode(bytes) : bytes;
}

export const existsSync = (path: string | URL) => files.has(fileKey(path));

export function writeFileSync(): never {
  throw new Error("writeFileSync is not available on the web");
}
