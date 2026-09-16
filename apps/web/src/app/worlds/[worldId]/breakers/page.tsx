'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Power,
  RotateCcw,
  Zap,
} from 'lucide-react';

interface BreakerState {
  id: string;
  worldId: string;
  serviceId: string;
  edgeId: string | null;
  sourceServiceName: string;
  targetServiceName: string;
  currentState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureRatePpm: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalRequests: string;
  totalRejections: string;
  updatedAt: string;
}

interface BreakerTransition {
  id: string;
  fromState: string;
  toState: string;
  transitionReason: string;
  eventMicros: string;
  failureRatePpm: number;
  createdAt: string;
}

export default function CircuitBreakersPage({ params }: { params: Promise<{ worldId: string }> }) {
  const resolvedParams = use(params);
  const worldId = resolvedParams.worldId;

  const [breakers, setBreakers] = useState<BreakerState[]>([]);
  const [transitions, setTransitions] = useState<BreakerTransition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function fetchData() {
    try {
      const [bRes, tRes] = await Promise.all([
        fetch(`http://localhost:4000/api/v1/worlds/${worldId}/breakers`),
        fetch(`http://localhost:4000/api/v1/worlds/${worldId}/breakers/transitions`),
      ]);

      if (bRes.ok) {
        const bJson = await bRes.json();
        setBreakers(bJson.data ?? []);
      }
      if (tRes.ok) {
        const tJson = await tRes.json();
        setTransitions(tJson.data ?? []);
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

  async function handleTrip(breakerId: string) {
    setActionLoading(breakerId);
    try {
      await fetch(`http://localhost:4000/api/v1/worlds/${worldId}/breakers/${breakerId}/trip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'OPERATOR_FORCE_TRIP' }),
      });
      await fetchData();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReset(breakerId: string) {
    setActionLoading(breakerId);
    try {
      await fetch(`http://localhost:4000/api/v1/worlds/${worldId}/breakers/${breakerId}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'OPERATOR_MANUAL_RESET' }),
      });
      await fetchData();
    } finally {
      setActionLoading(null);
    }
  }

  const closedCount = breakers.filter((b) => b.currentState === 'CLOSED').length;
  const openCount = breakers.filter((b) => b.currentState === 'OPEN').length;
  const halfOpenCount = breakers.filter((b) => b.currentState === 'HALF_OPEN').length;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto', fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
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
          <span style={{ color: '#111827', fontWeight: 500 }}>Circuit Breakers</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#111827' }}>
              Circuit Breaker Inspector
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: '#4b5563' }}>
              Sliding-window failure admission controllers across distributed service boundaries
              (§52, §64).
            </p>
          </div>

          {/* Breaker Summary Badges */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                backgroundColor: '#ecfdf5',
                border: '1px solid #a7f3d0',
                color: '#065f46',
                fontSize: 13,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <ShieldCheck size={16} /> {closedCount} CLOSED (Healthy)
            </div>
            <div
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                backgroundColor: '#fffbeb',
                border: '1px solid #fde68a',
                color: '#92400e',
                fontSize: 13,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <AlertTriangle size={16} /> {halfOpenCount} HALF_OPEN
            </div>
            <div
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                fontSize: 13,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <ShieldAlert size={16} /> {openCount} OPEN (Tripped)
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite' }} />
          <p>Loading circuit breaker telemetry...</p>
        </div>
      ) : error ? (
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
          }}
        >
          Error loading breakers: {error}
        </div>
      ) : (
        <>
          {/* Active Breakers Table */}
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              marginBottom: 32,
            }}
          >
            <div
              style={{
                padding: '14px 20px',
                borderBottom: '1px solid #e5e7eb',
                backgroundColor: '#f9fafb',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>
                Monitored Service Edges ({breakers.length})
              </span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Auto-refreshing every 3s</span>
            </div>

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
                  <th style={{ padding: '12px 20px', fontWeight: 600 }}>Source Service</th>
                  <th style={{ padding: '12px 20px', fontWeight: 600 }}>Target Service</th>
                  <th style={{ padding: '12px 20px', fontWeight: 600 }}>Current State</th>
                  <th style={{ padding: '12px 20px', fontWeight: 600 }}>Failure Rate (PPM)</th>
                  <th style={{ padding: '12px 20px', fontWeight: 600 }}>Probes (Fail/Succ)</th>
                  <th style={{ padding: '12px 20px', fontWeight: 600, textAlign: 'right' }}>
                    Operator Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {breakers.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>
                      No service edges defined in this world yet. Add dependencies in the topology
                      canvas.
                    </td>
                  </tr>
                ) : (
                  breakers.map((b) => {
                    const ratePercent = (b.failureRatePpm / 10_000).toFixed(1);
                    return (
                      <tr key={b.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '14px 20px', fontWeight: 600, color: '#111827' }}>
                          {b.sourceServiceName}
                        </td>
                        <td style={{ padding: '14px 20px', fontWeight: 500, color: '#374151' }}>
                          {b.targetServiceName}
                        </td>
                        <td style={{ padding: '14px 20px' }}>
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 700,
                              backgroundColor:
                                b.currentState === 'CLOSED'
                                  ? '#dcfce7'
                                  : b.currentState === 'OPEN'
                                    ? '#fee2e2'
                                    : '#fef3c7',
                              color:
                                b.currentState === 'CLOSED'
                                  ? '#15803d'
                                  : b.currentState === 'OPEN'
                                    ? '#b91c1c'
                                    : '#b45309',
                            }}
                          >
                            {b.currentState}
                          </span>
                        </td>
                        <td style={{ padding: '14px 20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                                  width: `${Math.min(100, Number(ratePercent))}%`,
                                  height: '100%',
                                  backgroundColor: Number(ratePercent) > 50 ? '#ef4444' : '#10b981',
                                }}
                              />
                            </div>
                            <span
                              style={{ fontSize: 12, color: '#4b5563', fontFamily: 'monospace' }}
                            >
                              {ratePercent}% ({b.failureRatePpm} ppm)
                            </span>
                          </div>
                        </td>
                        <td
                          style={{
                            padding: '14px 20px',
                            color: '#4b5563',
                            fontFamily: 'monospace',
                          }}
                        >
                          {b.consecutiveFailures} fail / {b.consecutiveSuccesses} succ
                        </td>
                        <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                          {b.currentState === 'OPEN' ? (
                            <button
                              onClick={() => void handleReset(b.id)}
                              disabled={actionLoading === b.id}
                              style={{
                                padding: '5px 10px',
                                borderRadius: 4,
                                border: '1px solid #d1d5db',
                                backgroundColor: '#ffffff',
                                color: '#15803d',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <RotateCcw size={12} /> Force Reset
                            </button>
                          ) : (
                            <button
                              onClick={() => void handleTrip(b.id)}
                              disabled={actionLoading === b.id}
                              style={{
                                padding: '5px 10px',
                                borderRadius: 4,
                                border: '1px solid #fecaca',
                                backgroundColor: '#fff1f2',
                                color: '#b91c1c',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <Power size={12} /> Force Trip (Open)
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Recent Transitions Timeline */}
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <div
              style={{
                padding: '14px 20px',
                borderBottom: '1px solid #e5e7eb',
                backgroundColor: '#f9fafb',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Zap size={16} style={{ color: '#6366f1' }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>
                Transition Audit History
              </span>
            </div>

            <div style={{ padding: 16 }}>
              {transitions.length === 0 ? (
                <p
                  style={{
                    color: '#6b7280',
                    fontSize: 13,
                    margin: 0,
                    textAlign: 'center',
                    padding: 16,
                  }}
                >
                  No circuit breaker transitions recorded yet.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {transitions.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: 6,
                        backgroundColor: '#f9fafb',
                        border: '1px solid #f3f4f6',
                        fontSize: 13,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontWeight: 600, color: '#374151' }}>{t.fromState}</span>
                        <span style={{ color: '#9ca3af' }}>➔</span>
                        <span
                          style={{
                            fontWeight: 700,
                            color: t.toState === 'OPEN' ? '#b91c1c' : '#15803d',
                          }}
                        >
                          {t.toState}
                        </span>
                        <span style={{ color: '#6b7280', fontSize: 12 }}>
                          ({t.transitionReason})
                        </span>
                      </div>
                      <span style={{ color: '#9ca3af', fontSize: 12, fontFamily: 'monospace' }}>
                        {new Date(t.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
