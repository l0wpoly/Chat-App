import { supabase } from './supabase';

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const signedUrlCache = new Map<string, CacheEntry>();
const TTL_SECONDS = 3600;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

function makeCacheKey(bucket: string, path: string, versionKey?: string | null): string {
  return `${bucket}:${path}:${versionKey ?? ''}`;
}

export function invalidateSignedUrl(bucket: 'avatars' | 'chat-media', path: string): void {
  const prefix = `${bucket}:${path}:`;
  for (const key of signedUrlCache.keys()) {
    if (key.startsWith(prefix)) {
      signedUrlCache.delete(key);
    }
  }
}

export async function getSignedUrl(
  bucket: 'avatars' | 'chat-media',
  path: string,
  versionKey?: string | null
): Promise<string | null> {
  if (!supabase || !path) return null;

  const key = makeCacheKey(bucket, path, versionKey);
  const cached = signedUrlCache.get(key);
  if (cached && cached.expiresAt - REFRESH_BUFFER_MS > Date.now()) {
    return cached.url;
  }

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, TTL_SECONDS);
  if (error || !data?.signedUrl) {
    return null;
  }

  signedUrlCache.set(key, {
    url: data.signedUrl,
    expiresAt: Date.now() + TTL_SECONDS * 1000,
  });

  return data.signedUrl;
}

export async function uploadAvatar(userId: string, blob: Blob): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const path = `${userId}/avatar.webp`;

  const { error } = await supabase.storage.from('avatars').upload(path, blob, {
    contentType: 'image/webp',
    upsert: true,
    cacheControl: '3600',
  });

  if (error) {
    throw new Error(error.message);
  }

  invalidateSignedUrl('avatars', path);
  return path;
}

export async function uploadChatMedia(
  conversationId: string,
  userId: string,
  messageId: string,
  blob: Blob,
  ext: string,
  contentType: string
): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const path = `${conversationId}/${userId}/${messageId}.${ext}`;

  const { error } = await supabase.storage.from('chat-media').upload(path, blob, {
    contentType,
    upsert: false,
    cacheControl: '3600',
  });

  if (error) {
    throw new Error(error.message);
  }

  return path;
}

export async function removeChatMedia(path: string): Promise<void> {
  if (!supabase || !path) return;
  invalidateSignedUrl('chat-media', path);
  await supabase.storage.from('chat-media').remove([path]);
}
