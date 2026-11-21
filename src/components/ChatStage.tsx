import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Hash,
  Info,
  Monitor,
  Paperclip,
  Phone,
  Send,
  X,
} from 'lucide-react';
import { formatBytes } from '../lib/format';
import { prepareChatMedia, type PreparedMedia } from '../lib/media';
import type {
  CallPeer,
  ConversationSummary,
  FriendshipWithProfile,
  MessageWithSender,
  Profile,
} from '../types';
import { Avatar } from './Avatar';
import { CallStage } from './CallStage';
import { GroupInfoPanel } from './GroupInfoPanel';
import { ImageLightbox } from './ImageLightbox';
import { MessageItem } from './MessageItem';

interface ChatStageProps {
  profile: Profile;
  conversation: ConversationSummary | null;
  messages: MessageWithSender[];
  messagesLoading: boolean;
  friends: FriendshipWithProfile[];
  onlineUserIds: Set<string>;
  callCountInRoom: number;
  callState: {
    activeConversationId: string | null;
    connecting: boolean;
    error: string | null;
    muted: boolean;
    deafened: boolean;
    sharingScreen: boolean;
    localSpeaking: boolean;
    localScreenStream: MediaStream | null;
    peers: CallPeer[];
    joinCall: (convId: string, startScreenShare?: boolean) => Promise<void>;
    leaveCall: () => Promise<void>;
    toggleMute: () => void;
    toggleDeafen: () => void;
    toggleScreenShare: () => Promise<void>;
    clearError: () => void;
  };
  onSendMessage: (text: string, media?: PreparedMedia | null) => Promise<void>;
  onDeleteMessage: (msg: MessageWithSender) => Promise<void>;
  onInviteToGroup: (convId: string, friendId: string) => Promise<void>;
  onLeaveGroup: (convId: string) => Promise<void>;
  onMobileBack: () => void;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export const ChatStage: React.FC<ChatStageProps> = ({
  profile,
  conversation,
  messages,
  messagesLoading,
  friends,
  onlineUserIds,
  callCountInRoom,
  callState,
  onSendMessage,
  onDeleteMessage,
  onInviteToGroup,
  onLeaveGroup,
  onMobileBack,
}) => {
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<PreparedMedia | null>(null);
  const [preparingMedia, setPreparingMedia] = useState(false);
  const [sending, setSending] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [showGroupDrawer, setShowGroupDrawer] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset composer state when switching rooms
  useEffect(() => {
    setDraft('');
    setAttachment(null);
    setComposerError(null);
    setShowGroupDrawer(false);
  }, [conversation?.id]);

  // Auto-scroll to newest message
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [conversation?.id, messages.length]);

  const handleSelectedFile = async (file: File | undefined | null) => {
    if (!file) return;
    setComposerError(null);
    setPreparingMedia(true);
    try {
      const prepared = await prepareChatMedia(file);
      setAttachment(prepared);
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : 'Failed to prepare file.');
    } finally {
      setPreparingMedia(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!conversation || sending || preparingMedia) return;
    if (!draft.trim() && !attachment) return;

    setComposerError(null);
    setSending(true);
    try {
      await onSendMessage(draft, attachment);
      setDraft('');
      setAttachment(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      void handleSelectedFile(files[0]);
    }
  };

  if (!conversation) {
    return (
      <main className="main-stage">
        <div className="stage-topbar">
          <div className="stage-title-wrap">
            <button
              type="button"
              className="btn-icon mobile-only"
              onClick={onMobileBack}
              aria-label="Back"
            >
              <ArrowLeft size={17} />
            </button>
            <span className="stage-title">veil</span>
          </div>
          <span className="badge mono">60m TTL</span>
        </div>

        <div className="message-empty">
          <h3>Select or start a conversation</h3>
          <p>
            Choose a direct message or group chat from the sidebar, or add a friend by exact
            username or friend code.
          </p>
        </div>
      </main>
    );
  }

  const isDm = conversation.type === 'dm';
  const dmPeer = conversation.dmPeer;
  const roomTitle = isDm ? `@${dmPeer?.username ?? 'direct'}` : conversation.name || 'Group';
  const isInThisCall = callState.activeConversationId === conversation.id;

  return (
    <main className="main-stage">
      <header className="stage-topbar">
        <div className="stage-title-wrap">
          <button
            type="button"
            className="btn-icon mobile-only"
            onClick={onMobileBack}
            aria-label="Back to list"
          >
            <ArrowLeft size={17} />
          </button>

          {isDm && dmPeer ? (
            <Avatar
              username={dmPeer.username}
              avatarPath={dmPeer.avatar_path}
              avatarUpdatedAt={dmPeer.avatar_updated_at}
              size={26}
              online={onlineUserIds.has(dmPeer.id)}
            />
          ) : (
            <Hash size={16} color="var(--text-secondary)" />
          )}

          <div style={{ minWidth: 0 }}>
            <div className="stage-title">{roomTitle}</div>
          </div>

          <span className="badge mono" title="Messages auto-purge after 60 minutes">
            60m TTL
          </span>
        </div>

        <div className="stage-actions">
          <button
            type="button"
            className={`btn btn-sm ${isInThisCall ? 'btn-primary' : ''}`}
            onClick={() =>
              isInThisCall ? void callState.leaveCall() : void callState.joinCall(conversation.id)
            }
            title={isInThisCall ? 'Leave voice call' : 'Join P2P voice call'}
          >
            <Phone size={13} />
            <span>
              {isInThisCall
                ? 'In Voice'
                : callCountInRoom > 0
                  ? `Join Voice (${callCountInRoom})`
                  : 'Voice'}
            </span>
          </button>

          <button
            type="button"
            className={`btn btn-sm ${isInThisCall && callState.sharingScreen ? 'btn-primary' : ''}`}
            onClick={() =>
              isInThisCall
                ? void callState.toggleScreenShare()
                : void callState.joinCall(conversation.id, true)
            }
            title="Share screen at 720p 30fps via WebRTC"
          >
            <Monitor size={13} />
            <span className="hide-mobile">720p Share</span>
          </button>

          {!isDm && (
            <button
              type="button"
              className={`btn-icon bordered ${showGroupDrawer ? 'active' : ''}`}
              onClick={() => setShowGroupDrawer((prev) => !prev)}
              title="Group members & settings"
              aria-label="Group info"
            >
              <Info size={15} />
            </button>
          )}
        </div>
      </header>

      <div className="chat-body-split">
        <div
          className="chat-column"
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDragActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const dropped = e.dataTransfer?.files?.[0];
            void handleSelectedFile(dropped);
          }}
        >
          {dragActive && (
            <div className="drop-overlay">Drop image, video, or audio file to attach</div>
          )}

