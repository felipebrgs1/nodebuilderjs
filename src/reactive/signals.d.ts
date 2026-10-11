export type Accessor<T> = () => T;
export type Setter<T> = (value: T | ((prev: T) => T)) => T;
export type MaybeAccessor<T> = T | Accessor<T>;
/** Runs `fn` with all signal writes coalesced; effects run once at the end. */
export declare function batch<T>(fn: () => T): T;
export declare function untrack<T>(fn: () => T): T;
export declare function createSignal<T>(value: T, options?: {
    equals?: false | ((a: T, b: T) => boolean);
}): [Accessor<T>, Setter<T>];
/** Runs `fn` now and again whenever a signal it read changes. */
export declare function createEffect<T>(fn: (prev: T | undefined) => T, initial?: T): void;
/** A derived, cached value that only notifies when its result changes. */
export declare function createMemo<T>(fn: (prev: T | undefined) => T, options?: {
    equals?: false | ((a: T, b: T) => boolean);
}): Accessor<T>;
/** Creates an ownership scope that lives until `dispose` is called. */
export declare function createRoot<T>(fn: (dispose: () => void) => T): T;
/** Registers `fn` to run when the current scope is disposed or re-executed. */
export declare function onCleanup(fn: () => void): void;
export declare function read<T>(value: MaybeAccessor<T>): T;
