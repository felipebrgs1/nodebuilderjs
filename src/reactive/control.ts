// Conditional components, mirroring SolidJS: <Show>, <Switch>/<Match>.

import { type Child, type ElementDesc, isElement } from "../jsx-runtime.js";
import { type Accessor, type MaybeAccessor, createMemo, read, untrack } from "./signals.js";

type Falsy = false | 0 | "" | null | undefined;

/**
 * Content of <Show>/<Match>: nodes, or a function with a parameter that gets the (truthy)
 * value as an accessor. A function without parameters stays a reactive child, as anywhere.
 */
export type ConditionalChildren<T> = Child | ((value: Accessor<Exclude<T, Falsy>>) => Child);

/** Runs a callback child (like a component body: untracked) or passes content through. */
function content<T>(children: ConditionalChildren<T> | undefined, when: MaybeAccessor<T>): Child {
  if (typeof children !== "function" || children.length === 0) return children as Child;
  // Keeps the last truthy value: rows reading it may run once more before the branch is
  // disposed, and they should not see the falsy value that is about to hide them.
  let last: Exclude<T, Falsy>;
  const value = () => {
    const v = read(when);
    if (v) last = v as Exclude<T, Falsy>;
    return last;
  };
  return untrack(() => children(value));
}

export function Show<T>(props: { when: MaybeAccessor<T>; fallback?: Child; children?: ConditionalChildren<T> }): Child {
  const visible = createMemo(() => !!read(props.when));
  return () => (visible() ? content(props.children, props.when) : props.fallback);
}

interface MatchProps<T> {
  when: MaybeAccessor<T>;
  children?: ConditionalChildren<T>;
}

/** Shows the first <Match> whose `when` holds; its content is recreated only when that choice changes. */
export function Switch(props: { fallback?: Child; children?: Child }): Child {
  const matches = matchesOf(props.children);
  const selected = createMemo(() => matches.findIndex((m) => read(m.when)));
  return () => {
    const i = selected();
    return i < 0 ? props.fallback : content(matches[i]!.children, matches[i]!.when);
  };
}

/** A branch of <Switch>. It is read by the Switch, never rendered on its own. */
export function Match<T>(_props: MatchProps<T>): Child {
  throw new Error("nodebuilder: <Match> must be a direct child of <Switch>");
}

// The children are still descriptions (jsx() is lazy), so the Switch reads each Match's
// props without running anything: content of a Match that never wins is never created.
function matchesOf(children: Child, out: MatchProps<unknown>[] = []): MatchProps<unknown>[] {
  if (children == null || typeof children === "boolean") return out;
  if (Array.isArray(children)) for (const c of children) matchesOf(c, out);
  else if (isElement(children) && children.type === Match) out.push((children as ElementDesc).props as unknown as MatchProps<unknown>);
  else throw new Error("nodebuilder: <Switch> only takes <Match> children");
  return out;
}
