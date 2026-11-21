// Scheduling for the (heavy) TestPit.exe validity check. vscode-free.
//
// Per key (one key per document):
//   - trailing debounce: a burst of schedule() calls yields ONE run, `delayMs`
//     after the last call;
//   - never two runs at once: if the debounce elapses while a run is still in
//     flight, exactly one more run starts as soon as that run ends — so the
//     text validated last is always the final text;
//   - runExclusive() slots an explicit, caller-supplied run (the "Run Validity
//     Check" command) into the same queue, so it never overlaps a live run for
//     the same document (both use the same temp file).
// Keys are independent of each other.

export type TimerHandle = unknown;

export interface ValiditySchedulerOptions<K> {
  /**
   * Quiet period after the last schedule() before the run starts. A function
   * is read on every schedule(), so a changed setting applies to the next
   * change without re-creating the scheduler (a debounce already counting
   * down keeps the delay it was started with).
   */
  delayMs: number | (() => number);
  /** The debounced run. Rejections are routed to onError, never thrown. */
  run: (key: K) => Promise<void> | void;
  /** Injectable for tests; default to the global timers. */
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  onError?: (error: unknown, key: K) => void;
}

export interface ValidityScheduler<K> {
  /** Note a change: (re)start the debounce for this key. */
  schedule(key: K): void;
  /**
   * Run `fn` for this key now — or right after the run in flight. It replaces
   * any debounced run that was pending when it was requested (`fn` is expected
   * to validate the current text). Changes scheduled while it waits or runs
   * still get their own run afterwards.
   */
  runExclusive<T>(key: K, fn: () => Promise<T> | T): Promise<T>;
  /** Drop pending work for a key (document closed). A run in flight finishes. */
  cancel(key: K): void;
  /** True while a run is in flight or pending for the key. */
  isBusy(key: K): boolean;
  /** Drop pending work for every key. Runs in flight finish. */
  cancelAll(): void;
}

interface KeyState {
  timer: TimerHandle | undefined;
  running: boolean;
  /** The debounce elapsed during a run: run once more when it ends. */
  due: boolean;
  queue: Array<() => Promise<void>>;
}

export function createValidityScheduler<K>(
  options: ValiditySchedulerOptions<K>
): ValidityScheduler<K> {
  const setTimer =
    options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle: TimerHandle) => clearTimeout(handle as NodeJS.Timeout));
  const states = new Map<K, KeyState>();
  const currentDelay = (): number =>
    typeof options.delayMs === "function" ? options.delayMs() : options.delayMs;

  function stateFor(key: K): KeyState {
    let state = states.get(key);
    if (!state) {
      state = { timer: undefined, running: false, due: false, queue: [] };
      states.set(key, state);
    }
    return state;
  }

  function stopTimer(state: KeyState): void {
    if (state.timer !== undefined) {
      clearTimer(state.timer);
      state.timer = undefined;
    }
  }

  function start(key: K, state: KeyState, job: () => Promise<void>): void {
    state.running = true;
    job().then(
      () => finished(key, state),
      (error) => {
        options.onError?.(error, key);
        finished(key, state);
      }
    );
  }

  function finished(key: K, state: KeyState): void {
    state.running = false;
    const next = state.queue.shift();
    if (next) {
      start(key, state, next);
    } else if (state.due) {
      state.due = false;
      start(key, state, liveJob(key));
    } else if (state.timer === undefined && states.get(key) === state) {
      states.delete(key);
    }
  }

  function liveJob(key: K): () => Promise<void> {
    return async () => {
      await options.run(key);
    };
  }

  function schedule(key: K): void {
    const state = stateFor(key);
    stopTimer(state);
    state.timer = setTimer(() => {
      state.timer = undefined;
      if (state.running) {
        state.due = true;
      } else {
        start(key, state, liveJob(key));
      }
    }, currentDelay());
  }

  function runExclusive<T>(key: K, fn: () => Promise<T> | T): Promise<T> {
    const state = stateFor(key);
    // fn validates the current text, so whatever was pending is covered.
    stopTimer(state);
    state.due = false;
    return new Promise<T>((resolve, reject) => {
      const job = async (): Promise<void> => {
        try {
          resolve(await fn());
        } catch (error) {
          reject(error);
        }
      };
      if (state.running) {
        state.queue.push(job);
      } else {
        start(key, state, job);
      }
    });
  }

  function cancel(key: K): void {
    const state = states.get(key);
    if (!state) {
      return;
    }
    stopTimer(state);
    state.due = false;
    // Explicit runs still queued keep their place: their callers await them.
    if (!state.running && state.queue.length === 0) {
      states.delete(key);
    }
  }

  return {
    schedule,
    runExclusive,
    cancel,
    isBusy(key: K): boolean {
      const state = states.get(key);
      return (
        !!state &&
        (state.running || state.due || state.timer !== undefined || state.queue.length > 0)
      );
    },
    cancelAll(): void {
      for (const key of [...states.keys()]) {
        cancel(key);
      }
    },
  };
}
