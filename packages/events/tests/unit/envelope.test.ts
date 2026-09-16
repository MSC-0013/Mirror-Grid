import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DomainEventEnvelopeSchema } from '../../src/schemas/event-envelope.js';

export async function testEnvelopeSchema() {
  console.log('Testing DomainEventEnvelopeSchema...');

  const validEnvelope = {
    id: crypto.randomUUID(),
    worldId: crypto.randomUUID(),
    aggregateType: 'CIRCUIT_BREAKER',
    aggregateId: 'edge-alpha-beta',
    eventType: 'CIRCUIT_TRIPPED',
    partitionKey: 'world-1',
    sequenceNum: 1,
    payload: {
      state: 'OPEN',
      failureRatePpm: 600000,
    },
    headers: {
      correlationId: crypto.randomUUID(),
      actorEmail: 'admin@mirrorgrid.local',
    },
    timestamp: new Date(),
  };

  const parsed = DomainEventEnvelopeSchema.safeParse(validEnvelope);
  assert.equal(parsed.success, true, 'Valid envelope should pass schema validation');

  // Negative validation: invalid UUID
  const invalidEnvelope = {
    ...validEnvelope,
    id: 'invalid-uuid-string',
  };
  const invalidParsed = DomainEventEnvelopeSchema.safeParse(invalidEnvelope);
  assert.equal(invalidParsed.success, false, 'Invalid UUID should fail schema validation');

  console.log('✓ DomainEventEnvelopeSchema tests passed');
}
