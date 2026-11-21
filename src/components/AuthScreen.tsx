import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface AuthScreenProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (
    username: string,
    email: string,
    password: string
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  pendingInviteCode?: string | null;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onSignIn,
  onSignUp,
  pendingInviteCode,
}) => {
  const [mode, setMode] = useState<'signin' | 'signup'>(pendingInviteCode ? 'signup' : 'signin');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [usernameStatus, setUsernameStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  >('idle');

  useEffect(() => {
    if (mode !== 'signup' || !supabase) {
      setUsernameStatus('idle');
      return;
    }

    const clean = username.trim().toLowerCase();
    if (!clean) {
      setUsernameStatus('idle');
      return;
    }

    if (!/^[a-z0-9_.]{3,24}$/.test(clean)) {
      setUsernameStatus('invalid');
      return;
    }

    let cancelled = false;
    setUsernameStatus('checking');

    const timer = window.setTimeout(async () => {
      if (!supabase) return;
      const { data, error: rpcErr } = await supabase.rpc('is_username_available', {
        candidate: clean,
      });
      if (cancelled) return;
      if (rpcErr) {
        setUsernameStatus('idle');
        return;
      }
      setUsernameStatus(data ? 'available' : 'taken');
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, username]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);

    try {
      if (mode === 'signin') {
        await onSignIn(email, password);
      } else {
        const res = await onSignUp(username, email, password);
        if (res.needsEmailConfirmation) {
          setNotice(
            'Account created. Check your inbox and click the confirmation link, then sign in.'
          );
          setMode('signin');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="center-screen">
      <div className="auth-card">
        <div className="brand-mark">
          <span className="brand-square">v.</span>
          <span style={{ fontWeight: 600, fontSize: 16, letterSpacing: '-0.02em' }}>veil</span>
        </div>

        <h1 className="auth-title">
          {mode === 'signin' ? 'Sign in to veil' : 'Create your account'}
        </h1>
        <p className="auth-subtitle">
          Ephemeral monochrome messaging. Every message self-destructs after 60 minutes.
        </p>

        {pendingInviteCode && (
          <div className="notice-muted" style={{ marginBottom: 14 }}>
            Friend invite <span className="mono">{pendingInviteCode}</span> will be ready once you
            sign in.
          </div>
        )}

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            className={`auth-tab ${mode === 'signin' ? 'active' : ''}`}
            onClick={() => {
              setMode('signin');
              setError(null);
              setNotice(null);
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => {
              setMode('signup');
              setError(null);
              setNotice(null);
            }}
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div className="field">
              <label className="field-label" htmlFor="auth-username">
                <span>Username</span>
                {usernameStatus === 'available' && (
                  <span style={{ color: 'var(--text-primary)' }}>Available</span>
                )}
                {usernameStatus === 'taken' && (
                  <span style={{ color: 'var(--danger)' }}>Taken</span>
                )}
                {usernameStatus === 'invalid' && (
                  <span style={{ color: 'var(--danger)' }}>3–24 chars (a-z, 0-9, _ .)</span>
                )}
                {usernameStatus === 'checking' && (
                  <span style={{ color: 'var(--text-muted)' }}>Checking…</span>
                )}
              </label>
              <input
                id="auth-username"
                className="input"
                type="text"
                autoComplete="username"
                placeholder="monochrome_user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          )}

          <div className="field">
            <label className="field-label" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="auth-password">
              Password
            </label>
            <input
              id="auth-password"
              className="input"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder="Minimum 6 characters"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className="notice-error" style={{ marginBottom: 14 }}>
              {error}
            </div>
          )}

          {notice && (
            <div className="notice-muted" style={{ marginBottom: 14 }}>
              {notice}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={submitting || (mode === 'signup' && usernameStatus === 'taken')}
          >
            {submitting
              ? mode === 'signin'
                ? 'Signing in…'
                : 'Creating account…'
              : mode === 'signin'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
};
