// node:net in the browser build: no sockets (D-Bus, tray), run() never connects without a bus address.
export type Socket = never;
export function createConnection(): never {
  throw new Error("sockets are not available on the web");
}
