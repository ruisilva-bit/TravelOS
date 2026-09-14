export type WorkerProcessState = "RUNNING" | "STOPPED";

export interface WorkerProcess {
  readonly state: () => WorkerProcessState;
  readonly shutdown: () => Promise<void>;
}

export const bootstrapWorkerProcess = (): WorkerProcess => {
  let currentState: WorkerProcessState = "RUNNING";

  return {
    state: () => currentState,
    shutdown: async () => {
      currentState = "STOPPED";
      await Promise.resolve();
    },
  };
};
