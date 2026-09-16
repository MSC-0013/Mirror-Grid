'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Globe, FlaskConical, Radio, Activity, Plus, ArrowRight } from 'lucide-react';

interface WorldItem {
  id: string;
  name: string;
  description?: string;
  status: string;
  runtimeMode: string;
  createdAt: string;
}

export default function DashboardPage() {
  const [worlds, setWorlds] = useState<WorldItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch('/api/v1/worlds?limit=5');
        if (res.ok) {
          const json = await res.json();
          setWorlds(json.data || []);
        }
      } catch {
        // Not authenticated or error
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>System Overview</h1>
        <p style={{ color: 'var(--color-text-secondary)', marginTop: 4 }}>
          Live operational status of simulated topologies and experiment workloads.
        </p>
      </div>

      {/* 4 Stat Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        <div className="card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: 'var(--color-text-secondary)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500 }}>Total Worlds</span>
            <Globe size={18} />
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 12 }}>
            {loading ? '—' : worlds.length}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Provisioned topologies
          </div>
        </div>

        <div className="card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: 'var(--color-text-secondary)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500 }}>Active Experiments</span>
            <FlaskConical size={18} />
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 12 }}>0</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Running scenarios
          </div>
        </div>

        <div className="card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: 'var(--color-text-secondary)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500 }}>Events Today</span>
            <Radio size={18} />
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 12 }}>0</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Recorded transitions
          </div>
        </div>

        <div className="card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: 'var(--color-text-secondary)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500 }}>Runtime Health</span>
            <Activity size={18} />
          </div>
          <div
            style={{ fontSize: 28, fontWeight: 700, marginTop: 12, color: 'var(--color-success)' }}
          >
            100%
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Core services operational
          </div>
        </div>
      </div>

      {/* Recent Worlds */}
      <div className="card" style={{ marginTop: 8 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Recent Worlds</h2>
          <Link
            href="/worlds"
            className="btn btn-outline"
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            <span>View All</span>
            <ArrowRight size={14} />
          </Link>
        </div>

        {worlds.length === 0 ? (
          <div
            style={{ padding: '32px 0', textAlign: 'center', color: 'var(--color-text-secondary)' }}
          >
            <p>No worlds created yet.</p>
            <Link
              href="/worlds"
              className="btn btn-primary"
              style={{ marginTop: 12, display: 'inline-flex' }}
            >
              <Plus size={16} />
              <span>Create First World</span>
            </Link>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {worlds.map((w) => (
              <div
                key={w.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 12,
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{w.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    {w.description || 'No description provided'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="badge badge-idle">{w.status}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {w.runtimeMode}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
