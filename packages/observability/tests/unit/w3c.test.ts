import assert from 'node:assert/strict';
import { W3CTraceContext } from '../../src/tracing/w3c.js';

export async function testW3CTraceContext() {
  console.log('Testing W3CTraceContext...');

  // Valid traceparent parsing
  const rawHeader = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  const parsed = W3CTraceContext.parseTraceParent(rawHeader);
  assert.ok(parsed !== null, 'Valid traceparent must parse successfully');
  assert.equal(parsed.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
  assert.equal(parsed.spanId, '00f067aa0ba902b7');
  assert.equal(parsed.traceFlags, 1);

  // Re-serialization
  const serialized = W3CTraceContext.serializeTraceParent(parsed);
  assert.equal(serialized, rawHeader);

  // Child context creation
  const child = W3CTraceContext.createChildContext(parsed);
  assert.equal(child.traceId, parsed.traceId, 'Child must preserve traceId');
  assert.equal(child.parentSpanId, parsed.spanId, 'Child parentSpanId must match parent spanId');
  assert.notEqual(child.spanId, parsed.spanId, 'Child must generate distinct spanId');

  // Invalid headers
  assert.equal(W3CTraceContext.parseTraceParent('invalid'), null);
  assert.equal(
    W3CTraceContext.parseTraceParent('00-00000000000000000000000000000000-00f067aa0ba902b7-01'),
    null,
    'All-zero traceId must be rejected',
  );

  console.log('✓ W3CTraceContext tests passed');
}
