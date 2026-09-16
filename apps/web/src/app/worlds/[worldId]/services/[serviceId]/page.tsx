'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Server, Shield, RefreshCw, Cpu, Layers, Activity, Clock } from 'lucide-react';
import type { DrawerService, DrawerDependency } from '@/components/topology/service-drawer';

export default function ServiceDetailPage({
  params,
}: {
  params: Promise<{ worldId: string; serviceId: string }>;
}) {
  const resolvedParams = use(params);
  const { worldId, serviceId } = resolvedParams;

  const [service, setService] = useState<DrawerService | null>(null);
  const [dependencies, setDependencies] = useState<DrawerDependency[]>([]);
  const [allServices, setAllServices] = useState<DrawerService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadService() {
      try {
        setLoading(true);
        const [svcRes, graphRes] = await Promise.all([
          fetch(`http://localhost:4000/api/v1/worlds/${worldId}/services/${serviceId}`, {
            credentials: 'include',
          }),
          fetch(`http://localhost:4000/api/v1/worlds/${worldId}/graph`, {
            credentials: 'include',
          }),
        ]);

        if (!svcRes.ok) throw new Error('Failed to load service');
        const svcJson = await svcRes.json();
        setService(svcJson.data);

        if (graphRes.ok) {
          const graphJson = await graphRes.json();
          setDependencies(graphJson.data.dependencies || []);
          setAllServices(graphJson.data.services || []);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error');
      } finally {
        setLoading(false);
      }
    }

    loadService();
  }, [worldId, serviceId]);

  if (loading) {
    return (
      <div style={{ padding: 32, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Clock className="animate-spin" size={18} />
        <span>Loading service details...</span>
      </div>
    );
  }

  if (error || !service) {
    return (
      <div style={{ padding: 32 }}>
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            backgroundColor: 'var(--color-error-bg)',
            color: 'var(--color-error)',
          }}
        >
          {error || 'Service not found'}
        </div>
        <Link
          href={`/worlds/${worldId}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 16 }}
        >
          <ArrowLeft size={16} /> Back to Topology
        </Link>
      </div>
    );
  }

  const serviceMap = new Map(allServices.map((s) => [s.id, s.name]));
  const inbound = dependencies.filter((d) => d.targetServiceId === service.id);
  const outbound = dependencies.filter((d) => d.sourceServiceId === service.id);

  return (
    <div style={{ padding: 32, maxWidth: 1080, margin: '0 auto' }}>
      {/* Breadcrumb Navigation */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          color: 'var(--color-text-secondary)',
          marginBottom: 16,
        }}
      >
        <Link
          href={`/worlds/${worldId}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <ArrowLeft size={14} /> World Topology
        </Link>
        <span>/</span>
        <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>{service.name}</span>
      </div>

      {/* Service Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 24,
          borderRadius: 8,
          border: '1px solid var(--color-border)',
          backgroundColor: '#FFFFFF',
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 8,
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Server size={24} style={{ color: 'var(--color-primary)' }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ fontSize: 20, fontWeight: 700 }}>{service.name}</h1>
              <span
                style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 4,
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  fontWeight: 600,
                }}
              >
                {service.serviceType}
              </span>
              <span
                style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 4,
                  backgroundColor: 'var(--color-success-bg)',
                  color: 'var(--color-success)',
                  fontWeight: 600,
                }}
              >
                {service.status}
              </span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
              Service ID: {service.id} • Registered{' '}
              {new Date(service.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>

      {/* Grid Specification Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            backgroundColor: '#FFFFFF',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            Target Replicas
          </span>
          <p style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{service.targetInstances}</p>
        </div>
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            backgroundColor: '#FFFFFF',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            Concurrency Limit
          </span>
          <p style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
            {service.concurrencyLimit} slots
          </p>
        </div>
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            backgroundColor: '#FFFFFF',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Queue Capacity</span>
          <p style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
            {service.queueCapacity} items
          </p>
        </div>
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            backgroundColor: '#FFFFFF',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            Connected Edges
          </span>
          <p style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
            {inbound.length + outbound.length} edges
          </p>
        </div>
      </div>

      {/* Fleet Instances Section */}
      <div
        style={{
          padding: 20,
          borderRadius: 8,
          border: '1px solid var(--color-border)',
          backgroundColor: '#FFFFFF',
          marginBottom: 24,
        }}
      >
        <h2
          style={{
            fontSize: 15,
            fontWeight: 600,
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Cpu size={16} /> Service Instances (
          {service.instances?.length || service.targetInstances})
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {service.instances && service.instances.length > 0 ? (
            service.instances.map(
              (inst: {
                id?: string;
                instanceIndex: number;
                status: string;
                containerId?: string;
              }) => (
                <div
                  key={inst.id || inst.instanceIndex}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 6,
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 13 }}>
                      {service.name}-{inst.instanceIndex}
                    </strong>
                    <span
                      style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginLeft: 12 }}
                    >
                      Instance #{inst.instanceIndex}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 4,
                      backgroundColor: '#FFFFFF',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {inst.status}
                  </span>
                </div>
              ),
            )
          ) : (
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {service.targetInstances} instance(s) provisioned for runtime.
            </p>
          )}
        </div>
      </div>

      {/* Dependencies & Policies */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <div
          style={{
            padding: 20,
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            backgroundColor: '#FFFFFF',
          }}
        >
          <h2
            style={{
              fontSize: 15,
              fontWeight: 600,
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Layers size={16} /> Inbound Callers ({inbound.length})
          </h2>
          {inbound.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
              No services depend on {service.name}.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {inbound.map((d) => (
                <div
                  key={d.id}
                  style={{ padding: 10, borderRadius: 6, border: '1px solid var(--color-border)' }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    ← {serviceMap.get(d.sourceServiceId) || d.sourceServiceId.slice(0, 8)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            padding: 20,
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            backgroundColor: '#FFFFFF',
          }}
        >
          <h2
            style={{
              fontSize: 15,
              fontWeight: 600,
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Activity size={16} /> Outbound Dependencies ({outbound.length})
          </h2>
          {outbound.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
              No downstream dependencies.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {outbound.map((d) => (
                <div
                  key={d.id}
                  style={{ padding: 10, borderRadius: 6, border: '1px solid var(--color-border)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      → {serviceMap.get(d.targetServiceId) || d.targetServiceId.slice(0, 8)}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      {d.timeoutMs}ms
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: 'var(--color-text-secondary)',
                      display: 'flex',
                      gap: 12,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Shield size={12} /> Breaker: {d.circuitBreakerPolicy.threshold} err /{' '}
                      {d.circuitBreakerPolicy.windowMs}ms
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <RefreshCw size={12} /> Retry: {d.retryPolicy.maxAttempts}x (
                      {d.retryPolicy.type})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