          {isInThisCall && (
            <CallStage
              profile={profile}
              connecting={callState.connecting}
              error={callState.error}
              muted={callState.muted}
              deafened={callState.deafened}
              sharingScreen={callState.sharingScreen}
              localSpeaking={callState.localSpeaking}
              localScreenStream={callState.localScreenStream}
              peers={callState.peers}
              onToggleMute={callState.toggleMute}
              onToggleDeafen={callState.toggleDeafen}
              onToggleScreenShare={() => void callState.toggleScreenShare()}
              onLeave={() => void callState.leaveCall()}
              onClearError={callState.clearError}
            />
          )}

          <div ref={feedRef} className="message-feed">
            {messagesLoading && messages.length === 0 && (
              <div className="message-empty">
                <p>Loading ephemeral messages…</p>
              </div>
            )}

            {!messagesLoading && messages.length === 0 && (
              <div className="message-empty">
                <h3>Zero history retained</h3>
                <p>
                  Messages, images, video, and audio in {roomTitle} automatically disappear 60
                  minutes after they are sent.
                </p>
              </div>
            )}

            {messages.map((msg, idx) => {
              const prev = idx > 0 ? messages[idx - 1] : null;
              const sameSender = prev && prev.sender_id === msg.sender_id;
              const closeInTime =
                prev &&
                new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() <
                  FIVE_MINUTES_MS;
              const showHeader = !(sameSender && closeInTime);

              return (
                <MessageItem
                  key={msg.id}
                  message={msg}
                  isOwn={msg.sender_id === profile.id}
                  showHeader={showHeader}
                  onDelete={onDeleteMessage}
                  onOpenImage={(src, name) => setLightbox({ src, name })}
                />
              );
            })}
          </div>

          <div className="composer-wrap">
            {composerError && (
              <div className="notice-error" style={{ marginBottom: 8 }}>
                {composerError}
              </div>
            )}

            {preparingMedia && (
              <div className="composer-attachment">Compressing & preparing media…</div>
            )}

            {attachment && !preparingMedia && (
              <div className="composer-attachment">
                <span className="badge mono">{attachment.category}</span>
                <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {attachment.name}
                </span>
                <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                  {formatBytes(attachment.finalBytes)}
                </span>
                <button
                  type="button"
                  className="btn-icon"
                  style={{ width: 20, height: 20 }}
                  onClick={() => setAttachment(null)}
                  aria-label="Remove attachment"
                >
                  <X size={12} />
                </button>
              </div>
            )}

            <form className="composer-bar" onSubmit={handleSubmit}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/webm,video/quicktime,audio/*"
                style={{ display: 'none' }}
                onChange={(e) => void handleSelectedFile(e.target.files?.[0])}
              />

              <button
                type="button"
                className="btn-icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || preparingMedia}
                title="Attach image, video, or audio"
                aria-label="Attach media"
              >
                <Paperclip size={16} />
              </button>

              <textarea
                ref={textareaRef}
                className="composer-input"
                rows={1}
                placeholder={`Message ${roomTitle} (deletes in 60m)`}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
                }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                maxLength={4000}
              />

              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={sending || preparingMedia || (!draft.trim() && !attachment)}
                aria-label="Send message"
              >
                <Send size={13} />
              </button>
            </form>
          </div>
        </div>

        {!isDm && showGroupDrawer && (
          <GroupInfoPanel
            conversation={conversation}
            currentUserId={profile.id}
            friends={friends}
            onlineUserIds={onlineUserIds}
            onInviteFriend={(friendId) => onInviteToGroup(conversation.id, friendId)}
            onLeaveGroup={() => onLeaveGroup(conversation.id)}
          />
        )}
      </div>

      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          name={lightbox.name}
          onClose={() => setLightbox(null)}
        />
      )}
    </main>
  );
};
