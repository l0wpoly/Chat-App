import React, { useEffect, useState } from 'react';
import { getSignedUrl } from '../lib/storage';

interface AvatarProps {
  username: string;
  avatarPath: string | null;
  avatarUpdatedAt?: string | null;
  size?: number;
  online?: boolean;
}

export const Avatar: React.FC<AvatarProps> = ({
  username,
  avatarPath,
  avatarUpdatedAt,
  size = 32,
  online = false,
}) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!avatarPath) {
      setUrl(null);
      return;
    }

    getSignedUrl('avatars', avatarPath, avatarUpdatedAt).then((signed) => {
      if (!cancelled) setUrl(signed);
    });

    return () => {
      cancelled = true;
    };
  }, [avatarPath, avatarUpdatedAt]);

  const initials = (username || '?').slice(0, 2).toUpperCase();
  const fontSize = Math.max(10, Math.round(size * 0.36));

  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize }}
      aria-label={username}
    >
      {url ? <img src={url} alt={username} /> : initials}
      {online && <span className="avatar-online-dot" title="Online" />}
    </span>
  );
};
