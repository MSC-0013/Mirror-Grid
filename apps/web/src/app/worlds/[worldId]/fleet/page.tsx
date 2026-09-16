'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Server,
  Activity,
  Cpu,
  HardDrive,
  RefreshCw,
  Terminal,
  Play,
  RotateCw,
  X,
} from 'lucide-react';

interface ContainerInfo {
  id: string;
  serviceId: string;
  serviceName: string;
  dockerContainerId: string;
  status: 'HEALTHY' | 'STARTING' | 'UNHEALTHY' | 'STOPPED';
  servicePort: number;
  adminPort: number;
  cpuUsage: number;
  memoryUsageMb: number;
}

interface FleetData {
  deploymentId: string | null;
  runtimeMode: string;
  containers: ContainerInfo[];
}

export default function ContainerFleetPage({ params }: { params: Promise<{ worldId: string }> }) {
  const resolvedParams = use(params);
  const worldId = resolvedParams.worldId;

  const [fleet, setFleet] = useState<FleetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);

  // Log drawer state
  const [selectedContainer, setSelectedContainer] = useState<ContainerInfo | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  async function fetchFleet() {
    try {
      const res = await fetch(`http://localhost:4000/api/v1/worlds/${worldId}/runtime/fleet`);
      if (res.ok) {
        const json = await res.json();
        setFleet(json.data);
      }
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchFleet();
    const interval = setInterval(() => void fetchFleet(), 3000);
    return () => clearInterval(interval);
  }, [worldId]);

  async function handleDeploy() {
    setDeploying(true);
    try {
      const res = await fetch(`http://localhost:4000/api/v1/worlds/${worldId}/runtime/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtimeMode: 'CONTAINER' }),
      });
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || 'Deployment failed');
      }
      await fetchFleet();
    } catch (err: unknown) {
      alert((err as Error).message);
    } finally {
      setDeploying(false);
    }
  }

  async function handleViewLogs(container: ContainerInfo) {
    setSelectedContainer(container);
    setLogsLoading(true);
    try {
      const res = await fetch(
        `http://localhost:4000/api/v1/worlds/${worldId}/runtime/containers/${container.id}/logs`,
      );
      if (res.ok) {
        const json = await res.json();
        setLogs(json.data?.logs ?? []);
      }
    } catch (err: unknown) {
      setLogs([`Failed to fetch logs: ${(err as Error).message}`]);
    } finally {
      setLogsLoading(false);
    }
  }

  async function handleRestart(containerId: string) {
    try {
      await fetch(
        `http://localhost:4000/api/v1/worlds/${worldId}/runtime/containers/${containerId}/restart`,
        { method: 'POST' },
      );
      await fetchFleet();
    } catch (err: unknown) {
      alert((err as Error).message);
    }
  }

  const containers = fleet?.containers ?? [];
  const healthyCount = containers.filter((c) => c.status === 'HEALTHY').length;

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
          <span style={{ color: '#111827', fontWeight: 500 }}>Container Fleet Manager</span>
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
              <Server size={26} color="#3b82f6" /> Container Fleet Peer
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: '#4b5563' }}>
              Real Linux container / process microservices executing workloads over authentic TCP
              network (§55, §56).
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => void handleDeploy()}
              disabled={deploying}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 6,
                backgroundColor: '#10b981',
                color: '#ffffff',
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {deploying ? (
                <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Play size={14} />
              )}
              {fleet?.deploymentId ? 'Redeploy Fleet' : 'Deploy Containers'}
            </button>
          </div>
        </div>
      </div>

      {/* Deployment Status Bar */}
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
            <Activity size={22} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
              Deployment:{' '}
              {fleet?.deploymentId ? fleet.deploymentId.slice(0, 8) + '...' : 'None Active'}
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Runtime Mode:{' '}
              <span style={{ fontWeight: 600, color: '#111827' }}>
                {fleet?.runtimeMode ?? 'LOGICAL'}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16 }}>
          <div
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              backgroundColor: '#ecfdf5',
              border: '1px solid #a7f3d0',
              color: '#065f46',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {healthyCount} / {containers.length} Healthy
          </div>
          <div
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              backgroundColor: '#f9fafb',
              border: '1px solid #e5e7eb',
              color: '#374151',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            W3C Trace Context: ACTIVE
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite' }} />
          <p>Polling container fleet state...</p>
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
          Error loading fleet: {error}
        </div>
      ) : containers.length === 0 ? (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            padding: 48,
            textAlign: 'center',
            color: '#6b7280',
          }}
        >
          <Server size={36} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600, color: '#111827' }}>
            No Container Fleet Deployed
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: 13 }}>
            Click "Deploy Containers" to provision microservice instances and user-space proxy
            routing.
          </p>
        </div>
      ) : (
        /* Containers Grid */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 16,
          }}
        >
          {containers.map((c) => (
            <div
              key={c.id}
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 8,
                border: '1px solid #e5e7eb',
                padding: 18,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111827' }}>
                      {c.serviceName}
                    </h3>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#6b7280' }}>
                      {c.dockerContainerId}
                    </span>
                  </div>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 700,
                      backgroundColor: c.status === 'HEALTHY' ? '#dcfce7' : '#fee2e2',
                      color: c.status === 'HEALTHY' ? '#15803d' : '#b91c1c',
                    }}
                  >
                    {c.status}
                  </span>
                </div>

                {/* Ports & Gauges */}
                <div
                  style={{
                    backgroundColor: '#f9fafb',
                    borderRadius: 6,
                    padding: '10px 12px',
                    marginBottom: 14,
                    fontSize: 12,
                  }}
                >
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}
                  >
                    <span style={{ color: '#6b7280' }}>Traffic Port:</span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                      :{c.servicePort}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#6b7280' }}>Admin Port:</span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>:{c.adminPort}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 11,
                        color: '#6b7280',
                        marginBottom: 2,
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Cpu size={12} /> CPU Usage
                      </span>
                      <span>{c.cpuUsage}%</span>
                    </div>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: '#e5e7eb',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${c.cpuUsage}%`,
                          height: '100%',
                          backgroundColor: '#3b82f6',
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 11,
                        color: '#6b7280',
                        marginBottom: 2,
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <HardDrive size={12} /> Memory Usage
                      </span>
                      <span>{c.memoryUsageMb} MB / 256 MB</span>
                    </div>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: '#e5e7eb',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${(c.memoryUsageMb / 256) * 100}%`,
                          height: '100%',
                          backgroundColor: '#8b5cf6',
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div
                style={{ display: 'flex', gap: 8, borderTop: '1px solid #f3f4f6', paddingTop: 12 }}
              >
                <button
                  onClick={() => void handleViewLogs(c)}
                  style={{
                    flex: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: '1px solid #d1d5db',
                    backgroundColor: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Terminal size={13} /> View Logs
                </button>
                <button
                  onClick={() => void handleRestart(c.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: '1px solid #d1d5db',
                    backgroundColor: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <RotateCw size={13} /> Restart
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Slide-over Log Drawer */}
      {selectedContainer && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            justifyContent: 'flex-end',
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: 540,
              backgroundColor: '#111827',
              color: '#f9fafb',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-4px 0 15px rgba(0,0,0,0.3)',
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #374151',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Container Logs</h3>
                <span style={{ fontSize: 12, color: '#9ca3af', fontFamily: 'monospace' }}>
                  {selectedContainer.serviceName} ({selectedContainer.dockerContainerId})
                </span>
              </div>
              <button
                onClick={() => setSelectedContainer(null)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div
              style={{
                flex: 1,
                padding: 16,
                overflowY: 'auto',
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              {logsLoading ? (
                <p style={{ color: '#9ca3af' }}>Loading log stream...</p>
              ) : (
                logs.map((line, idx) => (
                  <div
                    key={idx}
                    style={{ color: line.includes('[ERROR]') ? '#f87171' : '#d1d5db' }}
                  >
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
