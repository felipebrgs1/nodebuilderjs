// <ErrorBoundary>, mirroring SolidJS: shows a fallback instead of children that threw.

import { type Child, render } from "../jsx-runtime.js";
import { catchError, createMemo, createSignal, untrack } from "./signals.js";

/**
 * Catches errors thrown while creating the children and later by their effects and memos
 * (when a signal re-runs them), disposes the children and shows `fallback`. A fallback
 * function with parameters gets the error and `reset`, which renders the children again.
 * Event handlers (onClick...) are not covered: what they throw reaches whoever called them,
 * but the effects re-run by the signals they write are.
 */
export function ErrorBoundary(props: {
  fallback: Child | ((error: unknown, reset: () => void) => Child);
  children?: Child;
}): Child {
  let failure: { error: unknown } | undefined;
  const [attempt, setAttempt] = createSignal(0);
  const retry = () => setAttempt((n) => n + 1);
  const reset = () => {
    if (!failure) return;
    failure = undefined;
    retry();
  };

  const showFallback = (error: unknown) => {
    const fallback = props.fallback;
    return render(typeof fallback === "function" && fallback.length > 0 ? fallback(error, reset) : (fallback as Child));
  };

  const showChildren = () => {
    let building = true;
    let dispose = () => {};
    const nodes = catchError(
      (d) => {
        dispose = d;
        return render(props.children);
      },
      (error) => {
        if (failure) return; // the first error wins until reset
        failure = { error };
        // While building, the check below handles it; later, the content is swapped on the next run.
        if (!building) retry();
      },
    );
    building = false;
    if (!failure) return nodes!;
    dispose();
    return showFallback(failure.error);
  };

  // Re-runs only on a new attempt (an error after building, or reset): changes inside the
  // children never rebuild them.
  const content = createMemo(() => {
    attempt();
    return untrack(() => (failure ? showFallback(failure.error) : showChildren()));
  });
  return () => content()();
}
