import React from 'react';

export const ConfigRequiredScreen: React.FC = () => {
  return (
    <div className="center-screen">
      <div className="auth-card setup-card">
        <div className="brand-mark">
          <span className="brand-square">v.</span>
          <div>
            <h1 className="auth-title">veil</h1>
            <p className="auth-subtitle" style={{ margin: 0 }}>
              Supabase environment variables not configured
            </p>
          </div>
        </div>

        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: 14 }}>
          Add your public Supabase Project URL and Anon API Key to start. On Render, set these
          under <strong>Environment</strong> in your Static Site dashboard, then trigger a manual
          deploy.
        </p>

        <pre className="code-block">
          {`VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_PUBLIC_KEY`}
        </pre>

        <div className="notice-muted">
          <strong>Local development:</strong> Copy <code>.env.example</code> to <code>.env</code>,
          fill in the two values above, and run <code>npm run dev</code>. Never place your{' '}
          <code>service_role</code> key in client environment variables.
        </div>
      </div>
    </div>
  );
};
