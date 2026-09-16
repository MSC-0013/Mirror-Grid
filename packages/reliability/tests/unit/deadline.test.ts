import assert from 'node:assert';
import { DeadlineContext, DEADLINE_HEADER } from '../../src/core/deadline.js';
import { DeadlineInterceptor } from '../../src/shell/deadline-interceptor.js';

function testDeadline() {
  console.log('Testing DeadlineContext and DeadlineInterceptor...');

  const now = 5_000_000n;
  const ctx = new DeadlineContext(now + 2_000_000n); // 2s remaining

  assert.strictEqual(ctx.isExpired(now), false);
  assert.strictEqual(ctx.remainingMicros(now), 2_000_000n);
  assert.strictEqual(ctx.isExpired(now + 2_500_000n), true);

  // Preemptive shedding
  assert.strictEqual(
    ctx.shouldShedPreemptively(now, 3_000_000n),
    true,
    'Expected latency 3s > remaining 2s should trigger preemptive shed',
  );
  assert.strictEqual(
    ctx.shouldShedPreemptively(now, 1_000_000n),
    false,
    'Expected latency 1s < remaining 2s should proceed',
  );

  // Interceptor
  const mockClock = { nowMicros: () => now };
  const interceptor = new DeadlineInterceptor(mockClock);

  // Expired header throws DeadlineExceededError
  const expiredHeaders = { [DEADLINE_HEADER]: (now - 100n).toString() };
  assert.throws(
    () => interceptor.verify(expiredHeaders),
    (err: unknown) => (err as { code: string }).code === 'DEADLINE_EXCEEDED',
  );

  console.log('✓ Deadline tests passed.');
}

testDeadline();
