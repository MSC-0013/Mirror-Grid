/**
 * Zero-dependency test harness.
 *
 * `packages/sim` must have no runtime dependencies AND no test-framework dependency —
 * adding vitest here would put a package in the dependency graph of the one package whose
 * standalone purity is enforced in CI. This is ~50 lines and does everything these tests need.
 */
interface TestCase {
  readonly name: string;
  readonly fn: () => void;
}

const suites: Array<{ name: string; cases: TestCase[] }> = [];
let current: { name: string; cases: TestCase[] } | null = null;

export function describe(name: string, fn: () => void): void {
  current = { name, cases: [] };
  suites.push(current);
  fn();
  current = null;
}

export function it(name: string, fn: () => void): void {
  if (!current) throw new Error(`it("${name}") called outside describe()`);
  current.cases.push({ name, fn });
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message ?? 'Values differ'}\n    expected: ${String(expected)}\n    actual:   ${String(actual)}`
    );
  }
}

export function assertClose(
  actual: number,
  expected: number,
  tolerancePct: number,
  message?: string
): void {
  const delta = Math.abs(actual - expected);
  const allowed = Math.abs(expected) * (tolerancePct / 100);
  if (delta > allowed) {
    const pct = expected === 0 ? Infinity : (delta / Math.abs(expected)) * 100;
    throw new Error(
      `${message ?? 'Value out of tolerance'}\n` +
        `    expected: ${expected} (+/-${tolerancePct}%)\n` +
        `    actual:   ${actual} (off by ${pct.toFixed(2)}%)`
    );
  }
}

export function assertThrows(fn: () => unknown, message?: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message ?? 'Expected function to throw, but it did not');
}

export async function runAll(): Promise<void> {
  let passed = 0;
  const failures: Array<{ suite: string; test: string; error: Error }> = [];

  for (const suite of suites) {
    console.log(`\n${suite.name}`);
    for (const testCase of suite.cases) {
      try {
        testCase.fn();
        passed++;
        console.log(`  PASS  ${testCase.name}`);
      } catch (error) {
        failures.push({
          suite: suite.name,
          test: testCase.name,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        console.log(`  FAIL  ${testCase.name}`);
      }
    }
  }

  console.log(`\n${'-'.repeat(60)}`);
  if (failures.length === 0) {
    console.log(`All ${passed} tests passed.`);
    return;
  }

  console.log(`${passed} passed, ${failures.length} FAILED\n`);
  for (const failure of failures) {
    console.log(`${failure.suite} > ${failure.test}`);
    console.log(`  ${failure.error.message}\n`);
  }
  process.exitCode = 1;
}
