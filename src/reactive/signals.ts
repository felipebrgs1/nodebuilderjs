// Fine-grained reactivity in the style of SolidJS: signals, effects, memos and
// an ownership tree so that everything created under a scope is disposed with it.

export type Accessor<T> = () => T;
export type Setter<T> = (value: T | ((prev: T) => T)) => T;
export type MaybeAccessor<T> = T | Accessor<T>;

interface Owner {
  owner: Owner | null;
  owned: Owner[];
  cleanups: (() => void)[];
  disposed: boolean;
  /** Values provided to this scope and below (createContext). */
  context?: Record<symbol, unknown>;
  /** Receives errors thrown in this scope and below (catchError, ErrorBoundary). */
  onError?: (error: unknown) => void;
}

interface Computation extends Owner {
  run: () => void;
  sources: Set<SignalState<unknown>>;
}

interface SignalState<T> {
  value: T;
  observers: Set<Computation>;
  equals: (a: T, b: T) => boolean;
}

let currentOwner: Owner | null = null;
let currentListener: Computation | null = null;
let batchDepth = 0;
const pending = new Set<Computation>();

function cleanOwner(owner: Owner) {
  for (const child of owner.owned) disposeOwner(child);
  owner.owned = [];
  const cleanups = owner.cleanups;
  owner.cleanups = [];
  for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!();
  if ("sources" in owner) {
    const c = owner as Computation;
    for (const s of c.sources) s.observers.delete(c);
    c.sources.clear();
  }
}

function disposeOwner(owner: Owner) {
  cleanOwner(owner);
  owner.disposed = true;
  pending.delete(owner as Computation);
}

function execute(c: Computation) {
  cleanOwner(c);
  const prevOwner = currentOwner;
  const prevListener = currentListener;
  currentOwner = c;
  currentListener = c;
  try {
    c.run();
  } catch (error) {
    currentOwner = prevOwner;
    currentListener = prevListener;
    handleError(c.owner, error);
  } finally {
    currentOwner = prevOwner;
    currentListener = prevListener;
  }
}

/** Hands `error` to the nearest scope with a handler, from `owner` up; without one, rethrows. */
function handleError(owner: Owner | null, error: unknown) {
  let o = owner;
  while (o && !o.onError) o = o.owner;
  if (!o) throw error;
  const prevOwner = currentOwner;
  const prevListener = currentListener;
  currentOwner = null;
  currentListener = null;
  // Writes made by the handler wait for the update in progress: whatever it disposes
  // (the failed scope) is not disposed halfway through a computation that is still running.
  batchDepth++;
  try {
    o.onError!(error);
  } finally {
    currentOwner = prevOwner;
    currentListener = prevListener;
    if (--batchDepth === 0) flushPending();
  }
}

function flushPending() {
  // Writes made by the effects below only join the queue: an effect finishes before the
  // ones it triggers run (no re-entrant runs), and an update loop is caught by the guard.
  batchDepth++;
  let guard = 0;
  let failed = false;
  let firstError: unknown;
  try {
    while (pending.size) {
      try {
        do {
          const c = pending.values().next().value!;
          pending.delete(c);
          if (!c.disposed) execute(c);
          if (++guard > 100_000) {
            pending.clear();
            throw new Error("nodebuilder: reactive update loop detected");
          }
        } while (pending.size);
      } catch (error) {
        // An error no scope handled: the rest of the queue still runs, then it is rethrown.
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  } finally {
    batchDepth--;
  }
  if (failed) throw firstError;
}

/** Runs `fn` with all signal writes coalesced; effects run once at the end. */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    if (--batchDepth === 0) flushPending();
  }
}

export function untrack<T>(fn: () => T): T {
  const prev = currentListener;
  currentListener = null;
  try {
    return fn();
  } finally {
    currentListener = prev;
  }
}

