// Context, as in SolidJS/React: a value provided by an ancestor and read by any
// component below it, without passing it through every level of props.

import { type Child, type Component, resolve } from "../jsx-runtime.js";
import { createMemo, lookupContext, provideContext } from "./signals.js";

export interface Context<T> {
  readonly id: symbol;
  readonly defaultValue: T;
  readonly Provider: Component<{ value: T; children?: Child }>;
}

/** For a value that changes, provide an accessor (e.g. a signal) and call it where it is used. */
export function createContext<T>(defaultValue: T): Context<T> {
  const id = Symbol("context");
  return {
    id,
    defaultValue,
    // Children are resolved inside the providing scope: jsx() is lazy, so resolving them
    // anywhere else would run their components where the value is not visible.
    Provider: (props) => provideContext(id, props.value, () => createMemo(() => resolve(props.children), { equals: false })),
  };
}

/** Value of the nearest `<context.Provider>` above the calling component, or the default. */
export function useContext<T>(context: Context<T>): T {
  const found = lookupContext(context.id);
  return found ? (found.value as T) : context.defaultValue;
}
