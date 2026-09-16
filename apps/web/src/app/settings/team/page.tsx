'use client';

import { useState, useEffect } from 'react';
import { Users, Check, AlertCircle } from 'lucide-react';

interface UserItem {
  id: string;
  email: string;
  displayName: string;
  roles: ('ADMIN' | 'OPERATOR' | 'VIEWER')[];
  createdAt: string;
  activeSessionsCount: number;
}

export default function TeamSettingsPage() {
  const [team, setTeam] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [selectedRole, setSelectedRole] = useState<'ADMIN' | 'OPERATOR' | 'VIEWER'>('OPERATOR');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function loadTeam() {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/users');
      if (res.ok) {
        const json = await res.json();
        setTeam(json || []);
      }
    } catch {
      // Offline / API unavailable
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateRole() {
    if (!editingUser) return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/v1/users/${editingUser.id}/roles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: [selectedRole] }),
      });

      if (res.ok) {
        setMessage({
          type: 'success',
          text: `Role updated to ${selectedRole} for ${editingUser.email}`,
        });
        setEditingUser(null);
        await loadTeam();
      } else {
        const err = await res.json();
        setMessage({ type: 'error', text: err.message || 'Failed to update role' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error updating role' });
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadTeam();
  }, []);

  function getRoleBadge(roles: ('ADMIN' | 'OPERATOR' | 'VIEWER')[]) {
    if (roles.includes('ADMIN')) {
      return (
        <span
          style={{
            background: '#701a75',
            color: '#f5d0fe',
            padding: '3px 8px',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          ADMIN
        </span>
      );
    }
    if (roles.includes('OPERATOR')) {
      return (
        <span
          style={{
            background: '#1e3a8a',
            color: '#93c5fd',
            padding: '3px 8px',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          OPERATOR
        </span>
      );
    }
    return (
      <span
        style={{
          background: '#27272a',
          color: '#a1a1aa',
          padding: '3px 8px',
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        VIEWER
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
            <Users size={22} color="#3b82f6" /> Team & Access Control
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Manage operators, assign granular RBAC roles, and inspect active device sessions.
          </p>
        </div>
      </div>

      {message && (
        <div
          style={{
            padding: 12,
            borderRadius: 6,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: message.type === 'success' ? '#064e3b' : '#7f1d1d',
            color: message.type === 'success' ? '#34d399' : '#fca5a5',
          }}
        >
          {message.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}

      {/* User Roster Table */}
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
              <th style={{ padding: '10px 14px' }}>Name</th>
              <th style={{ padding: '10px 14px' }}>Email</th>
              <th style={{ padding: '10px 14px' }}>Assigned Role</th>
              <th style={{ padding: '10px 14px' }}>Active Sessions</th>
              <th style={{ padding: '10px 14px' }}>Joined</th>
              <th style={{ padding: '10px 14px' }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#71717a' }}>
                  Loading team members...
                </td>
              </tr>
            ) : team.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#71717a' }}>
                  No users found in organization.
                </td>
              </tr>
            ) : (
              team.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid #27272a' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>{u.displayName}</td>
                  <td style={{ padding: '10px 14px', color: '#a1a1aa' }}>{u.email}</td>
                  <td style={{ padding: '10px 14px' }}>{getRoleBadge(u.roles)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span
                      style={{
                        background: '#18181b',
                        border: '1px solid #3f3f46',
                        padding: '2px 8px',
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                    >
                      {u.activeSessionsCount} active
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', color: '#71717a' }}>
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                    <button
                      onClick={() => {
                        setEditingUser(u);
                        setSelectedRole(u.roles[0] || 'VIEWER');
                      }}
                      style={{
                        background: 'transparent',
                        border: '1px solid #3f3f46',
                        color: '#93c5fd',
                        borderRadius: 4,
                        padding: '4px 10px',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      Edit Role
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Role Assignment Modal */}
      {editingUser && (
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
              width: '450px',
              maxWidth: '90%',
              padding: 24,
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
              Assign Role for {editingUser.displayName}
            </h3>
            <p style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 16 }}>{editingUser.email}</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: 10,
                  borderRadius: 6,
                  border: selectedRole === 'ADMIN' ? '1px solid #3b82f6' : '1px solid #27272a',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="role"
                  value="ADMIN"
                  checked={selectedRole === 'ADMIN'}
                  onChange={() => setSelectedRole('ADMIN')}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>ADMIN</div>
                  <div style={{ fontSize: 11, color: '#a1a1aa' }}>
                    Full platform access, audit log access, user management.
                  </div>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: 10,
                  borderRadius: 6,
                  border: selectedRole === 'OPERATOR' ? '1px solid #3b82f6' : '1px solid #27272a',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="role"
                  value="OPERATOR"
                  checked={selectedRole === 'OPERATOR'}
                  onChange={() => setSelectedRole('OPERATOR')}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>OPERATOR</div>
                  <div style={{ fontSize: 11, color: '#a1a1aa' }}>
                    Manage topologies, inject faults, run experiments, chaos abort.
                  </div>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: 10,
                  borderRadius: 6,
                  border: selectedRole === 'VIEWER' ? '1px solid #3b82f6' : '1px solid #27272a',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="role"
                  value="VIEWER"
                  checked={selectedRole === 'VIEWER'}
                  onChange={() => setSelectedRole('VIEWER')}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>VIEWER</div>
                  <div style={{ fontSize: 11, color: '#a1a1aa' }}>
                    Read-only access to topologies and live metrics.
                  </div>
                </div>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setEditingUser(null)}
                style={{
                  background: 'transparent',
                  border: '1px solid #3f3f46',
                  color: 'white',
                  padding: '6px 12px',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleUpdateRole()}
                disabled={saving}
                style={{
                  background: '#2563eb',
                  border: 'none',
                  color: 'white',
                  padding: '6px 14px',
                  borderRadius: 6,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {saving ? 'Saving...' : 'Save Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
