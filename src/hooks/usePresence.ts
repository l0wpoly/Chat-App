import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface PresencePayload {
  userId: string;
  activeCallId: string | null;
}

export function usePresence(userId: string | undefined) {
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(() => new Set());
  const [activeCallsByConversation, setActiveCallsByConversation] = useState<Map<string, number>>(
    () => new Map()
  );
  const channelRef = useRef<RealtimeChannel | null>(null);
  const activeCallRef = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase || !userId) {
      setOnlineUserIds(new Set());
      setActiveCallsByConversation(new Map());
      return;
    }

    const channel = supabase.channel('presence:veil', {
      config: { presence: { key: userId } },
    });

    channelRef.current = channel;

    const syncState = () => {
      const state = channel.presenceState<PresencePayload>();
      const online = new Set<string>();
      const callCounts = new Map<string, number>();

      for (const [key, metas] of Object.entries(state)) {
        online.add(key);
        const latest = metas[metas.length - 1];
        if (latest?.activeCallId) {
          callCounts.set(latest.activeCallId, (callCounts.get(latest.activeCallId) ?? 0) + 1);
        }
      }

      setOnlineUserIds(online);
      setActiveCallsByConversation(callCounts);
    };

    channel
      .on('presence', { event: 'sync' }, syncState)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            userId,
            activeCallId: activeCallRef.current,
          });
        }
      });

    return () => {
      channelRef.current = null;
      void supabase?.removeChannel(channel);
    };
  }, [userId]);

  const setActiveCallId = useCallback(
    async (convId: string | null) => {
      activeCallRef.current = convId;
      if (channelRef.current && userId) {
        await channelRef.current.track({
          userId,
          activeCallId: convId,
        });
      }
    },
    [userId]
  );

  return {
    onlineUserIds,
    activeCallsByConversation,
    setActiveCallId,
  };
}
