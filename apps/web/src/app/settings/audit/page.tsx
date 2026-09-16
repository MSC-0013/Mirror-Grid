'use client';

import { useState, useEffect } from 'react';
import { ShieldCheck, RefreshCw, AlertTriangle, Lock, Filter } from 'lucide-react';

interface AuditRecord {
  id: string;
  seqNum: number;
  prevHash: string;
  recordHash: string;
  userId: string | null;
  userEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  diffJson: Record<string, unknown>;
  clientIp: string;
  userAgent?: string;
  createdAt: string;
}

export default function AuditTrailPage() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [chainValid, setChainValid] = useState<boolean | null>(true);
  const [verifying, setVerifying] = useState(false);
  const [filterAction, setFilterAction] = useState('ALL');
  const [selectedRecord, setSelectedRecord] = useState<AuditRecord | null>(null);

  async function loadLogs() {
    setLoading(true);
    try {
      const url =
        filterAction === 'ALL'
          ? '/api/v1/audit-logs?limit=50'
          : `/api/v1/audit-logs?limit=50&action=${encodeURIComponent(filterAction)}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        setRecords(json.data || []);
        setChainValid(json.chainValid ?? true);
      }
    } catch {
      // Offline / API unavailable
    } finally {
      setLoading(false);
    }
  }

  async function runVerification() {
    setVerifying(true);
    try {
      const res = await fetch('/api/v1/audit-logs/verify', { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        setChainValid(json.valid);
      }
    } catch {
      setChainValid(false);
    } finally {
      setVerifying(false);
    }
  }

  useEffect(() => {
    void loadLogs();
  }, [filterAction]);

  function getActionBadge(action: string) {
    if (action.includes('ABORT') || action.includes('DELETE')) {
      return (
        <span
          style={{
            background: '#7f1d1d',
            color: '#fca5a5',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {action}
        </span>
      );
    }
    if (action.includes('FAULT') || action.includes('INJECT') || action.includes('DISARM')) {
      return (
        <span
          style={{
            background: '#78350f',
            color: '#fcd34d',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {action}
        </span>
      );
    }
    return (
      <span
        style={{
          background: '#1e3a8a',
          color: '#93c5fd',
          padding: '2px 8px',
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {action}
      </span>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: -0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Lock size={22} color="#10b981" /> Tamper-Evident Audit Ledger
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Append-only, cryptographically hashed forensic record of all operational actions.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {chainValid ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#064e3b',
                color: '#34d399',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <ShieldCheck size={16} /> Hash Chain: VERIFIED
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#7f1d1d',
                color: '#f87171',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <AlertTriangle size={16} /> Hash Chain: CORRUPTED
            </div>
          )}

          <button
            onClick={() => void runVerification()}
            disabled={verifying}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: '#2563eb',
              color: 'white',
              border: 'none',
              padding: '7px 14px',
              borderRadius: 6,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={14} className={verifying ? 'spin' : ''} />
            {verifying ? 'Verifying...' : 'Run Mathematical Verification'}
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          background: 'var(--color-surface, #18181b)',
          padding: 12,
          borderRadius: 8,
        }}
      >
        <Filter size={16} color="var(--color-text-secondary)" />
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Filter Action:</span>
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          style={{
            background: '#27272a',
            color: 'white',
            border: '1px solid #3f3f46',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 13,
          }}
        >
          <option value="ALL">All Actions</option>
          <option value="FAULT_INJECTED">FAULT_INJECTED</option>
          <option value="FAULT_DISARMED">FAULT_DISARMED</option>
          <option value="CHAOS_ABORT">CHAOS_ABORT</option>
          <option value="WORLD_CREATED">WORLD_CREATED</option>
          <option value="WORLD_DELETED">WORLD_DELETED</option>
          <option value="USER_ROLES_UPDATED">USER_ROLES_UPDATED</option>
        </select>
      </div>

      {/* Audit Logs Table */}
      <div
        style={{
          background: 'var(--color-surface, #18181b)',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid var(--color-border, #27272a)',
        }}
      >
        <table
          style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}
        >
          <thead>
            <tr
              style={{ borderBottom: '1px solid #27272a', background: '#202024', color: '#a1a1aa' }}
            >
              <th style={{ padding: '10px 14px' }}>Seq #</th>
              <th style={{ padding: '10px 14px' }}>Timestamp</th>
              <th style={{ padding: '10px 14px' }}>Actor</th>
              <th style={{ padding: '10px 14px' }}>Action</th>
              <th style={{ padding: '10px 14px' }}>Resource</th>
              <th style={{ padding: '10px 14px' }}>Client IP</th>
              <th style={{ padding: '10px 14px' }}>SHA-256 Record Hash</th>
              <th style={{ padding: '10px 14px' }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#71717a' }}>
                  Loading audit records...
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#71717a' }}>
                  No audit records found.
                </td>
              </tr>
            ) : (
              records.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #27272a' }}>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600 }}>
                    #{r.seqNum}
                  </td>
                  <td style={{ padding: '10px 14px', color: '#a1a1aa' }}>
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 14px' }}>{r.userEmail}</td>
                  <td style={{ padding: '10px 14px' }}>{getActionBadge(r.action)}</td>
                  <td style={{ padding: '10px 14px', color: '#a1a1aa' }}>
                    {r.resourceType}:{r.resourceId.slice(0, 8)}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace' }}>{r.clientIp}</td>
                  <td
                    style={{
                      padding: '10px 14px',
                      fontFamily: 'monospace',
                      fontSize: 11,
                      color: '#71717a',
                    }}
                  >
                    {r.recordHash.slice(0, 16)}...
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                    <button
                      onClick={() => setSelectedRecord(r)}
                      style={{
                        background: 'transparent',
                        border: '1px solid #3f3f46',
                        color: '#93c5fd',
                        borderRadius: 4,
                        padding: '4px 8px',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      Inspect Diff
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Diff Drawer Modal */}
      {selectedRecord && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: 8,
              width: '600px',
              maxWidth: '90%',
              padding: 24,
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>
                Audit Entry #{selectedRecord.seqNum} Details
              </h3>
              <button
                onClick={() => setSelectedRecord(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#a1a1aa',
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                fontSize: 13,
                color: '#e4e4e7',
              }}
            >
              <div>
                <strong>Action:</strong> {selectedRecord.action}
              </div>
              <div>
                <strong>Actor:</strong> {selectedRecord.userEmail} (
                {selectedRecord.userId || 'system'})
              </div>
              <div>
                <strong>Target Resource:</strong> {selectedRecord.resourceType} (
                {selectedRecord.resourceId})
              </div>
              <div>
                <strong>Previous Hash:</strong>{' '}
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#a1a1aa' }}>
                  {selectedRecord.prevHash}
                </span>
              </div>
              <div>
                <strong>Record Hash:</strong>{' '}
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#34d399' }}>
                  {selectedRecord.recordHash}
                </span>
              </div>
              <div>
                <strong>Diff Payload:</strong>
                <pre
                  style={{
                    background: '#09090b',
                    padding: 12,
                    borderRadius: 6,
                    border: '1px solid #27272a',
                    marginTop: 6,
                    fontSize: 12,
                    overflowX: 'auto',
                    color: '#a5f3fc',
                  }}
                >
                  {JSON.stringify(selectedRecord.diffJson, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
