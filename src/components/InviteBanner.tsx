import React, { useState } from 'react';
import { UserPlus, X } from 'lucide-react';

interface InviteBannerProps {
  code: string;
  onAcceptInvite: (code: string) => Promise<{ status: 'pending' | 'accepted'; username: string }>;
  onDismiss: () => void;
}

export const InviteBanner: React.FC<InviteBannerProps> = ({
  code,
  onAcceptInvite,
  onDismiss,
}) => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await onAcceptInvite(code);
      setMessage(
        res.status === 'accepted'
          ? `You are now friends with @${res.username}.`
          : `Friend request sent to @${res.username}.`
      );
      window.setTimeout(() => onDismiss(), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="invite-banner">
      <div>
        {message ? (
          <span>{message}</span>
        ) : error ? (
          <span style={{ color: 'var(--danger)' }}>{error}</span>
        ) : (
          <span>
            Invite link detected for friend code <strong className="mono">{code}</strong>
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {!message && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={loading}
            onClick={() => void handleSend()}
          >
            <UserPlus size={13} />
            {loading ? 'Sending…' : 'Send Request'}
          </button>
        )}
        <button
          type="button"
          className="btn-icon"
          onClick={onDismiss}
          aria-label="Dismiss invite"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
