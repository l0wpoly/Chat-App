import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { FriendshipWithProfile } from '../types';
import { Avatar } from './Avatar';

interface CreateGroupModalProps {
  friends: FriendshipWithProfile[];
  onClose: () => void;
  onCreate: (name: string, memberIds: string[]) => Promise<void>;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  friends,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleMember = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(name, Array.from(selectedIds));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>New Group Chat</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label className="field-label" htmlFor="group-name-input">
              Group Name
            </label>
            <input
              id="group-name-input"
              className="input"
              type="text"
              placeholder="e.g. weekend-builds"
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="field">
            <div className="field-label">
              <span>Invite Friends ({selectedIds.size} selected)</span>
            </div>
            <div
              style={{
                maxHeight: 200,
                overflowY: 'auto',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                padding: 6,
              }}
            >
              {friends.length === 0 ? (
                <div style={{ padding: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  No accepted friends yet. You can create the group now and invite friends later.
                </div>
              ) : (
                friends.map((f) => {
                  const checked = selectedIds.has(f.peer.id);
                  return (
                    <label
                      key={f.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 8px',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        background: checked ? 'var(--bg-surface)' : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMember(f.peer.id)}
                      />
                      <Avatar
                        username={f.peer.username}
                        avatarPath={f.peer.avatar_path}
                        avatarUpdatedAt={f.peer.avatar_updated_at}
                        size={24}
                      />
                      <span style={{ fontSize: 13 }}>@{f.peer.username}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {error && (
            <div className="notice-error" style={{ marginBottom: 12 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !name.trim()}
            >
              {submitting ? 'Creating…' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
