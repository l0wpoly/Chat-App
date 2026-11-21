import React, { useState } from 'react';
import { LogOut, UserPlus } from 'lucide-react';
import type { ConversationSummary, FriendshipWithProfile } from '../types';
import { Avatar } from './Avatar';

interface GroupInfoPanelProps {
  conversation: ConversationSummary;
  currentUserId: string;
  friends: FriendshipWithProfile[];
  onlineUserIds: Set<string>;
  onInviteFriend: (friendId: string) => Promise<void>;
  onLeaveGroup: () => Promise<void>;
}

export const GroupInfoPanel: React.FC<GroupInfoPanelProps> = ({
  conversation,
  currentUserId,
  friends,
  onlineUserIds,
  onInviteFriend,
  onLeaveGroup,
}) => {
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const memberIdSet = new Set(conversation.members.map((m) => m.user_id));
  const invitableFriends = friends.filter((f) => !memberIdSet.has(f.peer.id));

  const handleInvite = async (friendId: string) => {
    setInvitingId(friendId);
    try {
      await onInviteFriend(friendId);
    } finally {
      setInvitingId(null);
    }
  };

  const handleLeave = async () => {
    setLeaving(true);
    try {
      await onLeaveGroup();
    } finally {
      setLeaving(false);
    }
  };

  return (
    <aside className="group-drawer" aria-label="Group details">
      <div className="sidebar-section-label" style={{ paddingLeft: 0 }}>
        Members ({conversation.members.length})
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
        {conversation.members.map((m) => (
          <div
            key={m.user_id}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <Avatar
                username={m.profile.username}
                avatarPath={m.profile.avatar_path}
                avatarUpdatedAt={m.profile.avatar_updated_at}
                size={24}
                online={onlineUserIds.has(m.user_id)}
              />
              <span
                style={{
                  fontSize: 12.5,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                @{m.profile.username}
                {m.user_id === currentUserId ? ' (you)' : ''}
              </span>
            </div>
            {m.role === 'owner' && <span className="badge">owner</span>}
          </div>
        ))}
      </div>

      <div className="sidebar-section-label" style={{ paddingLeft: 0 }}>
        Invite Friends
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {invitableFriends.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            All your accepted friends are already in this group.
          </div>
        ) : (
          invitableFriends.map((f) => (
            <div
              key={f.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <Avatar
                  username={f.peer.username}
                  avatarPath={f.peer.avatar_path}
                  avatarUpdatedAt={f.peer.avatar_updated_at}
                  size={24}
                />
                <span
                  style={{
                    fontSize: 12.5,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  @{f.peer.username}
                </span>
              </div>

              <button
                type="button"
                className="btn btn-sm"
                disabled={invitingId === f.peer.id}
                onClick={() => void handleInvite(f.peer.id)}
              >
                <UserPlus size={12} />
                Add
              </button>
            </div>
          ))
        )}
      </div>

      <div style={{ paddingTop: 14, borderTop: '1px solid var(--border-hairline)' }}>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          style={{ width: '100%' }}
          disabled={leaving}
          onClick={() => void handleLeave()}
        >
          <LogOut size={13} />
          {leaving ? 'Leaving…' : 'Leave Group'}
        </button>
      </div>
    </aside>
  );
};