export function createSignal<T>(value: T, options?: { equals?: false | ((a: T, b: T) => boolean) }): [Accessor<T>, Setter<T>] {
  const state: SignalState<T> = {
    value,
    observers: new Set(),
    equals: options?.equals === false ? () => false : (options?.equals ?? Object.is),
  };
  const read: Accessor<T> = () => {
    if (currentListener) {
      state.observers.add(currentListener);
      currentListener.sources.add(state as SignalState<unknown>);
    }
    return state.value;
  };
  const write: Setter<T> = (next) => {
    const v = typeof next === "function" ? (next as (prev: T) => T)(state.value) : next;
    if (state.equals(state.value, v)) return state.value;
    state.value = v;
    for (const o of state.observers) pending.add(o);
    if (batchDepth === 0) flushPending();
    return v;
  };
  return [read, write];
}

/** Runs `fn` now and again whenever a signal it read changes. */
export function createEffect<T>(fn: (prev: T | undefined) => T, initial?: T): void {
  let value = initial;
  const c: Computation = {
    owner: currentOwner,
    owned: [],
    cleanups: [],
    disposed: false,
    sources: new Set(),
    run: () => {
      value = fn(value);
    },
  };
  currentOwner?.owned.push(c);
  execute(c);
}

/** A derived, cached value that only notifies when its result changes. */
export function createMemo<T>(fn: (prev: T | undefined) => T, options?: { equals?: false | ((a: T, b: T) => boolean) }): Accessor<T> {
  const [read, write] = createSignal<T>(undefined as T, options);
  createEffect<T>((prev) => {
    const next = fn(prev);
    write(() => next);
    return next;
  });
  return read;
}

/** Creates an ownership scope that lives until `dispose` is called. */
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  // Not owned by the current scope (only `dispose` ends it), but it still sees its context.
  const root: Owner = { owner: currentOwner, owned: [], cleanups: [], disposed: false };
  const prevOwner = currentOwner;
  const prevListener = currentListener;
  currentOwner = root;
  currentListener = null;
  try {
    return fn(() => disposeOwner(root));
  } finally {
    currentOwner = prevOwner;
    currentListener = prevListener;
  }
}

/** Runs `fn` in a new child scope that provides `value` under `id` to everything created inside. */
export function provideContext<T>(id: symbol, value: unknown, fn: () => T): T {
  const scope: Owner = { owner: currentOwner, owned: [], cleanups: [], disposed: false, context: { [id]: value } };
  currentOwner?.owned.push(scope);
  const prevOwner = currentOwner;
  currentOwner = scope;
  try {
    return fn();
  } finally {
    currentOwner = prevOwner;
  }
}

/**
 * Runs `fn` in a new child scope. Errors it throws, and errors thrown later by effects and
 * memos created inside it (when a signal re-runs them), go to `onError` instead of up the
 * stack. Returns `fn`'s result, or undefined if it threw.
 */
export function catchError<T>(fn: (dispose: () => void) => T, onError: (error: unknown) => void): T | undefined {
  const scope: Owner = { owner: currentOwner, owned: [], cleanups: [], disposed: false, onError };
  currentOwner?.owned.push(scope);
  const prevOwner = currentOwner;
  currentOwner = scope;
  try {
    return fn(() => disposeOwner(scope));
  } catch (error) {
    currentOwner = prevOwner;
    handleError(scope, error);
    return undefined;
  } finally {
    currentOwner = prevOwner;
  }
}

/** The value provided under `id` by the nearest enclosing scope, if any. */
export function lookupContext(id: symbol): { value: unknown } | undefined {
  for (let o = currentOwner; o; o = o.owner) if (o.context && id in o.context) return { value: o.context[id] };
  return undefined;
}

/** Registers `fn` to run when the current scope is disposed or re-executed. */
export function onCleanup(fn: () => void): void {
  currentOwner?.cleanups.push(fn);
}

export function read<T>(value: MaybeAccessor<T>): T {
  return typeof value === "function" ? (value as Accessor<T>)() : value;
}
