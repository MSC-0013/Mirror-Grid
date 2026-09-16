'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Flame, AlertOctagon, Shield, Radio, Plus, Zap } from 'lucide-react';

interface FaultSpec {
  id: string;
  worldId: string;
  name: string;
  description?: string;
  faultType: string;
  targetServiceId?: string;
  targetEdgeId?: string;
  parameters: Record<string, unknown>;
  safetyRules: { maxDurationMicros: number; autoAbortOnBurnRate: boolean };
}

interface ActiveExecution {
  id: string;
  faultSpecId: string;
  status: string;
  scheduledStartMicros: string;
  scheduledDurationMicros: string;
  appliedParameters: Record<string, unknown>;
}

export default function ChaosFaultsPage({ params }: { params: Promise<{ worldId: string }> }) {
  const resolvedParams = use(params);
  const worldId = resolvedParams.worldId;

  const [faultSpecs, setFaultSpecs] = useState<FaultSpec[]>([]);
  const [activeExecutions, setActiveExecutions] = useState<ActiveExecution[]>([]);
  const [totalEdges, setTotalEdges] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abortStatus, setAbortStatus] = useState<string | null>(null);

  // Form modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newFaultName, setNewFaultName] = useState('Downstream Latency Spike');
  const [newFaultType, setNewFaultType] = useState('LATENCY');
  const [newLatencyMs, setNewLatencyMs] = useState(250);
  const [newErrorCode, setNewErrorCode] = useState('DOWNSTREAM_503');

  async function fetchData() {
    try {
      const [specsRes, activeRes, depsRes] = await Promise.all([
        fetch(`http://localhost:4000/api/v1/worlds/${worldId}/faults`),
        fetch(`http://localhost:4000/api/v1/worlds/${worldId}/faults/active`),
        fetch(`http://localhost:4000/api/v1/worlds/${worldId}/dependencies`),
      ]);

      if (specsRes.ok) {
        const sJson = await specsRes.json();
        setFaultSpecs(sJson.data ?? []);
      }
      if (activeRes.ok) {
        const aJson = await activeRes.json();
        setActiveExecutions(aJson.data ?? []);
      }
      if (depsRes.ok) {
        const dJson = await depsRes.json();
        setTotalEdges(dJson.data?.length ?? 0);
      }
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), 3000);
    return () => clearInterval(interval);
  }, [worldId]);

  async function handleEmergencyAbort() {
    try {
      const res = await fetch(`http://localhost:4000/api/v1/worlds/${worldId}/chaos/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'OPERATOR_EMERGENCY_GLOBAL_KILL' }),
      });
      const json = await res.json();
      setAbortStatus(
        `Emergency abort executed! ${json.data?.abortedCount ?? 0} active faults terminated.`,
      );
      await fetchData();
    } catch (err: unknown) {
      setAbortStatus(`Abort failed: ${(err as Error).message}`);
    }
  }

  async function handleInject(faultId: string) {
    try {
      await fetch(`http://localhost:4000/api/v1/worlds/${worldId}/faults/${faultId}/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationMicros: 60_000_000 }), // 1 min default
      });
      await fetchData();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  async function handleDisarm(executionId: string) {
    try {
      await fetch(`http://localhost:4000/api/v1/worlds/${worldId}/faults/${executionId}/disarm`, {
        method: 'POST',
      });
      await fetchData();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  async function handleCreateFault(e: React.FormEvent) {
    e.preventDefault();
    try {
      let parameters: Record<string, unknown> = { percentage: 100 };
      if (newFaultType === 'LATENCY') {
        parameters = {
          percentage: 100,
          latencyMicros: BigInt(newLatencyMs) * 1000n,
          jitterMicros: 10_000n,
          distribution: 'FIXED',
        };
      } else if (newFaultType === 'ERROR') {
        parameters = {
          percentage: 100,
          httpStatus: 503,
          errorCode: newErrorCode,
        };
      } else if (newFaultType === 'PACKET_DROP') {
        parameters = {
          percentage: 100,
          dropRatioPpm: 250_000, // 25%
        };
      }

      const res = await fetch(`http://localhost:4000/api/v1/worlds/${worldId}/faults`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newFaultName,
          faultType: newFaultType,
          parameters,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || 'Failed to create fault specification');
      }

      setIsModalOpen(false);
      await fetchData();
    } catch (err: unknown) {
      alert((err as Error).message);
    }
  }

  const blastRadiusPercent =
    totalEdges > 0 ? Math.round((activeExecutions.length / totalEdges) * 100) : 0;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto', fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            color: '#6b7280',
            marginBottom: 8,
          }}
        >
          <Link
            href={`/worlds/${worldId}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: '#3b82f6',
              textDecoration: 'none',
            }}
          >
            <ArrowLeft size={14} /> Back to Topology
          </Link>
          <span>/</span>
          <span style={{ color: '#111827', fontWeight: 500 }}>Chaos Engineering Console</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 700,
                margin: 0,
                color: '#111827',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Flame size={26} color="#ef4444" /> Chaos Fault Engine
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: '#4b5563' }}>
              Deterministic fault injection, blast-radius budgets, and automated emergency safety
              bounds (§53, §54).
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => setIsModalOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                backgroundColor: '#ffffff',
                color: '#374151',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Plus size={14} /> New Fault Spec
            </button>

            {/* Emergency Abort Button */}
            <button
              onClick={() => void handleEmergencyAbort()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 18px',
                borderRadius: 6,
                border: '1px solid #b91c1c',
                backgroundColor: '#dc2626',
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(220, 38, 38, 0.4)',
              }}
            >
              <AlertOctagon size={16} /> EMERGENCY CHAOS ABORT
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 6,
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            marginBottom: 20,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Error: {error}
        </div>
      )}

      {loading && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 6,
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            color: '#1d4ed8',
            marginBottom: 20,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Loading chaos specifications...
        </div>
      )}

      {abortStatus && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 6,
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            marginBottom: 20,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {abortStatus}
        </div>
      )}

      {/* Chaos Safety Boundary Indicator Card */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          padding: '16px 20px',
          marginBottom: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{ padding: 10, borderRadius: 8, backgroundColor: '#eff6ff', color: '#3b82f6' }}
          >
            <Shield size={22} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
              Chaos Safety Boundary
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Hard safety interlocks prevent unconstrained cascading failure or runaway experiments.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#6b7280',
                textTransform: 'uppercase',
              }}
            >
              Current Blast Radius
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <div
                style={{
                  width: 100,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: '#e5e7eb',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, blastRadiusPercent)}%`,
                    height: '100%',
                    backgroundColor: blastRadiusPercent > 30 ? '#ef4444' : '#3b82f6',
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: blastRadiusPercent > 30 ? '#ef4444' : '#111827',
                }}
              >
                {blastRadiusPercent}% / max 30%
              </span>
            </div>
          </div>

          <div style={{ borderLeft: '1px solid #e5e7eb', paddingLeft: 24 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#6b7280',
                textTransform: 'uppercase',
              }}
            >
              Auto-Abort on SLO Burn
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#15803d',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 4,
              }}
            >
              <Radio size={14} /> ACTIVE (Triggers at &gt;50% error rate for 30s)
            </div>
          </div>
        </div>
      </div>

      {/* Active Faults Drawer */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          overflow: 'hidden',
          marginBottom: 24,
        }}
      >
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #e5e7eb',
            backgroundColor: '#f9fafb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#374151',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Zap size={16} color="#f59e0b" /> Active Fault Injections ({activeExecutions.length})
          </span>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            All faults lease-capped to max 5 minutes
          </span>
        </div>

        {activeExecutions.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
            No active faults running. Select a specification below to inject a fault.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr
                style={{
                  backgroundColor: '#f9fafb',
                  color: '#6b7280',
                  textAlign: 'left',
                  borderBottom: '1px solid #e5e7eb',
                }}
              >
                <th style={{ padding: '10px 20px' }}>Execution ID</th>
                <th style={{ padding: '10px 20px' }}>Status</th>
                <th style={{ padding: '10px 20px' }}>Started At</th>
                <th style={{ padding: '10px 20px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {activeExecutions.map((exec) => (
                <tr key={exec.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '12px 20px', fontFamily: 'monospace', fontWeight: 600 }}>
                    {exec.id.slice(0, 8)}...
                  </td>
                  <td style={{ padding: '12px 20px' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        backgroundColor: '#fef3c7',
                        color: '#92400e',
                        fontWeight: 700,
                        fontSize: 11,
                      }}
                    >
                      {exec.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 20px', color: '#6b7280' }}>
                    {exec.scheduledStartMicros} µs
                  </td>
                  <td style={{ padding: '12px 20px', textAlign: 'right' }}>
                    <button
                      onClick={() => void handleDisarm(exec.id)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 4,
                        border: '1px solid #d1d5db',
                        backgroundColor: '#ffffff',
                        color: '#b91c1c',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Disarm
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Fault Specifications Matrix */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #e5e7eb',
            backgroundColor: '#f9fafb',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>
            Defined Fault Specifications ({faultSpecs.length})
          </span>
        </div>

        {faultSpecs.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
            No fault specifications created yet. Click "New Fault Spec" to add one.
          </div>
        ) : (
          <div
            style={{
              padding: 16,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: 14,
            }}
          >
            {faultSpecs.map((spec) => (
              <div
                key={spec.id}
                style={{
                  padding: 16,
                  borderRadius: 6,
                  border: '1px solid #e5e7eb',
                  backgroundColor: '#f9fafb',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                    }}
                  >
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#111827' }}>
                      {spec.name}
                    </h3>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        backgroundColor: '#e0e7ff',
                        color: '#3730a3',
                      }}
                    >
                      {spec.faultType}
                    </span>
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: '#6b7280' }}>
                    Target:{' '}
                    {spec.targetEdgeId
                      ? 'Specific Edge'
                      : spec.targetServiceId
                        ? 'Specific Service'
                        : 'Global (All Edges)'}
                  </p>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => void handleInject(spec.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 4,
                      backgroundColor: '#ef4444',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Inject (1 min)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Fault Modal */}
      {isModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 8,
              padding: 24,
              width: 440,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
            }}
          >
            <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>
              New Fault Specification
            </h2>
            <form onSubmit={(e) => void handleCreateFault(e)}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Name
                </label>
                <input
                  type="text"
                  value={newFaultName}
                  onChange={(e) => setNewFaultName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 4,
                    border: '1px solid #d1d5db',
                    fontSize: 13,
                  }}
                  required
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Fault Type
                </label>
                <select
                  value={newFaultType}
                  onChange={(e) => setNewFaultType(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 4,
                    border: '1px solid #d1d5db',
                    fontSize: 13,
                  }}
                >
                  <option value="LATENCY">LATENCY (Inject delay)</option>
                  <option value="ERROR">ERROR (HTTP 5xx override)</option>
                  <option value="PACKET_DROP">PACKET_DROP (Drop packets)</option>
                </select>
              </div>

              {newFaultType === 'LATENCY' && (
                <div style={{ marginBottom: 12 }}>
                  <label
                    style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}
                  >
                    Injected Latency (ms)
                  </label>
                  <input
                    type="number"
                    value={newLatencyMs}
                    onChange={(e) => setNewLatencyMs(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 4,
                      border: '1px solid #d1d5db',
                      fontSize: 13,
                    }}
                    min={1}
                    required
                  />
                </div>
              )}

              {newFaultType === 'ERROR' && (
                <div style={{ marginBottom: 12 }}>
                  <label
                    style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}
                  >
                    Error Code
                  </label>
                  <input
                    type="text"
                    value={newErrorCode}
                    onChange={(e) => setNewErrorCode(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 4,
                      border: '1px solid #d1d5db',
                      fontSize: 13,
                    }}
                    required
                  />
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 4,
                    border: '1px solid #d1d5db',
                    backgroundColor: '#ffffff',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '8px 14px',
                    borderRadius: 4,
                    backgroundColor: '#3b82f6',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Save Specification
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
