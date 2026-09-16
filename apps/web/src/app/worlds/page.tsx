'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Globe, Plus, Cpu, X, Calendar, Server } from 'lucide-react';

interface World {
  id: string;
  name: string;
  description?: string;
  status: string;
  runtimeMode: 'LOGICAL' | 'CONTAINER' | 'HYBRID';
  eventSeq: string;
  createdAt: string;
}

export default function WorldsPage() {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [runtimeMode, setRuntimeMode] = useState<'LOGICAL' | 'CONTAINER' | 'HYBRID'>('LOGICAL');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchWorlds() {
    try {
      const res = await fetch('/api/v1/worlds');
      if (res.ok) {
        const json = await res.json();
        setWorlds(json.data || []);
      }
    } catch {
      // Error fetching worlds
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchWorlds();
  }, []);

  async function handleCreateWorld(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);

    try {
      const res = await fetch('/api/v1/worlds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, runtimeMode }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json.error?.message || json.message || 'Failed to create world');
      }

      setIsModalOpen(false);
      setName('');
      setDescription('');
      setRuntimeMode('LOGICAL');
      await fetchWorlds();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>Simulated Worlds</h1>
          <p style={{ color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Topology environments modeling distributed services, dependencies, and networks.
          </p>
        </div>

        <button
          onClick={() => {
            setIsModalOpen(true);
            setError(null);
          }}
          className="btn btn-primary"
        >
          <Plus size={16} />
          <span>New World</span>
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          Loading worlds...
        </div>
      ) : worlds.length === 0 ? (
        /* Empty State */
        <div
          className="card"
          style={{
            padding: 64,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-secondary)',
              marginBottom: 16,
            }}
          >
            <Globe size={28} />
          </div>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>No Worlds Created Yet</h2>
          <p
            style={{
              color: 'var(--color-text-secondary)',
              maxWidth: 360,
              marginTop: 4,
              marginBottom: 20,
            }}
          >
            Provision your first world to begin modeling microservices, defining dependencies, and
            running experiments.
          </p>
          <button
            onClick={() => {
              setIsModalOpen(true);
              setError(null);
            }}
            className="btn btn-primary"
          >
            <Plus size={16} />
            <span>Create First World</span>
          </button>
        </div>
      ) : (
        /* Worlds Grid */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 16,
          }}
        >
          {worlds.map((world) => (
            <Link
              key={world.id}
              href={`/worlds/${world.id}`}
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                cursor: 'pointer',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <h3 style={{ fontSize: 16, fontWeight: 600 }}>{world.name}</h3>
                  <span className="badge badge-idle">{world.status}</span>
                </div>

                <p
                  style={{
                    color: 'var(--color-text-secondary)',
                    fontSize: 13,
                    marginTop: 8,
                    minHeight: 38,
                  }}
                >
                  {world.description || 'No description provided.'}
                </p>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: 16,
                  marginTop: 16,
                  borderTop: '1px solid var(--color-border)',
                  fontSize: 12,
                  color: 'var(--color-text-secondary)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {world.runtimeMode === 'LOGICAL' ? <Cpu size={14} /> : <Server size={14} />}
                  <span>{world.runtimeMode}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Calendar size={14} />
                  <span>{new Date(world.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create World Modal */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 20,
              }}
            >
              <h2 style={{ fontSize: 18, fontWeight: 700 }}>Create New World</h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <X size={20} />
              </button>
            </div>

            {error && (
              <div
                style={{
                  padding: 10,
                  marginBottom: 16,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-error-bg)',
                  color: 'var(--color-error)',
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {error}
              </div>
            )}

            <form
              onSubmit={handleCreateWorld}
              style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  World Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Metro-01"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Description
                </label>
                <textarea
                  placeholder="Scenario description, target architecture, or notes"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                  Runtime Mode
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {(['LOGICAL', 'CONTAINER', 'HYBRID'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setRuntimeMode(mode)}
                      style={{
                        padding: 8,
                        borderRadius: 'var(--radius-md)',
                        border: `1px solid ${runtimeMode === mode ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        backgroundColor: runtimeMode === mode ? 'var(--color-surface)' : '#fff',
                        fontWeight: runtimeMode === mode ? 600 : 400,
                        fontSize: 12,
                        textAlign: 'center',
                      }}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="btn btn-outline"
                >
                  Cancel
                </button>
                <button type="submit" disabled={creating} className="btn btn-primary">
                  {creating ? 'Creating...' : 'Create World'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
