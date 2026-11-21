import * as assert from "assert";
import { createValidityScheduler } from "../../lib/validityScheduler";

/** Manual clock: timers fire only when the test advances time. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer(fn: () => void, ms: number): unknown {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer(handle: unknown): void {
      timers.delete(handle as number);
    },
    advance(ms: number): void {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now && timers.delete(id)) {
          t.fn();
        }
      }
    },
    pending(): number {
      return timers.size;
    },
  };
}

/** A run whose completion the test controls. */
function deferredRuns() {
  const started: string[] = [];
  const resolvers: Array<() => void> = [];
  return {
    started,
    run(key: string): Promise<void> {
      started.push(key);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    },
    finishOldest(): void {
      const r = resolvers.shift();
      assert.ok(r, "no run in flight");
      r();
    },
  };
}

/** Let promise continuations run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe("validityScheduler", () => {
  it("does not run before the delay has elapsed", () => {
    const clock = fakeClock();
    const runs = deferredRuns();
    const s = createValidityScheduler<string>({ delayMs: 100, run: runs.run, ...clock });
    s.schedule("a");
    clock.advance(99);
    assert.deepStrictEqual(runs.started, []);
    clock.advance(1);
    assert.deepStrictEqual(runs.started, ["a"]);
  });

  it("collapses a burst into one trailing run", () => {
    const clock = fakeClock();
    const runs = deferredRuns();
    const s = createValidityScheduler<string>({ delayMs: 100, run: runs.run, ...clock });
    for (let i = 0; i < 10; i++) {
      s.schedule("a");
      clock.advance(50);
    }
    assert.deepStrictEqual(runs.started, []);
    assert.strictEqual(clock.pending(), 1);
    clock.advance(50);
    assert.deepStrictEqual(runs.started, ["a"]);
  });

  it("runs once more after a run when changes arrived during it", async () => {
    const clock = fakeClock();
    const runs = deferredRuns();
    const s = createValidityScheduler<string>({ delayMs: 100, run: runs.run, ...clock });
    s.schedule("a");
    clock.advance(100);
    assert.strictEqual(runs.started.length, 1);

    // Three edits while the first run is in flight, then the debounce elapses.
    s.schedule("a");
    s.schedule("a");
    s.schedule("a");
    clock.advance(100);
    assert.strictEqual(runs.started.length, 1, "never two runs at once");

    runs.finishOldest();
    await settle();
    assert.strictEqual(runs.started.length, 2, "exactly one follow-up run");

    runs.finishOldest();
    await settle();
    assert.strictEqual(runs.started.length, 2);
    assert.strictEqual(s.isBusy("a"), false);
  });

  it("still debounces a change that arrives during a run that ends early", async () => {
    const clock = fakeClock();
    const runs = deferredRuns();
    const s = createValidityScheduler<string>({ delayMs: 100, run: runs.run, ...clock });
    s.schedule("a");
    clock.advance(100);
    s.schedule("a"); // during run 1
    runs.finishOldest(); // run 1 ends before the debounce elapses
    await settle();
    assert.strictEqual(runs.started.length, 1);
    clock.advance(100);
    assert.strictEqual(runs.started.length, 2);
  });

  it("does not run again when nothing changed during a run", async () => {
    const clock = fakeClock();
    const runs = deferredRuns();
    const s = createValidityScheduler<string>({ delayMs: 100, run: runs.run, ...clock });
    s.schedule("a");
    clock.advance(100);
    runs.finishOldest();
    await settle();
    clock.advance(1000);
    assert.strictEqual(runs.started.length, 1);
    assert.strictEqual(s.isBusy("a"), false);
  });

  it("keeps documents independent", () => {
    const clock = fakeClock();
    const runs = deferredRuns();
    const s = createValidityScheduler<string>({ delayMs: 100, run: runs.run, ...clock });
    s.schedule("a");
    clock.advance(60);
    s.schedule("b");
    clock.advance(40);
    assert.deepStrictEqual(runs.started, ["a"]);
    clock.advance(60);
    assert.deepStrictEqual(runs.started, ["a", "b"], "b runs while a is in flight");
  });

  it("cancel drops a pending debounce and a pending follow-up", async () => {
    const clock = fakeClock();
    const runs = deferredRuns();
    const s = createValidityScheduler<string>({ delayMs: 100, run: runs.run, ...clock });
    s.schedule("a");
    s.cancel("a");
    clock.advance(500);
    assert.deepStrictEqual(runs.started, []);
    assert.strictEqual(clock.pending(), 0);

    s.schedule("a");
    clock.advance(100);
    s.schedule("a");
    clock.advance(100); // follow-up now due
    s.cancel("a");
    runs.finishOldest();
    await settle();
    assert.strictEqual(runs.started.length, 1);
    assert.strictEqual(s.isBusy("a"), false);
  });

  it("cancelAll drops pending work but the scheduler stays usable", () => {
    const clock = fakeClock();
    const runs = deferredRuns();
    const s = createValidityScheduler<string>({ delayMs: 100, run: runs.run, ...clock });
    s.schedule("a");
    s.schedule("b");
    s.cancelAll();
    clock.advance(500);
    assert.deepStrictEqual(runs.started, []);
    s.schedule("a");
    clock.advance(100);
    assert.deepStrictEqual(runs.started, ["a"]);
  });

  it("survives a failing run: reports it and keeps scheduling", async () => {
    const clock = fakeClock();
    const errors: unknown[] = [];
    let calls = 0;
    const s = createValidityScheduler<string>({
      delayMs: 100,
      run: () => {
        calls++;
        return Promise.reject(new Error("boom"));
      },
      onError: (e) => errors.push(e),
      ...clock,
    });
    s.schedule("a");
    clock.advance(100);
    await settle();
    assert.strictEqual(errors.length, 1);
    s.schedule("a");
    clock.advance(100);
    await settle();
    assert.strictEqual(calls, 2);
  });

  it("also survives a run that throws synchronously", async () => {
    const clock = fakeClock();
    const errors: unknown[] = [];
    const s = createValidityScheduler<string>({
      delayMs: 100,
      run: () => {
        throw new Error("sync boom");
      },
      onError: (e) => errors.push(e),
      ...clock,
    });
    s.schedule("a");
    clock.advance(100);
    await settle();
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(s.isBusy("a"), false);
  });

  describe("runExclusive", () => {
    it("runs immediately when idle, replaces the pending debounce, returns the result", async () => {
      const clock = fakeClock();
      const runs = deferredRuns();
      const s = createValidityScheduler<string>({ delayMs: 100, run: runs.run, ...clock });
      s.schedule("a");
      const result = await s.runExclusive("a", () => 42);
      assert.strictEqual(result, 42);
      clock.advance(500);
      assert.deepStrictEqual(runs.started, [], "the explicit run covered the pending change");
    });

    it("waits for the run in flight instead of overlapping it", async () => {
      const clock = fakeClock();
      const runs = deferredRuns();
      const s = createValidityScheduler<string>({ delayMs: 100, run: runs.run, ...clock });
      s.schedule("a");
      clock.advance(100);
      let explicitStarted = false;
      const p = s.runExclusive("a", () => {
        explicitStarted = true;
        return "done";
      });
      await settle();
      assert.strictEqual(explicitStarted, false);
      runs.finishOldest();
      assert.strictEqual(await p, "done");
      assert.strictEqual(explicitStarted, true);
    });

    it("a change during the explicit run still gets its own run afterwards", async () => {
      const clock = fakeClock();
      const runs = deferredRuns();
      const s = createValidityScheduler<string>({ delayMs: 100, run: runs.run, ...clock });
      let finishExplicit!: () => void;
      const p = s.runExclusive(
        "a",
        () => new Promise<void>((resolve) => (finishExplicit = resolve))
      );
      s.schedule("a");
      clock.advance(100);
      assert.deepStrictEqual(runs.started, []);
      finishExplicit();
      await p;
      await settle();
      assert.deepStrictEqual(runs.started, ["a"]);
    });

    it("propagates a rejection to the caller and frees the key", async () => {
      const clock = fakeClock();
      const runs = deferredRuns();
      const errors: unknown[] = [];
      const s = createValidityScheduler<string>({
        delayMs: 100,
        run: runs.run,
        onError: (e) => errors.push(e),
        ...clock,
      });
      await assert.rejects(
        s.runExclusive("a", () => Promise.reject(new Error("nope"))),
        /nope/
      );
      await settle();
      assert.strictEqual(errors.length, 0, "the caller got it; not reported twice");
      assert.strictEqual(s.isBusy("a"), false);
    });
  });

  it("defaults to the real timers", (done) => {
    const s = createValidityScheduler<string>({
      delayMs: 1,
      run: () => {
        done();
      },
    });
    s.schedule("a");
  });

  it("reads a delay function on every schedule()", () => {
    const clock = fakeClock();
    const runs = deferredRuns();
    let delay = 100;
    const s = createValidityScheduler<string>({
      delayMs: () => delay,
      run: runs.run,
      ...clock,
    });
    s.schedule("a");
    // A countdown already started keeps the delay it was started with.
    delay = 1000;
    clock.advance(100);
    assert.deepStrictEqual(runs.started, ["a"]);
    s.schedule("b");
    clock.advance(999);
    assert.deepStrictEqual(runs.started, ["a"]);
    clock.advance(1);
    assert.deepStrictEqual(runs.started, ["a", "b"]);
  });

  it("re-scheduling during a run (profile switch) yields exactly one more run", async () => {
    const clock = fakeClock();
    const runs = deferredRuns();
    const s = createValidityScheduler<string>({ delayMs: 100, run: runs.run, ...clock });
    s.schedule("a");
    clock.advance(100);
    // Two profile events while TestPit is still running.
    s.schedule("a");
    s.schedule("a");
    clock.advance(100);
    assert.deepStrictEqual(runs.started, ["a"]);
    runs.finishOldest();
    await settle();
    assert.deepStrictEqual(runs.started, ["a", "a"]);
    runs.finishOldest();
    await settle();
    assert.deepStrictEqual(runs.started, ["a", "a"]);
    assert.strictEqual(s.isBusy("a"), false);
  });
});
