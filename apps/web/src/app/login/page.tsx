'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, LogIn, UserPlus } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('admin@mirrorgrid.io');
  const [password, setPassword] = useState('password123');
  const [displayName, setDisplayName] = useState('Platform Admin');
  const [organizationName, setOrganizationName] = useState('Core Engineering');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = isSignUp ? '/api/v1/auth/signup' : '/api/v1/auth/login';
      const body = isSignUp
        ? { email, password, displayName, organizationName }
        : { email, password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json.error?.message || json.message || 'Authentication failed');
      }

      router.push('/worlds');
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 440, padding: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-primary)',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 12,
            }}
          >
            <ShieldCheck size={24} />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.5 }}>
            {isSignUp ? 'Create Operator Account' : 'Sign in to MIRRORGRID'}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            {isSignUp
              ? 'Provision an organization and root credentials'
              : 'Enter your credentials to access the laboratory'}
          </p>
        </div>

        {/* Tab switch */}
        <div
          style={{
            display: 'flex',
            backgroundColor: 'var(--color-surface)',
            borderRadius: 'var(--radius-md)',
            padding: 3,
            marginBottom: 20,
          }}
        >
          <button
            type="button"
            onClick={() => {
              setIsSignUp(false);
              setError(null);
            }}
            style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
              fontWeight: 500,
              backgroundColor: !isSignUp ? '#fff' : 'transparent',
              boxShadow: !isSignUp ? 'var(--shadow-sm)' : 'none',
              color: !isSignUp ? 'var(--color-text)' : 'var(--color-text-secondary)',
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setIsSignUp(true);
              setError(null);
            }}
            style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
              fontWeight: 500,
              backgroundColor: isSignUp ? '#fff' : 'transparent',
              boxShadow: isSignUp ? 'var(--shadow-sm)' : 'none',
              color: isSignUp ? 'var(--color-text)' : 'var(--color-text-secondary)',
            }}
          >
            Sign Up
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

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {isSignUp && (
            <>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
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
                  Organization Name
                </label>
                <input
                  type="text"
                  required
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                  }}
                />
              </div>
            </>
          )}

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', padding: '10px 0', marginTop: 8 }}
          >
            {loading ? (
              'Processing...'
            ) : isSignUp ? (
              <>
                <UserPlus size={16} />
                <span>Create Account</span>
              </>
            ) : (
              <>
                <LogIn size={16} />
                <span>Sign In</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
