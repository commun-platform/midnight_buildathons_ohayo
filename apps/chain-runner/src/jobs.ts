import type { ReadingOutcome, RunnerJob } from '@midnight-demo/ingester-core';

export class JobBusyError extends Error {}

export interface JobRegistry {
  readonly running: string | null;
  readonly stage: string | null;
  setStage(stage: string): void;
  start(jobId: string, work: () => Promise<ReadingOutcome[]>): 'started' | 'exists';
  get(jobId: string): RunnerJob;
  abort(error: string): void;
  settled(): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function jobRegistry(keep = 20): JobRegistry {
  const jobs = new Map<string, RunnerJob>();
  let running: string | null = null;
  let stage: string | null = null;
  let current: Promise<void> = Promise.resolve();

  function trim(): void {
    for (const id of jobs.keys()) {
      if (jobs.size <= keep) return;
      if (id !== running) jobs.delete(id);
    }
  }

  return {
    get running() {
      return running;
    },
    get stage() {
      return stage;
    },
    setStage(next) {
      stage = next;
      if (running) jobs.set(running, { state: 'running', stage: next });
    },
    start(jobId, work) {
      if (jobs.has(jobId)) return 'exists';
      if (running) throw new JobBusyError(`job ${running} is still running`);
      running = jobId;
      stage = 'starting';
      jobs.set(jobId, { state: 'running', stage });
      current = Promise.resolve()
        .then(work)
        .then(
          (outcomes) => {
            if (running === jobId) jobs.set(jobId, { state: 'done', outcomes });
          },
          (error: unknown) => {
            if (running === jobId) jobs.set(jobId, { state: 'failed', error: errorMessage(error) });
          },
        )
        .finally(() => {
          if (running !== jobId) return;
          running = null;
          stage = null;
          trim();
        });
      return 'started';
    },
    get(jobId) {
      return jobs.get(jobId) ?? { state: 'unknown' };
    },
    abort(error) {
      if (!running) return;
      jobs.set(running, { state: 'failed', error });
      running = null;
      stage = null;
      trim();
    },
    settled() {
      return current;
    },
  };
}
