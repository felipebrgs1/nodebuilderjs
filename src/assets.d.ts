// Bun imports files as their path: `import logo from "./logo.png" with { type: "file" }`.
// With that attribute `bun build --compile` embeds the file, so pass the path to <Image src>.
declare module "*.png" {
  const path: string;
  export default path;
}
declare module "*.jpg" {
  const path: string;
  export default path;
}
declare module "*.jpeg" {
  const path: string;
  export default path;
}
declare module "*.webp" {
  const path: string;
  export default path;
}
declare module "*.avif" {
  const path: string;
  export default path;
}
declare module "*.heic" {
  const path: string;
  export default path;
}
declare module "*.svg" {
  /** The file's path with `with { type: "file" }`, its markup with `with { type: "text" }`. */
  const value: string;
  export default value;
}
