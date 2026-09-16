import assert from 'node:assert';
import {
  GENESIS_HASH,
  computeRecordHash,
  verifyHashChain,
  type VerifiableAuditRecord,
} from '../../src/audit/hash-chain.js';

export async function testHashChain() {
  console.log('Testing Cryptographic Audit Hash Chain...');

  // 1. Generate 100 consecutive records
  const records: VerifiableAuditRecord[] = [];
  let prevHash = GENESIS_HASH;
  const baseTime = 1700000000000;

  for (let i = 1; i <= 100; i++) {
    const timestamp = baseTime + i * 1000;
    const diffJson = { counter: i, detail: `Step ${i}` };
    const recordHash = computeRecordHash({
      prevHash,
      seqNum: i,
      timestamp,
      userId: `user-${i % 5}`,
      action: i % 2 === 0 ? 'FAULT_INJECT' : 'TOPOLOGY_UPDATE',
      resourceType: 'WORLD',
      resourceId: 'world-01',
      diff: diffJson,
    });

    records.push({
      seqNum: i,
      prevHash,
      recordHash,
      userId: `user-${i % 5}`,
      userEmail: `user-${i % 5}@mirrorgrid.io`,
      action: i % 2 === 0 ? 'FAULT_INJECT' : 'TOPOLOGY_UPDATE',
      resourceType: 'WORLD',
      resourceId: 'world-01',
      diffJson,
      createdAt: timestamp,
    });

    prevHash = recordHash;
  }

  // Verify intact chain
  const result = verifyHashChain(records);
  assert.strictEqual(result.valid, true, 'Intact chain must be 100% valid');
  assert.strictEqual(result.totalRecords, 100, 'Total records verified must be 100');
  console.log('✓ 100 records in chain mathematically verified intact.');

  // 2. Tamper with record #42 diff payload
  const tamperedRecords: VerifiableAuditRecord[] = records.map((r) => ({
    ...r,
    diffJson: { ...(r.diffJson as Record<string, unknown>) },
  }));
  tamperedRecords[41] = {
    ...tamperedRecords[41],
    diffJson: { counter: 42, detail: 'HACKED / TAMPERED' },
  };

  const tamperResult = verifyHashChain(tamperedRecords);
  assert.strictEqual(tamperResult.valid, false, 'Tampered chain must be rejected');
  assert.strictEqual(tamperResult.brokenSeq, 42, 'Tamper must be detected at sequence #42');
  console.log('✓ Tamper detection correctly flagged corrupted record at sequence #42.');

  // 3. Delete record #15 (gap in sequence)
  const deletedRecords = records.filter((r) => r.seqNum !== 15);
  const gapResult = verifyHashChain(deletedRecords);
  assert.strictEqual(gapResult.valid, false, 'Sequence gap must be rejected');
  assert.strictEqual(gapResult.brokenSeq, 16, 'Gap must be detected at sequence #16');
  console.log('✓ Deleted record correctly detected as discontinuous gap.');
}
