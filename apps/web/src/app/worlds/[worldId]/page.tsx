'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Network,
  Share2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
  Activity,
  Play,
  Square,
  Gauge,
  Zap,
  ShieldAlert,
  Flame,
  Server,
  FlaskConical,
} from 'lucide-react';
import { TopologyCanvas } from '@/components/topology/topology-canvas';
import {
  ServiceDrawer,
  type DrawerService,
  type DrawerDependency,
} from '@/components/topology/service-drawer';

interface WorldData {
  id: string;
  name: string;
  description: string;
  runtimeMode: string;
  status: string;
  eventSeq: string;
}

interface GraphMetrics {
  serviceCount: number;
  edgeCount: number;
  hasCycles: boolean;
  criticalPathLength: number;
}

export default function WorldDetailPage({ params }: { params: Promise<{ worldId: string }> }) {
  const resolvedParams = use(params);
  const worldId = resolvedParams.worldId;

  const [world, setWorld] = useState<WorldData | null>(null);
  const [services, setServices] = useState<DrawerService[]>([]);
  const [dependencies, setDependencies] = useState<DrawerDependency[]>([]);
  const [metrics, setMetrics] = useState<GraphMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedService, setSelectedService] = useState<DrawerService | null>(null);
  const [isAddServiceOpen, setIsAddServiceOpen] = useState(false);
  const [isAddDepOpen, setIsAddDepOpen] = useState(false);

  // Form states
  const [serviceName, setServiceName] = useState('');
  const [serviceType, setServiceType] = useState('HTTP');
  const [targetInstances, setTargetInstances] = useState(1);
  const [concurrencyLimit, setConcurrencyLimit] = useState(64);
  const [queueCapacity, setQueueCapacity] = useState(1000);

  const [depSource, setDepSource] = useState('');
  const [depTarget, setDepTarget] = useState('');
  const [depTimeout, setDepTimeout] = useState(5000);
  const [depCriticality, setDepCriticality] = useState('REQUIRED');
  const [formError, setFormError] = useState<string | null>(null);

  // Simulation State
  const [simStatus, setSimStatus] = useState<'IDLE' | 'RUNNING' | 'COMPLETED'>('IDLE');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [simMetrics, setSimMetrics] = useState<{
    p95LatencyMs: number;
    throughput: number;
    errorRate: number;
    queueDepth: number;
    activeSlots: number;
    stateHash?: string;
  } | null>(null);

  async function handleStartSimulation() {
    try {
      setSimStatus('RUNNING');
      const res = await fetch(`http://localhost:4000/api/v1/simulation/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          worldId,
          seed: 42,
          runtimeMode: 'LOGICAL',
          driver: 'FAST',
          durationMs: 10000,
          baseRate: 200,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.data) throw new Error(json.error?.message || 'Failed to create run');

      const runId = json.data.runId;
      setActiveRunId(runId);

      await fetch(`http://localhost:4000/api/v1/simulation/runs/${runId}/start`, {
        method: 'POST',
      });
    } catch (err) {
      console.error('Failed to start simulation:', err);
      setSimStatus('IDLE');
    }
  }

  async function handleStopSimulation() {
    if (!activeRunId) return;
    try {
      await fetch(`http://localhost:4000/api/v1/simulation/runs/${activeRunId}/stop`, {
        method: 'POST',
      });
      setSimStatus('COMPLETED');
    } catch (err) {
      console.error('Failed to stop simulation:', err);
    }
  }

  useEffect(() => {
    if (simStatus !== 'RUNNING' || !activeRunId) return;

    const interval = setInterval(async () => {
      try {
        const [statusRes, metricsRes] = await Promise.all([
          fetch(`http://localhost:4000/api/v1/simulation/runs/${activeRunId}/status`),
          fetch(`http://localhost:4000/api/v1/simulation/runs/${activeRunId}/metrics`),
        ]);

        if (statusRes.ok) {
          const statusJson = await statusRes.json();
          if (statusJson.data?.status === 'COMPLETED' || statusJson.data?.status === 'CANCELLED') {
            setSimStatus('COMPLETED');
            if (statusJson.data.finalStateHash) {
              setSimMetrics((prev) =>
                prev ? { ...prev, stateHash: statusJson.data.finalStateHash } : null,
              );
            }
          }
        }

        if (metricsRes.ok) {
          const metricsJson = await metricsRes.json();
          const buckets = metricsJson.data?.buckets || [];
          if (buckets.length > 0) {
            const latest = buckets[buckets.length - 1];
            const totalReq = buckets.reduce(
              (acc: number, b: { requestsTotal?: number }) => acc + (b.requestsTotal || 0),
              0,
            );
            const totalFailed = buckets.reduce(
              (acc: number, b: { requestsFailed?: number }) => acc + (b.requestsFailed || 0),
              0,
            );
            setSimMetrics((prev) => ({
              p95LatencyMs: (latest.p95LatencyUs || 0) / 1000,
              throughput: Math.round(totalReq / buckets.length),
              errorRate: totalReq > 0 ? totalFailed / totalReq : 0,
              queueDepth: latest.queueDepth || 0,
              activeSlots: latest.activeSlots || 0,
              stateHash: prev?.stateHash,
            }));
          }
        }
      } catch (err) {
        console.error('Simulation polling error:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [simStatus, activeRunId]);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);

      const [worldRes, graphRes] = await Promise.all([
        fetch(`http://localhost:4000/api/v1/worlds/${worldId}`, { credentials: 'include' }),
        fetch(`http://localhost:4000/api/v1/worlds/${worldId}/graph`, { credentials: 'include' }),
      ]);

      if (!worldRes.ok) {
        throw new Error(`Failed to load world (status ${worldRes.status})`);
      }
      const worldJson = await worldRes.json();
      setWorld(worldJson.data);

      if (graphRes.ok) {
        const graphJson = await graphRes.json();
        setServices(graphJson.data.services || []);
        setDependencies(graphJson.data.dependencies || []);
        setMetrics(graphJson.data.metrics || null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load topology');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [worldId]);

  async function handleCreateService(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    try {
      const res = await fetch(`http://localhost:4000/api/v1/worlds/${worldId}/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: serviceName,
          serviceType,
          targetInstances: Number(targetInstances),
          concurrencyLimit: Number(concurrencyLimit),
          queueCapacity: Number(queueCapacity),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || 'Failed to create service');
      }

      setIsAddServiceOpen(false);
      setServiceName('');
      await loadData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Service creation failed');
    }
  }

  async function handleCreateDependency(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    try {
      const res = await fetch(`http://localhost:4000/api/v1/worlds/${worldId}/dependencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sourceServiceId: depSource,
          targetServiceId: depTarget,
          timeoutMs: Number(depTimeout),
          criticality: depCriticality,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || 'Failed to create dependency');
      }

      setIsAddDepOpen(false);
      setDepSource('');
      setDepTarget('');
      await loadData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Dependency creation failed');
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 32, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Clock className="animate-spin" size={18} />
        <span>Loading world topology...</span>
      </div>
    );
  }

  if (error || !world) {
    return (
      <div style={{ padding: 32 }}>
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            backgroundColor: 'var(--color-error-bg)',
            color: 'var(--color-error)',
            border: '1px solid #FCA5A5',
          }}
        >
          <strong>Error loading world:</strong> {error || 'World not found'}
        </div>
        <Link
          href="/worlds"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 16 }}
        >
          <ArrowLeft size={16} /> Back to Worlds
        </Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
      {/* Header Bar */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: '#FFFFFF',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              marginBottom: 4,
            }}
          >
            <Link href="/worlds" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ArrowLeft size={13} /> Worlds
            </Link>
            <span>/</span>
            <span style={{ color: 'var(--color-text)' }}>{world.name}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700 }}>{world.name}</h1>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 4,
                backgroundColor:
                  world.status === 'RUNNING' ? 'var(--color-success-bg)' : 'var(--color-surface)',
                color:
                  world.status === 'RUNNING'
                    ? 'var(--color-success)'
                    : 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
              }}
            >
              {world.status}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: '2px 8px',
                borderRadius: 4,
                backgroundColor: 'var(--color-info-bg)',
                color: 'var(--color-info)',
              }}
            >
              {world.runtimeMode} Mode
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
              Seq: #{world.eventSeq}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {simStatus === 'RUNNING' ? (
            <button
              onClick={handleStopSimulation}
              style={{
                padding: '7px 12px',
                borderRadius: 6,
                border: '1px solid var(--color-error)',
                backgroundColor: '#FEE2E2',
                color: '#DC2626',
                fontSize: 13,
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
              }}
            >
              <Square size={14} /> Stop Simulation
            </button>
          ) : (
            <button
              onClick={handleStartSimulation}
              style={{
                padding: '7px 12px',
                borderRadius: 6,
                border: '1px solid #16A34A',
                backgroundColor: '#DCFCE7',
                color: '#16A34A',
                fontSize: 13,
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
              }}
            >
              <Play size={14} /> Run Simulation
            </button>
          )}
          <Link
            href={`/worlds/${worldId}/breakers`}
            style={{
              padding: '7px 12px',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              backgroundColor: '#FFFFFF',
              color: '#374151',
              fontSize: 13,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              textDecoration: 'none',
            }}
          >
            <ShieldAlert size={14} color="#f59e0b" /> Breakers
          </Link>
          <Link
            href={`/worlds/${worldId}/faults`}
            style={{
              padding: '7px 12px',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              backgroundColor: '#FFFFFF',
              color: '#374151',
              fontSize: 13,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              textDecoration: 'none',
            }}
          >
            <Flame size={14} color="#ef4444" /> Chaos Faults
          </Link>
          <Link
            href={`/worlds/${worldId}/fleet`}
            style={{
              padding: '7px 12px',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              backgroundColor: '#FFFFFF',
              color: '#374151',
              fontSize: 13,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              textDecoration: 'none',
            }}
          >
            <Server size={14} color="#3b82f6" /> Fleet
          </Link>
          <Link
            href={`/worlds/${worldId}/experiments`}
            style={{
              padding: '7px 12px',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              backgroundColor: '#FFFFFF',
              color: '#374151',
              fontSize: 13,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              textDecoration: 'none',
            }}
          >
            <FlaskConical size={14} color="#10b981" /> Experiments
          </Link>
          <button
            onClick={() => setIsAddDepOpen(true)}
            style={{
              padding: '7px 12px',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              backgroundColor: '#FFFFFF',
              fontSize: 13,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Share2 size={14} /> Add Dependency
          </button>
          <button
            onClick={() => setIsAddServiceOpen(true)}
            style={{
              padding: '7px 14px',
              borderRadius: 6,
              backgroundColor: 'var(--color-primary)',
              color: 'var(--color-primary-text)',
              fontSize: 13,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Plus size={15} /> Add Service
          </button>
        </div>
      </div>

      {/* Telemetry Strip */}
      <div
        style={{
          padding: '10px 24px',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          fontSize: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Layers size={14} style={{ color: 'var(--color-text-secondary)' }} />
          <span style={{ color: 'var(--color-text-secondary)' }}>Services:</span>
          <strong>{metrics?.serviceCount ?? services.length}</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Network size={14} style={{ color: 'var(--color-text-secondary)' }} />
          <span style={{ color: 'var(--color-text-secondary)' }}>Edges:</span>
          <strong>{metrics?.edgeCount ?? dependencies.length}</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Activity size={14} style={{ color: 'var(--color-text-secondary)' }} />
          <span style={{ color: 'var(--color-text-secondary)' }}>Critical Path:</span>
          <strong>{metrics?.criticalPathLength ?? 0} hops</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {metrics?.hasCycles ? (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-error)' }}
            >
              <AlertCircle size={14} />
              <span>Contains Cycles!</span>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: 'var(--color-success)',
              }}
            >
              <CheckCircle2 size={14} />
              <span>Valid DAG (Acyclic)</span>
            </div>
          )}
        </div>
      </div>

      {/* Live Simulation Metric Cards Strip (Spec §14) */}
      {(simStatus !== 'IDLE' || simMetrics) && (
        <div
          style={{
            padding: '10px 24px',
            borderBottom: '1px solid var(--color-border)',
            backgroundColor: '#FAFAFA',
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Gauge size={14} style={{ color: 'var(--color-primary)' }} />
            <span style={{ color: 'var(--color-text-secondary)' }}>Sim:</span>
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                backgroundColor:
                  simStatus === 'RUNNING'
                    ? '#DBEAFE'
                    : simStatus === 'COMPLETED'
                      ? '#DCFCE7'
                      : 'var(--color-surface)',
                color:
                  simStatus === 'RUNNING'
                    ? '#1D4ED8'
                    : simStatus === 'COMPLETED'
                      ? '#15803D'
                      : 'inherit',
              }}
            >
              {simStatus}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Zap size={14} style={{ color: '#D97706' }} />
            <span style={{ color: 'var(--color-text-secondary)' }}>P95:</span>
            <strong>{simMetrics ? `${simMetrics.p95LatencyMs.toFixed(2)} ms` : '—'}</strong>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 5px',
                borderRadius: 3,
                backgroundColor: '#DCFCE7',
                color: '#15803D',
              }}
            >
              EXACT
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Rate:</span>
            <strong>{simMetrics ? `${simMetrics.throughput} req/s` : '—'}</strong>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Errors:</span>
            <strong
              style={{
                color: simMetrics && simMetrics.errorRate > 0.01 ? 'var(--color-error)' : 'inherit',
              }}
            >
              {simMetrics ? `${(simMetrics.errorRate * 100).toFixed(2)}%` : '—'}
            </strong>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Load:</span>
            <strong>
              {simMetrics
                ? `${simMetrics.activeSlots} slots / ${simMetrics.queueDepth} queue`
                : '—'}
            </strong>
          </div>

          {simMetrics?.stateHash && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>Hash:</span>
              <code
                style={{
                  fontSize: 11,
                  backgroundColor: '#F3F4F6',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                {simMetrics.stateHash.slice(0, 16)}…
              </code>
            </div>
          )}
        </div>
      )}

      {/* Canvas Area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <TopologyCanvas
          services={services}
          dependencies={dependencies}
          selectedServiceId={selectedService?.id || null}
          onSelectService={setSelectedService}
        />

        {/* Selected Service Drawer */}
        <ServiceDrawer
          service={selectedService}
          worldId={worldId}
          allServices={services}
          dependencies={dependencies}
          onClose={() => setSelectedService(null)}
        />
      </div>

      {/* Add Service Modal */}
      {isAddServiceOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
          }}
        >
          <div
            style={{
              width: 440,
              backgroundColor: '#FFFFFF',
              borderRadius: 8,
              padding: 24,
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Add Service</h3>
            {formError && (
              <div
                style={{
                  padding: 8,
                  backgroundColor: 'var(--color-error-bg)',
                  color: 'var(--color-error)',
                  fontSize: 12,
                  borderRadius: 4,
                  marginBottom: 12,
                }}
              >
                {formError}
              </div>
            )}
            <form
              onSubmit={handleCreateService}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                  Service Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Orders, Payments, Inventory"
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--color-border)',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                  Service Type
                </label>
                <select
                  value={serviceType}
                  onChange={(e) => setServiceType(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <option value="HTTP">HTTP Service</option>
                  <option value="GRPC">gRPC Microservice</option>
                  <option value="WORKER">Background Worker</option>
                  <option value="DATABASE">Database Engine</option>
                  <option value="CACHE">In-Memory Cache</option>
                  <option value="MESSAGE_BROKER">Message Broker</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                    Target Replicas
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={targetInstances}
                    onChange={(e) => setTargetInstances(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--color-border)',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                    Concurrency Limit
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={concurrencyLimit}
                    onChange={(e) => setConcurrencyLimit(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--color-border)',
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                  Queue Capacity
                </label>
                <input
                  type="number"
                  min="0"
                  value={queueCapacity}
                  onChange={(e) => setQueueCapacity(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--color-border)',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setIsAddServiceOpen(false)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 6,
                    border: '1px solid var(--color-border)',
                    fontSize: 13,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    backgroundColor: 'var(--color-primary)',
                    color: '#FFFFFF',
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  Create Service
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Dependency Modal */}
      {isAddDepOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
          }}
        >
          <div
            style={{
              width: 440,
              backgroundColor: '#FFFFFF',
              borderRadius: 8,
              padding: 24,
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              Add Service Dependency
            </h3>
            {formError && (
              <div
                style={{
                  padding: 8,
                  backgroundColor: 'var(--color-error-bg)',
                  color: 'var(--color-error)',
                  fontSize: 12,
                  borderRadius: 4,
                  marginBottom: 12,
                }}
              >
                {formError}
              </div>
            )}
            <form
              onSubmit={handleCreateDependency}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                  Source Service (Caller)
                </label>
                <select
                  required
                  value={depSource}
                  onChange={(e) => setDepSource(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <option value="">Select caller service...</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.serviceType})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                  Target Service (Callee / Upstream)
                </label>
                <select
                  required
                  value={depTarget}
                  onChange={(e) => setDepTarget(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <option value="">Select callee service...</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.serviceType})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                    Timeout (ms)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={depTimeout}
                    onChange={(e) => setDepTimeout(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--color-border)',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
                    Criticality
                  </label>
                  <select
                    value={depCriticality}
                    onChange={(e) => setDepCriticality(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <option value="REQUIRED">Required</option>
                    <option value="OPTIONAL">Optional</option>
                    <option value="BEST_EFFORT">Best Effort</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setIsAddDepOpen(false)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 6,
                    border: '1px solid var(--color-border)',
                    fontSize: 13,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    backgroundColor: 'var(--color-primary)',
                    color: '#FFFFFF',
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  Add Edge
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
