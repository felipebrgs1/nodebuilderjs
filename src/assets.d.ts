// Bun imports files as their path: `import logo from "./logo.png" with { type: "file" }`.
// With that attribute `bun build --compile` embeds the file, so pass the path to <Image src>.
declare module "*.png" {
  const path: string;
  export default path;
}
