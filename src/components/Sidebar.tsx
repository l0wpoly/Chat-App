import React from 'react';
import { Hash, Phone, PhoneOff, Plus } from 'lucide-react';
import type {
  ConversationSummary,
  FriendsTab,
  FriendshipWithProfile,
  Profile,
  RailSection,
  SettingsTab,
} from '../types';
import { Avatar } from './Avatar';

interface SidebarProps {
  section: RailSection;
  profile: Profile;
  dms: ConversationSummary[];
  groups: ConversationSummary[];
  friends: FriendshipWithProfile[];
  pendingCount: number;
  activeConversationId: string | null;
  friendsTab: FriendsTab;
  settingsTab: SettingsTab;
  onlineUserIds: Set<string>;
  activeCallsByConversation: Map<string, number>;
  inCallConversationId: string | null;
  inCallTitle: string | null;
  onSelectConversation: (convId: string) => void;
  onStartDmWithFriend: (friendId: string) => void;
  onOpenCreateGroup: () => void;
  onSelectFriendsTab: (tab: FriendsTab) => void;
  onSelectSettingsTab: (tab: SettingsTab) => void;
  onLeaveCall: () => void;
  onReturnToCallStage: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  section,
  profile,
  dms,
  groups,
  friends,
  pendingCount,
  activeConversationId,
  friendsTab,
  settingsTab,
  onlineUserIds,
  activeCallsByConversation,
  inCallConversationId,
  inCallTitle,
  onSelectConversation,
  onStartDmWithFriend,
  onOpenCreateGroup,
  onSelectFriendsTab,
  onSelectSettingsTab,
  onLeaveCall,
  onReturnToCallStage,
}) => {
  const existingDmPeerIds = new Set(dms.map((d) => d.dmPeer?.id).filter(Boolean) as string[]);
  const quickFriends = friends.filter((f) => !existingDmPeerIds.has(f.peer.id));

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">
          {section === 'dms' && 'Direct Messages'}
          {section === 'groups' && 'Group Chats'}
          {section === 'friends' && 'Friends'}
          {section === 'settings' && 'Settings'}
        </span>

        {section === 'groups' && (
          <button
            type="button"
            className="btn-icon bordered"
            onClick={onOpenCreateGroup}
            title="New group chat"
            aria-label="New group chat"
          >
            <Plus size={15} />
          </button>
        )}
      </div>

      <div className="sidebar-scroll">
        {section === 'dms' && (
          <>
            <div className="sidebar-section-label">Active Conversations</div>
            {dms.length === 0 && (
              <div style={{ padding: '8px', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                No DMs yet. Pick an accepted friend below or add friends first.
              </div>
            )}
            {dms.map((dm) => {
              const peer = dm.dmPeer;
              if (!peer) return null;
              const isOnline = onlineUserIds.has(peer.id);
              const callCount = activeCallsByConversation.get(dm.id) ?? 0;

              return (
                <button
                  key={dm.id}
                  type="button"
                  className={`sidebar-item ${activeConversationId === dm.id ? 'active' : ''}`}
                  onClick={() => onSelectConversation(dm.id)}
                >
                  <Avatar
                    username={peer.username}
                    avatarPath={peer.avatar_path}
                    avatarUpdatedAt={peer.avatar_updated_at}
                    size={30}
                    online={isOnline}
                  />
                  <div className="sidebar-item-main">
                    <div className="sidebar-item-name">@{peer.username}</div>
                    <div className="sidebar-item-sub">
                      {isOnline ? 'Online' : 'Offline'}
                      {callCount > 0 ? ` · In call (${callCount})` : ''}
                    </div>
                  </div>
                  {callCount > 0 && <Phone size={13} />}
                </button>
              );
            })}

            {quickFriends.length > 0 && (
              <>
                <div className="sidebar-section-label" style={{ marginTop: 10 }}>
                  Start a DM
                </div>
                {quickFriends.map((f) => {
                  const isOnline = onlineUserIds.has(f.peer.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      className="sidebar-item"
                      onClick={() => onStartDmWithFriend(f.peer.id)}
                    >
                      <Avatar
                        username={f.peer.username}
                        avatarPath={f.peer.avatar_path}
                        avatarUpdatedAt={f.peer.avatar_updated_at}
                        size={28}
                        online={isOnline}
                      />
                      <div className="sidebar-item-main">
                        <div className="sidebar-item-name">@{f.peer.username}</div>
                        <div className="sidebar-item-sub">Click to message</div>
                      </div>
                    </button>
                  );
                })}
              </>
            )}
          </>
        )}

        {section === 'groups' && (
          <>
            <div className="sidebar-section-label">Your Groups</div>
            {groups.length === 0 && (
              <div style={{ padding: '8px', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                No group chats yet. Click <strong>+</strong> above to create one with friends.
              </div>
            )}
            {groups.map((g) => {
              const callCount = activeCallsByConversation.get(g.id) ?? 0;
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`sidebar-item ${activeConversationId === g.id ? 'active' : ''}`}
                  onClick={() => onSelectConversation(g.id)}
                >
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-hairline)',
                      background: 'var(--bg-base)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Hash size={14} />
                  </span>
                  <div className="sidebar-item-main">
                    <div className="sidebar-item-name">{g.name || 'Untitled group'}</div>
                    <div className="sidebar-item-sub">
                      {g.members.length} member{g.members.length === 1 ? '' : 's'}
                      {callCount > 0 ? ` · ${callCount} in call` : ''}
                    </div>
                  </div>
                  {callCount > 0 && <Phone size={13} />}
                </button>
              );
            })}
          </>
        )}

        {section === 'friends' && (
          <>
            <div className="sidebar-section-label">Manage</div>
            <button
              type="button"
              className={`sidebar-item ${friendsTab === 'all' ? 'active' : ''}`}
              onClick={() => onSelectFriendsTab('all')}
            >
              <div className="sidebar-item-main">
                <div className="sidebar-item-name">All Friends</div>
              </div>
              <span className="badge mono">{friends.length}</span>
            </button>

            <button
              type="button"
              className={`sidebar-item ${friendsTab === 'pending' ? 'active' : ''}`}
              onClick={() => onSelectFriendsTab('pending')}
            >
              <div className="sidebar-item-main">
                <div className="sidebar-item-name">Pending Requests</div>
              </div>
              {pendingCount > 0 && <span className="badge badge-dark mono">{pendingCount}</span>}
            </button>

            <button
              type="button"
              className={`sidebar-item ${friendsTab === 'add' ? 'active' : ''}`}
              onClick={() => onSelectFriendsTab('add')}
            >
              <div className="sidebar-item-main">
                <div className="sidebar-item-name">Add Friend</div>
              </div>
            </button>
          </>
        )}

        {section === 'settings' && (
          <>
            <div className="sidebar-section-label">Account</div>
            <button
              type="button"
              className={`sidebar-item ${settingsTab === 'profile' ? 'active' : ''}`}
              onClick={() => onSelectSettingsTab('profile')}
            >
              <div className="sidebar-item-main">
                <div className="sidebar-item-name">Profile & Avatar</div>
              </div>
            </button>
            <button
              type="button"
              className={`sidebar-item ${settingsTab === 'privacy' ? 'active' : ''}`}
              onClick={() => onSelectSettingsTab('privacy')}
            >
              <div className="sidebar-item-main">
                <div className="sidebar-item-name">Privacy & 5GB Guard</div>
              </div>
            </button>
            <button
              type="button"
              className={`sidebar-item ${settingsTab === 'av' ? 'active' : ''}`}
              onClick={() => onSelectSettingsTab('av')}
            >
              <div className="sidebar-item-main">
                <div className="sidebar-item-name">Voice & Screen Share</div>
              </div>
            </button>
          </>
        )}
      </div>

      {inCallConversationId && (
        <div className="call-mini-bar">
          <button
            type="button"
            onClick={onReturnToCallStage}
            style={{ textAlign: 'left', minWidth: 0, flex: 1 }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 600 }}>Voice Connected</div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {inCallTitle || 'Active call'}
            </div>
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={onLeaveCall}
            title="Disconnect call"
          >
            <PhoneOff size={13} />
          </button>
        </div>
      )}

      <div className="sidebar-footer">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <Avatar
            username={profile.username}
            avatarPath={profile.avatar_path}
            avatarUpdatedAt={profile.avatar_updated_at}
            size={30}
            online
          />
          <div style={{ minWidth: 0 }}>
            <div className="sidebar-item-name">@{profile.username}</div>
            <div className="sidebar-item-sub mono">{profile.friend_code}</div>
          </div>
        </div>
      </div>
    </aside>
  );
};
