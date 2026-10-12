import { createMemo, createSignal } from "@nodebuilderjs/core";

export interface Task {
  id: number;
  title: string;
  done: () => boolean;
  mark: (done: boolean) => void;
}

/**
 * The app state in one place: signals and actions. Each <App /> creates its own (so do the
 * tests), and the components receive it through props.
 */
export function createState() {
  const [clicks, setClicks] = createSignal(0);
  // One point per change, for the activity chart.
  const [history, setHistory] = createSignal<{ step: number; clicks: number; pending: number }[]>([]);
  const [tasks, setTasks] = createSignal<Task[]>([]);
  let nextId = 1;

  const pending = createMemo(() => tasks().filter((t) => !t.done()).length);
  const record = () =>
    setHistory((h) => [...h.slice(-29), { step: h[h.length - 1]!.step + 1, clicks: clicks(), pending: pending() }]);

  const newTask = (title: string): Task => {
    const [done, setDone] = createSignal(false);
    return { id: nextId++, title, done, mark: (v) => (setDone(v), record()) };
  };
  setTasks([newTask("Read the README"), newTask("Write a component")]);
  setHistory([{ step: 0, clicks: 0, pending: pending() }]);

  return {
    clicks,
    history,
    tasks,
    pending,
    click: () => (setClicks((c) => c + 1), record()),
    reset: () => (setClicks(0), record()),
    add: (title: string) => {
      const text = title.trim();
      if (!text) return false;
      setTasks((ts) => [...ts, newTask(text)]);
      record();
      return true;
    },
    clearCompleted: () => (setTasks((ts) => ts.filter((t) => !t.done())), record()),
  };
}

export type State = ReturnType<typeof createState>;
