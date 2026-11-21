import React, { useState } from 'react';
import { ArrowLeft, Check, Copy, MessageSquare, UserMinus, UserPlus, X } from 'lucide-react';
import type { FriendsTab, FriendshipWithProfile, Profile } from '../types';
import { Avatar } from './Avatar';

interface FriendsPanelProps {
  profile: Profile;
  activeTab: FriendsTab;
  friends: FriendshipWithProfile[];
  incomingRequests: FriendshipWithProfile[];
  outgoingRequests: FriendshipWithProfile[];
  onlineUserIds: Set<string>;
  onSelectTab: (tab: FriendsTab) => void;
  onSendRequest: (identifier: string) => Promise<{ status: 'pending' | 'accepted'; username: string }>;
  onAcceptRequest: (reqId: string) => Promise<void>;
  onRemoveFriendship: (friendshipId: string) => Promise<void>;
  onMessageFriend: (friendId: string) => Promise<void>;
  onMobileBack: () => void;
}

export const FriendsPanel: React.FC<FriendsPanelProps> = ({
  profile,
  activeTab,
  friends,
  incomingRequests,
  outgoingRequests,
  onlineUserIds,
  onSelectTab,
  onSendRequest,
  onAcceptRequest,
  onRemoveFriendship,
  onMessageFriend,
  onMobileBack,
}) => {
  const [identifier, setIdentifier] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<'code' | 'link' | null>(null);

  const inviteUrl = `${window.location.origin}/invite/${profile.friend_code}`;

  const copyText = async (value: string, key: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await onSendRequest(identifier);
      setIdentifier('');
      setFeedback({
        type: 'ok',
        text:
          res.status === 'accepted'
            ? `Mutual request matched — you are now friends with @${res.username}.`
            : `Friend request sent to @${res.username}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Could not send friend request.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAccept = async (reqId: string) => {
    setBusyId(reqId);
    try {
      await onAcceptRequest(reqId);
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (id: string) => {
    setBusyId(id);
    try {
      await onRemoveFriendship(id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="main-stage">
      <header className="stage-topbar">
        <div className="stage-title-wrap">
          <button
            type="button"
            className="btn-icon mobile-only"
            onClick={onMobileBack}
            aria-label="Back"
          >
            <ArrowLeft size={17} />
          </button>
          <span className="stage-title">Friends</span>
        </div>

        <div className="stage-actions">
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'all' ? 'btn-primary' : ''}`}
            onClick={() => onSelectTab('all')}
          >
            All ({friends.length})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'pending' ? 'btn-primary' : ''}`}
            onClick={() => onSelectTab('pending')}
          >
            Pending ({incomingRequests.length})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'add' ? 'btn-primary' : ''}`}
            onClick={() => onSelectTab('add')}
          >
            Add Friend
          </button>
        </div>
      </header>

      <div className="panel-scroll">
        <div className="panel-container">
          {activeTab === 'all' && (
            <>
              <h2 className="panel-heading">Accepted Friends</h2>
              <p className="panel-sub">
                Direct messages and group invites are restricted to accepted friends.
              </p>

              <div className="surface-box">
                {friends.length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    No accepted friends yet. Switch to <strong>Add Friend</strong> to search by
                    exact username or share your friend code.
                  </div>
                ) : (
                  friends.map((f) => {
                    const online = onlineUserIds.has(f.peer.id);
                    return (
                      <div key={f.id} className="list-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          <Avatar
                            username={f.peer.username}
                            avatarPath={f.peer.avatar_path}
                            avatarUpdatedAt={f.peer.avatar_updated_at}
                            size={34}
                            online={online}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>@{f.peer.username}</div>
                            <div
                              style={{
                                fontSize: 12,
                                color: 'var(--text-secondary)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                maxWidth: 320,
                              }}
                            >
                              {f.peer.bio || (online ? 'Online' : 'Offline')}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => void onMessageFriend(f.peer.id)}
                          >
                            <MessageSquare size={13} />
                            Message
                          </button>
                          <button
                            type="button"
                            className="btn-icon bordered"
                            disabled={busyId === f.id}
                            onClick={() => void handleRemove(f.id)}
                            title="Remove friend"
                            aria-label={`Remove ${f.peer.username}`}
                          >
                            <UserMinus size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {activeTab === 'pending' && (
            <>
              <h2 className="panel-heading">Incoming Requests</h2>
              <p className="panel-sub">Click Accept once to unlock DMs and group invites.</p>

              <div className="surface-box">
                {incomingRequests.length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    No incoming friend requests.
                  </div>
                ) : (
                  incomingRequests.map((req) => (
                    <div key={req.id} className="list-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar
                          username={req.peer.username}
                          avatarPath={req.peer.avatar_path}
                          avatarUpdatedAt={req.peer.avatar_updated_at}
                          size={34}
                        />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>@{req.peer.username}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            Wants to connect
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busyId === req.id}
                          onClick={() => void handleAccept(req.id)}
                        >
                          <Check size={13} />
                          Accept
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busyId === req.id}
                          onClick={() => void handleRemove(req.id)}
                        >
                          <X size={13} />
                          Decline
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <h2 className="panel-heading" style={{ marginTop: 22 }}>
                Outgoing Requests
              </h2>
              <p className="panel-sub">Waiting on the recipient to accept.</p>

              <div className="surface-box">
                {outgoingRequests.length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    No outgoing pending requests.
                  </div>
                ) : (
                  outgoingRequests.map((req) => (
                    <div key={req.id} className="list-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar
                          username={req.peer.username}
                          avatarPath={req.peer.avatar_path}
                          avatarUpdatedAt={req.peer.avatar_updated_at}
                          size={34}
                        />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>@{req.peer.username}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Pending</div>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busyId === req.id}
                        onClick={() => void handleRemove(req.id)}
                      >
                        Cancel
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {activeTab === 'add' && (
            <>
              <h2 className="panel-heading">Add a Friend</h2>
              <p className="panel-sub">
                Search is exact-match only for privacy. Enter their exact username or friend code.
              </p>

              <div className="surface-box">
                <form onSubmit={handleAddSubmit} style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    type="text"
                    placeholder="Exact username or friend code (e.g. K9MX-4P2Q)"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                  />
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submitting || !identifier.trim()}
                  >
                    <UserPlus size={14} />
                    {submitting ? 'Sending…' : 'Send'}
                  </button>
                </form>

                {feedback && (
                  <div
                    className={feedback.type === 'err' ? 'notice-error' : 'notice-muted'}
                    style={{ marginTop: 12 }}
                  >
                    {feedback.text}
                  </div>
                )}
              </div>

              <h2 className="panel-heading" style={{ marginTop: 22 }}>
                Your Invite Code & Link
              </h2>
              <p className="panel-sub">Share either with someone you trust.</p>

              <div className="surface-box">
                <div className="list-row">
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Friend Code</div>
                    <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
                      {profile.friend_code}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void copyText(profile.friend_code, 'code')}
                  >
                    <Copy size={13} />
                    {copiedKey === 'code' ? 'Copied' : 'Copy Code'}
                  </button>
                </div>

                <div className="list-row">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Quick Invite Link
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 420,
                      }}
                    >
                      {inviteUrl}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void copyText(inviteUrl, 'link')}
                  >
                    <Copy size={13} />
                    {copiedKey === 'link' ? 'Copied' : 'Copy Link'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
};
