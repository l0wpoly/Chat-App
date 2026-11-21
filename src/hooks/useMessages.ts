import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreparedMedia } from '../lib/media';
import { removeChatMedia, uploadChatMedia } from '../lib/storage';
import { supabase } from '../lib/supabase';
import type { Message, MessageWithSender, Profile } from '../types';

const ONE_HOUR_MS = 60 * 60 * 1000;

function isWithinHour(iso: string, nowMs = Date.now()): boolean {
  return nowMs - new Date(iso).getTime() < ONE_HOUR_MS;
}

export function useMessages(
  conversationId: string | null,
  currentUserId: string | undefined,
  profilesMap: Map<string, Profile>
) {
  const [messages, setMessages] = useState<MessageWithSender[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const profilesMapRef = useRef(profilesMap);
  profilesMapRef.current = profilesMap;

  const hydrateMessage = useCallback(async (msg: Message): Promise<MessageWithSender> => {
    const cached = profilesMapRef.current.get(msg.sender_id);
    if (cached) {
      return { ...msg, sender: cached };
    }

    if (supabase) {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', msg.sender_id)
        .maybeSingle();
      if (data) {
        return { ...msg, sender: data as Profile };
      }
    }

    return { ...msg, sender: null };
  }, []);

  useEffect(() => {
    if (!supabase || !conversationId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const cutoffIso = new Date(Date.now() - ONE_HOUR_MS).toISOString();

    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .gt('created_at', cutoffIso)
      .order('created_at', { ascending: true })
      .limit(250)
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoading(false);
        if (error || !data) {
          setMessages([]);
          return;
        }
        const now = Date.now();
        const hydrated = (data as Message[])
          .filter((m) => isWithinHour(m.created_at, now))
          .map((m) => ({
            ...m,
            sender: profilesMapRef.current.get(m.sender_id) ?? null,
          }));
        setMessages(hydrated);
      });

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          if (cancelled) return;
          const incoming = payload.new as Message;
          if (!isWithinHour(incoming.created_at)) return;
          const hydrated = await hydrateMessage(incoming);
          if (cancelled) return;
          setMessages((prev) => {
            if (prev.some((m) => m.id === hydrated.id)) return prev;
            const next = [...prev, hydrated];
            next.sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            return next;
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (cancelled) return;
          const oldRow = payload.old as { id?: string } | null;
          if (oldRow?.id) {
            setMessages((prev) => prev.filter((m) => m.id !== oldRow.id));
          }
        }
      )
      .subscribe();

    const expirySweep = window.setInterval(() => {
      const now = Date.now();
      setMessages((prev) => {
        const filtered = prev.filter((m) => isWithinHour(m.created_at, now));
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(expirySweep);
      void supabase?.removeChannel(channel);
    };
  }, [conversationId, hydrateMessage]);

  const sendMessage = useCallback(
    async (rawText: string, media?: PreparedMedia | null) => {
      if (!supabase || !conversationId || !currentUserId) {
        throw new Error('Select a conversation first.');
      }

      const trimmed = rawText.trim();
      if (!trimmed && !media) return;

      const messageId = crypto.randomUUID();
      let mediaPath: string | null = null;

      if (media) {
        mediaPath = await uploadChatMedia(
          conversationId,
          currentUserId,
          messageId,
          media.blob,
          media.ext,
          media.mime
        );
      }

      const insertPayload = {
        id: messageId,
        conversation_id: conversationId,
        sender_id: currentUserId,
        content: trimmed || null,
        media_type: media ? media.category : 'text',
        media_path: mediaPath,
        media_name: media ? media.name : null,
        media_mime: media ? media.mime : null,
        media_size_bytes: media ? media.finalBytes : 0,
      };

      const { data, error } = await supabase
        .from('messages')
        .insert(insertPayload)
        .select('*')
        .single();

      if (error) {
        if (mediaPath) {
          await removeChatMedia(mediaPath);
        }
        throw new Error(error.message);
      }

      const inserted = data as Message;
      const hydrated: MessageWithSender = {
        ...inserted,
        sender: profilesMapRef.current.get(inserted.sender_id) ?? null,
      };

      setMessages((prev) => {
        if (prev.some((m) => m.id === hydrated.id)) return prev;
        return [...prev, hydrated];
      });
    },
    [conversationId, currentUserId]
  );

  const deleteMessage = useCallback(async (msg: MessageWithSender) => {
    if (!supabase) return;
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));

    const { error } = await supabase.from('messages').delete().eq('id', msg.id);
    if (error) {
      throw new Error(error.message);
    }
    if (msg.media_path) {
      await removeChatMedia(msg.media_path);
    }
  }, []);

  return {
    messages,
    loading,
    sendMessage,
    deleteMessage,
  };
}
