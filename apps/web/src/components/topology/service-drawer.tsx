'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { X, ExternalLink, Shield, RefreshCw, Cpu, Layers } from 'lucide-react';

export interface DrawerService {
  id: string;
  name: string;
  serviceType: string;
  status: string;
  targetInstances: number;
  concurrencyLimit: number;
  queueCapacity: number;
  createdAt: string;
  instances?: Array<{ id: string; instanceIndex: number; status: string; containerId?: string }>;
}

export interface DrawerDependency {
  id: string;
  sourceServiceId: string;
  targetServiceId: string;
  timeoutMs: number;
  criticality: string;
  retryPolicy: {
    type: string;
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    jitterFactor: number;
    budgetPercent: number;
  };
  circuitBreakerPolicy: {
    enabled: boolean;
    threshold: number;
    windowMs: number;
    cooldownMs: number;
    halfOpenProbes: number;
  };
}

interface ServiceDrawerProps {
  service: DrawerService | null;
  worldId: string;
  allServices: DrawerService[];
  dependencies: DrawerDependency[];
  onClose: () => void;
}

export function ServiceDrawer({
  service,
  worldId,
  allServices,
  dependencies,
  onClose,
}: ServiceDrawerProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'instances' | 'dependencies' | 'policies'>('overview');

  if (!service) return null;

  const serviceMap = new Map(allServices.map((s) => [s.id, s.name]));

  // Filter dependencies
  const outbound = dependencies.filter((d) => d.sourceServiceId === service.id);
  const inbound = dependencies.filter((d) => d.targetServiceId === service.id);

  return (
    <div
      style={{
        position: 'fixed',
        top: 56,
        right: 0,
        bottom: 0,
        width: 440,
        backgroundColor: '#FFFFFF',
        borderLeft: '1px solid var(--color-border)',
        boxShadow: '-4px 0 15px rgba(0, 0, 0, 0.05)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Drawer Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>{service.name}</h2>
            <span
              style={{
                fontSize: 11,
                padding: '2px 6px',
                borderRadius: 4,
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-secondary)',
                fontWeight: 500,
              }}
            >
              {service.serviceType}
            </span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            Service ID: {service.id.slice(0, 8)}...
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link
            href={`/worlds/${worldId}/services/${service.id}`}
            style={{
              padding: '6px 10px',
              fontSize: 12,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
          >
            <span>Full Page</span>
            <ExternalLink size={12} />
          </Link>
          <button
            onClick={onClose}
            style={{
              padding: 6,
              borderRadius: 6,
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          padding: '0 12px',
        }}
      >
        {(['overview', 'instances', 'dependencies', 'policies'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              borderBottom: activeTab === tab ? '2px solid var(--color-primary)' : '2px solid transparent',
              textTransform: 'capitalize',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ padding: 12, borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Current Status</span>
                <p style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{service.status}</p>
              </div>
              <div style={{ padding: 12, borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Target Instances</span>
                <p style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{service.targetInstances} Replicas</p>
              </div>
              <div style={{ padding: 12, borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Concurrency Limit</span>
                <p style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{service.concurrencyLimit} Slots</p>
              </div>
              <div style={{ padding: 12, borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Queue Capacity</span>
                <p style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{service.queueCapacity} Requests</p>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Dependency Summary</h3>
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                • <strong>{inbound.length}</strong> services depend on this service.<br />
                • <strong>{outbound.length}</strong> downstream services called.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'instances' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600 }}>Active Fleet Instances</h3>
            {(!service.instances || service.instances.length === 0) ? (
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                {service.targetInstances} instance(s) allocated ({service.status}).
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {service.instances.map((inst) => (
                  <div
                    key={inst.id || inst.instanceIndex}
                    style={{
                      padding: 10,
                      borderRadius: 6,
                      border: '1px solid var(--color-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Cpu size={14} style={{ color: 'var(--color-text-secondary)' }} />
                      <span style={{ fontSize: 12, fontWeight: 500 }}>
                        {service.name}-{inst.instanceIndex}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: 4,
                        backgroundColor: 'var(--color-surface)',
                        color: 'var(--color-text-secondary)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      {inst.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'dependencies' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Layers size={14} /> Outbound Calls ({outbound.length})
              </h3>
              {outbound.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>No outbound dependencies (Leaf/Sink service).</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {outbound.map((d) => (
                    <div key={d.id} style={{ padding: 10, borderRadius: 6, border: '1px solid var(--color-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          → {serviceMap.get(d.targetServiceId) || d.targetServiceId.slice(0, 8)}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{d.timeoutMs}ms timeout</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <span style={{ fontSize: 10, padding: '2px 5px', borderRadius: 4, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                          {d.criticality}
                        </span>
                        <span style={{ fontSize: 10, padding: '2px 5px', borderRadius: 4, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                          Retry: {d.retryPolicy.maxAttempts}x ({d.retryPolicy.type})
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Layers size={14} /> Inbound Callers ({inbound.length})
              </h3>
              {inbound.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>No callers (Entry / Gateway service).</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {inbound.map((d) => (
                    <div key={d.id} style={{ padding: 10, borderRadius: 6, border: '1px solid var(--color-border)' }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        ← {serviceMap.get(d.sourceServiceId) || d.sourceServiceId.slice(0, 8)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'policies' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {outbound.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                Policies are configured on outbound dependency edges. This service has no outgoing edges.
              </p>
            ) : (
              outbound.map((d) => (
                <div key={d.id} style={{ padding: 12, borderRadius: 6, border: '1px solid var(--color-border)' }}>
                  <h4 style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                    Edge: {service.name} → {serviceMap.get(d.targetServiceId)}
                  </h4>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <Shield size={13} style={{ color: 'var(--color-info)' }} />
                        <span style={{ fontSize: 11, fontWeight: 600 }}>Circuit Breaker</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', paddingLeft: 19 }}>
                        Threshold: {d.circuitBreakerPolicy.threshold} failures • Window: {d.circuitBreakerPolicy.windowMs}ms • Cooldown: {d.circuitBreakerPolicy.cooldownMs}ms
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <RefreshCw size={13} style={{ color: 'var(--color-warning)' }} />
                        <span style={{ fontSize: 11, fontWeight: 600 }}>Retry Policy</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', paddingLeft: 19 }}>
                        Max Attempts: {d.retryPolicy.maxAttempts} • Base: {d.retryPolicy.baseDelayMs}ms • Jitter: {d.retryPolicy.jitterFactor * 100}% • Budget: {d.retryPolicy.budgetPercent}%
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
