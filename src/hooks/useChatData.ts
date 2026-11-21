import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type {
  ConversationMember,
  ConversationSummary,
  Friendship,
  FriendshipWithProfile,
  Profile,
} from '../types';

export function useChatData(userId: string | undefined) {
  const [friendships, setFriendships] = useState<FriendshipWithProfile[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const reload = useCallback(async () => {
    if (!supabase || !userId) {
      setFriendships([]);
      setConversations([]);
      return;
    }

    setLoading(true);
    try {
      const [friendRes, convRes, memberRes] = await Promise.all([
        supabase.from('friendships').select('*').order('updated_at', { ascending: false }),
        supabase.from('conversations').select('*').order('created_at', { ascending: false }),
        supabase.from('conversation_members').select('*').order('joined_at', { ascending: true }),
      ]);

      const rawFriendships = (friendRes.data ?? []) as Friendship[];
      const rawConvs = (convRes.data ?? []) as Array<{
        id: string;
        type: 'dm' | 'group';
        name: string | null;
        dm_key: string | null;
        created_by: string | null;
        created_at: string;
      }>;
      const rawMembers = (memberRes.data ?? []) as Array<{
        conversation_id: string;
        user_id: string;
        role: 'owner' | 'member';
        joined_at: string;
      }>;

      const profileIds = new Set<string>();
      for (const f of rawFriendships) {
        profileIds.add(f.requester_id);
        profileIds.add(f.addressee_id);
      }
      for (const m of rawMembers) {
        profileIds.add(m.user_id);
      }

      const profilesMap = new Map<string, Profile>();
      if (profileIds.size > 0) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('*')
          .in('id', Array.from(profileIds));

        for (const p of (profileRows ?? []) as Profile[]) {
          profilesMap.set(p.id, p);
        }
      }

      const mappedFriendships: FriendshipWithProfile[] = [];
      for (const f of rawFriendships) {
        const isOutgoing = f.requester_id === userId;
        const peerId = isOutgoing ? f.addressee_id : f.requester_id;
        const peer = profilesMap.get(peerId);
        if (!peer) continue;
        mappedFriendships.push({
          ...f,
          direction: isOutgoing ? 'outgoing' : 'incoming',
          peer,
        });
      }

      const membersByConv = new Map<string, ConversationMember[]>();
      for (const m of rawMembers) {
        const p = profilesMap.get(m.user_id);
        if (!p) continue;
        const list = membersByConv.get(m.conversation_id) ?? [];
        list.push({
          ...m,
          profile: p,
        });
        membersByConv.set(m.conversation_id, list);
      }

      const mappedConvs: ConversationSummary[] = rawConvs.map((c) => {
        const members = membersByConv.get(c.id) ?? [];
        const dmPeer =
          c.type === 'dm'
            ? (members.find((m) => m.user_id !== userId)?.profile ?? null)
            : null;
        return {
          ...c,
          members,
          dmPeer,
        };
      });

      setFriendships(mappedFriendships);
      setConversations(mappedConvs);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!supabase || !userId) return;

    const channel = supabase
      .channel(`chat-meta:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => {
        void reload();
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_members' },
        () => {
          void reload();
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        void reload();
      })
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [reload, userId]);

  const friends = useMemo(
    () => friendships.filter((f) => f.status === 'accepted'),
    [friendships]
  );

  const incomingRequests = useMemo(
    () => friendships.filter((f) => f.status === 'pending' && f.direction === 'incoming'),
    [friendships]
  );

  const outgoingRequests = useMemo(
    () => friendships.filter((f) => f.status === 'pending' && f.direction === 'outgoing'),
    [friendships]
  );

  const dms = useMemo(() => conversations.filter((c) => c.type === 'dm'), [conversations]);
  const groups = useMemo(() => conversations.filter((c) => c.type === 'group'), [conversations]);

  const sendFriendRequest = useCallback(
    async (identifier: string) => {
      if (!supabase) throw new Error('Supabase is not configured.');
      const { data, error } = await supabase.rpc('send_friend_request', {
        identifier: identifier.trim(),
      });
      if (error) throw new Error(error.message);
      await reload();
      return data as { status: 'pending' | 'accepted'; username: string };
    },
    [reload]
  );

  const acceptFriendRequest = useCallback(
    async (reqId: string) => {
      if (!supabase) throw new Error('Supabase is not configured.');
      const { error } = await supabase.rpc('accept_friend_request', { req_id: reqId });
      if (error) throw new Error(error.message);
      await reload();
    },
    [reload]
  );

  const removeFriendship = useCallback(
    async (friendshipId: string) => {
      if (!supabase) throw new Error('Supabase is not configured.');
      const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
      if (error) throw new Error(error.message);
      await reload();
    },
    [reload]
  );

  const openOrCreateDm = useCallback(
    async (friendId: string): Promise<string> => {
      if (!supabase) throw new Error('Supabase is not configured.');
      const { data, error } = await supabase.rpc('get_or_create_dm', { friend_id: friendId });
      if (error) throw new Error(error.message);
      await reload();
      return data as string;
    },
    [reload]
  );

  const createGroup = useCallback(
    async (name: string, memberIds: string[]): Promise<string> => {
      if (!supabase) throw new Error('Supabase is not configured.');
      const { data, error } = await supabase.rpc('create_group_chat', {
        group_name: name.trim(),
        member_ids: memberIds,
      });
      if (error) throw new Error(error.message);
      await reload();
      return data as string;
    },
    [reload]
  );

  const inviteToGroup = useCallback(
    async (convId: string, targetUserId: string) => {
      if (!supabase) throw new Error('Supabase is not configured.');
      const { error } = await supabase.rpc('invite_to_group', {
        conv_id: convId,
        target_user_id: targetUserId,
      });
      if (error) throw new Error(error.message);
      await reload();
    },
    [reload]
  );

  const leaveConversation = useCallback(
    async (convId: string) => {
      if (!supabase) throw new Error('Supabase is not configured.');
      const { error } = await supabase.rpc('leave_conversation', { conv_id: convId });
      if (error) throw new Error(error.message);
      await reload();
    },
    [reload]
  );

  return {
    loading,
    friends,
    incomingRequests,
    outgoingRequests,
    conversations,
    dms,
    groups,
    reload,
    sendFriendRequest,
    acceptFriendRequest,
    removeFriendship,
    openOrCreateDm,
    createGroup,
    inviteToGroup,
    leaveConversation,
  };
}
