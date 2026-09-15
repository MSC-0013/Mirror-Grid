'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, LogOut, User } from 'lucide-react';

interface SystemHealth {
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  uptimeSeconds: number;
}

interface UserProfile {
  displayName: string;
  email: string;
}

export function Topbar() {
  const router = useRouter();
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch('/health/status');
        if (res.ok) {
          const data = await res.json();
          setHealth(data);
        } else {
          setHealth({ status: 'UNHEALTHY', uptimeSeconds: 0 });
        }
      } catch {
        setHealth({ status: 'UNHEALTHY', uptimeSeconds: 0 });
      }
    }

    async function checkUser() {
      try {
        const res = await fetch('/api/v1/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      } catch {
        // Not logged in
      }
    }

    void checkHealth();
    void checkUser();
    const interval = setInterval(checkHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  async function handleLogout() {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  }

  const badgeClass =
    health?.status === 'HEALTHY'
      ? 'badge-healthy'
      : health?.status === 'DEGRADED'
      ? 'badge-degraded'
      : 'badge-unhealthy';

  return (
    <header className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={16} color="var(--color-text-secondary)" />
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)' }}>
            System Status:
          </span>
          <span className={`badge ${badgeClass}`}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor' }} />
            {health?.status || 'CHECKING'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {user ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <User size={16} />
              <span style={{ fontWeight: 500 }}>{user.displayName}</span>
            </div>
            <button
              onClick={handleLogout}
              className="btn btn-outline"
              style={{ padding: '4px 10px', fontSize: 12 }}
              title="Sign Out"
            >
              <LogOut size={14} />
              <span>Logout</span>
            </button>
          </>
        ) : (
          <button
            onClick={() => router.push('/login')}
            className="btn btn-primary"
            style={{ padding: '6px 14px', fontSize: 13 }}
          >
            Sign In
          </button>
        )}
      </div>
    </header>
  );
}
