import React, { useEffect, useMemo, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { ChatStage } from './components/ChatStage';
import { ConfigRequiredScreen } from './components/ConfigRequiredScreen';
import { CreateGroupModal } from './components/CreateGroupModal';
import { FriendsPanel } from './components/FriendsPanel';
import { InviteBanner } from './components/InviteBanner';
import { LeftRail } from './components/LeftRail';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { useAuth } from './hooks/useAuth';
import { useCall } from './hooks/useCall';
import { useChatData } from './hooks/useChatData';
import { useMessages } from './hooks/useMessages';
import { usePresence } from './hooks/usePresence';
import { isSupabaseConfigured } from './lib/supabase';
import type { FriendsTab, Profile, RailSection, SettingsTab } from './types';

const INVITE_STORAGE_KEY = 'veil_pending_invite';

function extractInitialInvite(): string | null {
  const match = window.location.pathname.match(/^\/invite\/([A-Za-z0-9-]+)$/);
  if (match && match[1]) {
    const code = match[1].toUpperCase();
    window.sessionStorage.setItem(INVITE_STORAGE_KEY, code);
    window.history.replaceState({}, '', '/');
    return code;
  }
  return window.sessionStorage.getItem(INVITE_STORAGE_KEY);
}

export const App: React.FC = () => {
  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(() =>
    extractInitialInvite()
  );

  const auth = useAuth();
  const presence = usePresence(auth.user?.id);
  const chat = useChatData(auth.user?.id);
  const call = useCall(auth.profile, presence.setActiveCallId);

  const [section, setSection] = useState<RailSection>('dms');
  const [friendsTab, setFriendsTab] = useState<FriendsTab>('all');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile');
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [mobileStageActive, setMobileStageActive] = useState(false);

  const dismissInvite = () => {
    window.sessionStorage.removeItem(INVITE_STORAGE_KEY);
    setPendingInviteCode(null);
  };

  useEffect(() => {
    if (auth.profile && pendingInviteCode && pendingInviteCode === auth.profile.friend_code) {
      dismissInvite();
    }
  }, [auth.profile, pendingInviteCode]);

  // Auto-select first conversation when available
  useEffect(() => {
    if (!activeConversationId && chat.conversations.length > 0) {
      setActiveConversationId(chat.conversations[0].id);
    } else if (
      activeConversationId &&
      chat.conversations.length > 0 &&
      !chat.conversations.some((c) => c.id === activeConversationId)
    ) {
      setActiveConversationId(chat.conversations[0].id);
    }
  }, [activeConversationId, chat.conversations]);

  const activeConversation = useMemo(
    () => chat.conversations.find((c) => c.id === activeConversationId) ?? null,
    [activeConversationId, chat.conversations]
  );

  const profilesMap = useMemo(() => {
    const map = new Map<string, Profile>();
    if (auth.profile) map.set(auth.profile.id, auth.profile);
    for (const f of chat.friends) map.set(f.peer.id, f.peer);
    for (const c of chat.conversations) {
      for (const m of c.members) {
        map.set(m.profile.id, m.profile);
      }
    }
    return map;
  }, [auth.profile, chat.conversations, chat.friends]);

  const messagesState = useMessages(activeConversationId, auth.user?.id, profilesMap);

  const inCallConversation = useMemo(
    () => chat.conversations.find((c) => c.id === call.activeConversationId) ?? null,
    [call.activeConversationId, chat.conversations]
  );

  const inCallTitle = inCallConversation
    ? inCallConversation.type === 'dm'
      ? `@${inCallConversation.dmPeer?.username ?? 'direct'}`
      : inCallConversation.name || 'Group'
    : null;

  if (!isSupabaseConfigured) {
    return <ConfigRequiredScreen />;
  }

  if (auth.loading) {
    return (
      <div className="center-screen">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <span className="brand-square">v.</span>
          <span style={{ color: 'var(--text-secondary)' }}>Loading session…</span>
        </div>
      </div>
    );
  }

  if (!auth.user || !auth.profile) {
    return (
      <AuthScreen
        onSignIn={auth.signIn}
        onSignUp={auth.signUp}
        pendingInviteCode={pendingInviteCode}
      />
    );
  }

  const handleSelectSection = (next: RailSection) => {
    setSection(next);
    if (next === 'friends' || next === 'settings') {
      setMobileStageActive(true);
    } else {
      setMobileStageActive(false);
    }
  };

  const handleSelectConversation = (convId: string) => {
    const conv = chat.conversations.find((c) => c.id === convId);
    if (conv) {
      setSection(conv.type === 'group' ? 'groups' : 'dms');
    }
    setActiveConversationId(convId);
    setMobileStageActive(true);
  };

  const handleStartDm = async (friendId: string) => {
    const convId = await chat.openOrCreateDm(friendId);
    setSection('dms');
    setActiveConversationId(convId);
    setMobileStageActive(true);
  };

  const handleCreateGroup = async (name: string, memberIds: string[]) => {
    const convId = await chat.createGroup(name, memberIds);
    setSection('groups');
    setActiveConversationId(convId);
    setMobileStageActive(true);
  };

  const handleLeaveGroup = async (convId: string) => {
    if (call.activeConversationId === convId) {
      await call.leaveCall();
    }
    await chat.leaveConversation(convId);
    if (activeConversationId === convId) {
      setActiveConversationId(null);
      setMobileStageActive(false);
    }
  };

  const handleSignOut = async () => {
    await call.leaveCall();
    await auth.signOut();
  };

  return (
    <div className={`app-shell ${mobileStageActive ? 'mobile-stage-active' : ''}`}>
      <LeftRail
        activeSection={section}
        onSelectSection={handleSelectSection}
        pendingCount={chat.incomingRequests.length}
        onSignOut={() => void handleSignOut()}
      />

      <Sidebar
        section={section}
        profile={auth.profile}
        dms={chat.dms}
        groups={chat.groups}
        friends={chat.friends}
        pendingCount={chat.incomingRequests.length}
        activeConversationId={activeConversationId}
        friendsTab={friendsTab}
        settingsTab={settingsTab}
        onlineUserIds={presence.onlineUserIds}
        activeCallsByConversation={presence.activeCallsByConversation}
        inCallConversationId={call.activeConversationId}
        inCallTitle={inCallTitle}
        onSelectConversation={handleSelectConversation}
        onStartDmWithFriend={(id) => void handleStartDm(id)}
        onOpenCreateGroup={() => setShowCreateGroup(true)}
        onSelectFriendsTab={(tab) => {
          setFriendsTab(tab);
          setMobileStageActive(true);
        }}
        onSelectSettingsTab={(tab) => {
          setSettingsTab(tab);
          setMobileStageActive(true);
        }}
        onLeaveCall={() => void call.leaveCall()}
        onReturnToCallStage={() => {
          if (call.activeConversationId) {
            handleSelectConversation(call.activeConversationId);
          }
        }}
      />

      <div className="stage-host">
        {pendingInviteCode && (
          <InviteBanner
            code={pendingInviteCode}
            onAcceptInvite={chat.sendFriendRequest}
            onDismiss={dismissInvite}
          />
        )}

        {section === 'friends' ? (
          <FriendsPanel
            profile={auth.profile}
            activeTab={friendsTab}
            friends={chat.friends}
            incomingRequests={chat.incomingRequests}
            outgoingRequests={chat.outgoingRequests}
            onlineUserIds={presence.onlineUserIds}
            onSelectTab={setFriendsTab}
            onSendRequest={chat.sendFriendRequest}
            onAcceptRequest={chat.acceptFriendRequest}
            onRemoveFriendship={chat.removeFriendship}
            onMessageFriend={handleStartDm}
            onMobileBack={() => setMobileStageActive(false)}
          />
        ) : section === 'settings' ? (
          <SettingsView
            profile={auth.profile}
            activeTab={settingsTab}
            onSelectTab={setSettingsTab}
            onUpdateProfile={auth.updateProfile}
            onMobileBack={() => setMobileStageActive(false)}
          />
        ) : (
          <ChatStage
            profile={auth.profile}
            conversation={activeConversation}
            messages={messagesState.messages}
            messagesLoading={messagesState.loading}
            friends={chat.friends}
            onlineUserIds={presence.onlineUserIds}
            callCountInRoom={
              activeConversation
                ? (presence.activeCallsByConversation.get(activeConversation.id) ?? 0)
                : 0
            }
            callState={call}
            onSendMessage={messagesState.sendMessage}
            onDeleteMessage={messagesState.deleteMessage}
            onInviteToGroup={chat.inviteToGroup}
            onLeaveGroup={handleLeaveGroup}
            onMobileBack={() => setMobileStageActive(false)}
          />
        )}
      </div>

      {showCreateGroup && (
        <CreateGroupModal
          friends={chat.friends}
          onClose={() => setShowCreateGroup(false)}
          onCreate={handleCreateGroup}
        />
      )}
    </div>
  );
};

export default App;
