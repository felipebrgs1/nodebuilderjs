import { createMemo, createSignal } from "@nodebuilderjs/core";

export interface Tarefa {
  id: number;
  titulo: string;
  feita: () => boolean;
  marcar: (feita: boolean) => void;
}

/**
 * O estado do app em um lugar só: signals e ações. Cada <App /> cria o seu (os testes
 * também), e os componentes o recebem por props.
 */
export function criarEstado() {
  const [cliques, setCliques] = createSignal(0);
  // Um ponto por mudança, para o gráfico de atividade.
  const [historico, setHistorico] = createSignal<{ passo: number; cliques: number; pendentes: number }[]>([]);
  const [tarefas, setTarefas] = createSignal<Tarefa[]>([]);
  let proximoId = 1;

  const pendentes = createMemo(() => tarefas().filter((t) => !t.feita()).length);
  const registrar = () =>
    setHistorico((h) => [...h.slice(-29), { passo: h[h.length - 1]!.passo + 1, cliques: cliques(), pendentes: pendentes() }]);

  const novaTarefa = (titulo: string): Tarefa => {
    const [feita, setFeita] = createSignal(false);
    return { id: proximoId++, titulo, feita, marcar: (v) => (setFeita(v), registrar()) };
  };
  setTarefas([novaTarefa("Ler o README"), novaTarefa("Criar um componente")]);
  setHistorico([{ passo: 0, cliques: 0, pendentes: pendentes() }]);

  return {
    cliques,
    historico,
    tarefas,
    pendentes,
    clicar: () => (setCliques((c) => c + 1), registrar()),
    zerar: () => (setCliques(0), registrar()),
    adicionar: (titulo: string) => {
      const texto = titulo.trim();
      if (!texto) return false;
      setTarefas((ts) => [...ts, novaTarefa(texto)]);
      registrar();
      return true;
    },
    limparConcluidas: () => (setTarefas((ts) => ts.filter((t) => !t.feita())), registrar()),
  };
}

export type Estado = ReturnType<typeof criarEstado>;
