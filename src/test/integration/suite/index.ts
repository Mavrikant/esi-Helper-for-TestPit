/**
 * Entry point VS Code loads inside the extension host (`extensionTestsPath`).
 *
 * A deliberately tiny sequential runner instead of Mocha: the repository's
 * Mocha (12.x) is an ES module, and loading it from this CommonJS output
 * inside the extension host would add a module-loading dependency the suite
 * does not need. Each case is a named async function; the run rejects when
 * any of them throws, which makes the host exit non-zero.
 */
import { cases } from "./providers.cases";

export async function run(): Promise<void> {
  const failures: string[] = [];
  for (const testCase of cases) {
    const started = Date.now();
    try {
      await testCase.run();
      console.log(`  ok   ${testCase.name} (${Date.now() - started} ms)`);
    } catch (err) {
      const detail = err instanceof Error ? err.stack ?? err.message : String(err);
      console.error(`  FAIL ${testCase.name}\n${detail}`);
      failures.push(testCase.name);
    }
  }
  console.log(
    `  ${cases.length - failures.length} passing, ${failures.length} failing`
  );
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} integration case(s) failed: ${failures.join("; ")}`
    );
  }
}
