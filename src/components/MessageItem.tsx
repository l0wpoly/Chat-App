import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { formatClockTime, formatMinutesLeft } from '../lib/format';
import { renderMinimalMarkdown } from '../lib/markdown';
import { getSignedUrl } from '../lib/storage';
import type { MessageWithSender } from '../types';
import { AudioPlayer } from './AudioPlayer';
import { Avatar } from './Avatar';

interface MessageItemProps {
  message: MessageWithSender;
  isOwn: boolean;
  showHeader: boolean;
  onDelete: (msg: MessageWithSender) => Promise<void>;
  onOpenImage: (src: string, name: string) => void;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  isOwn,
  showHeader,
  onDelete,
  onOpenImage,
}) => {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!message.media_path || message.media_type === 'text') {
      setMediaUrl(null);
      return;
    }

    getSignedUrl('chat-media', message.media_path, message.id).then((url) => {
      if (!cancelled) setMediaUrl(url);
    });

    return () => {
      cancelled = true;
    };
  }, [message.id, message.media_path, message.media_type]);

  const username = message.sender?.username ?? 'member';

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={`message-row ${showHeader ? 'with-header' : ''}`}>
      <div className="message-gutter">
        {showHeader ? (
          <Avatar
            username={username}
            avatarPath={message.sender?.avatar_path ?? null}
            avatarUpdatedAt={message.sender?.avatar_updated_at ?? null}
            size={32}
          />
        ) : (
          <span className="message-gutter-time">{formatClockTime(message.created_at)}</span>
        )}
      </div>

      <div className="message-body">
        {showHeader && (
          <div className="message-meta">
            <span className="message-author">@{username}</span>
            <span className="message-time">{formatClockTime(message.created_at)}</span>
            <span className="message-ttl">{formatMinutesLeft(message.created_at)}</span>
          </div>
        )}

        {message.content && (
          <div className="message-text">{renderMinimalMarkdown(message.content)}</div>
        )}

        {message.media_type === 'image' && mediaUrl && (
          <div className="media-card">
            <button
              type="button"
              className="media-image-btn"
              onClick={() => onOpenImage(mediaUrl, message.media_name || 'image.webp')}
              title="Expand image"
            >
              <img src={mediaUrl} alt={message.media_name || 'Attachment'} loading="lazy" />
            </button>
          </div>
        )}

        {message.media_type === 'video' && mediaUrl && (
          <div className="media-card">
            <video src={mediaUrl} controls preload="metadata" className="media-video" />
          </div>
        )}

        {message.media_type === 'audio' && mediaUrl && (
          <div className="media-card">
            <AudioPlayer src={mediaUrl} name={message.media_name || 'Audio track'} />
          </div>
        )}
      </div>

      {isOwn && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
          <button
            type="button"
            className="btn-icon message-delete-btn"
            style={{ width: 26, height: 26 }}
            onClick={handleDelete}
            disabled={deleting}
            title="Delete message now"
            aria-label="Delete message"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
};
