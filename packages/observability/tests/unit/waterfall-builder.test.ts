import assert from 'node:assert/strict';
import { TraceWaterfallBuilder } from '../../src/tracing/waterfall-builder.js';
import type { SpanData } from '../../src/tracing/span-collector.js';

export async function testWaterfallBuilder() {
  console.log('Testing TraceWaterfallBuilder...');

  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  const worldId = 'test-world-uuid';

  const spans: SpanData[] = [
    {
      worldId,
      traceId,
      spanId: 'root-span-1',
      serviceName: 'gateway',
      operationName: 'POST /checkout',
      startTimeMicros: 1000,
      durationMicros: 5000,
      statusCode: 'OK',
      attributes: {},
    },
    {
      worldId,
      traceId,
      spanId: 'child-span-1',
      parentSpanId: 'root-span-1',
      serviceName: 'orders',
      operationName: 'createOrder',
      startTimeMicros: 1500,
      durationMicros: 3500,
      statusCode: 'OK',
      attributes: {},
    },
    {
      worldId,
      traceId,
      spanId: 'grandchild-span-1',
      parentSpanId: 'child-span-1',
      serviceName: 'payments',
      operationName: 'chargeCard',
      startTimeMicros: 2000,
      durationMicros: 2800,
      statusCode: 'OK',
      attributes: {},
    },
  ];

  // Shuffle spans to ensure order-independence
  const shuffled = [spans[1], spans[2], spans[0]];
  const detail = TraceWaterfallBuilder.buildWaterfall(shuffled);

  assert.equal(detail.traceId, traceId);
  assert.equal(detail.spanCount, 3);
  assert.equal(detail.serviceCount, 3);
  assert.equal(detail.rootSpan.spanId, 'root-span-1');
  assert.equal(detail.rootSpan.children.length, 1);
  assert.equal(detail.rootSpan.children[0].spanId, 'child-span-1');
  assert.equal(detail.rootSpan.children[0].children.length, 1);
  assert.equal(detail.rootSpan.children[0].children[0].spanId, 'grandchild-span-1');

  // Critical path should contain all 3 spans
  assert.equal(detail.rootSpan.isCriticalPath, true);
  assert.equal(detail.rootSpan.children[0].isCriticalPath, true);
  assert.equal(detail.rootSpan.children[0].children[0].isCriticalPath, true);

  console.log('✓ TraceWaterfallBuilder tests passed');
}
