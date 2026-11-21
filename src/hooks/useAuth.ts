import { useCallback, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

export interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    username: string,
    email: string,
    password: string
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  updateProfile: (
    patch: Partial<Pick<Profile, 'bio' | 'avatar_path' | 'avatar_size_bytes' | 'avatar_updated_at'>>
  ) => Promise<Profile>;
  refreshProfile: () => Promise<void>;
}

async function fetchProfileWithRetry(userId: string): Promise<Profile | null> {
  if (!supabase) return null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (!error && data) {
      return data as Profile;
    }

    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  return null;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(supabase));

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    const p = await fetchProfileWithRetry(userId);
    setProfile(p);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      await loadProfile(data.session?.user?.id);
      if (mounted) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      void loadProfile(nextSession?.user?.id);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!supabase || !userId) return;

    const channel = supabase
      .channel(`profile:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          if (payload.new && typeof payload.new === 'object' && 'id' in payload.new) {
            setProfile(payload.new as Profile);
          }
        }
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [session?.user?.id]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw new Error(error.message);
  }, []);

  const signUp = useCallback(async (username: string, email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,24}$/.test(cleanUsername)) {
      throw new Error('Username must be 3–24 characters using a–z, 0–9, _ or .');
    }

    const { data: available, error: availErr } = await supabase.rpc('is_username_available', {
      candidate: cleanUsername,
    });
    if (availErr) throw new Error(availErr.message);
    if (!available) {
      throw new Error(`@${cleanUsername} is already taken.`);
    }

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { username: cleanUsername },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) throw new Error(error.message);

    return {
      needsEmailConfirmation: !data.session,
    };
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  }, []);

  const updateProfile = useCallback(
    async (
      patch: Partial<
        Pick<Profile, 'bio' | 'avatar_path' | 'avatar_size_bytes' | 'avatar_updated_at'>
      >
    ) => {
      if (!supabase || !session?.user) {
        throw new Error('Not signed in.');
      }
      const { data, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', session.user.id)
        .select('*')
        .single();

      if (error) throw new Error(error.message);
      const updated = data as Profile;
      setProfile(updated);
      return updated;
    },
    [session?.user]
  );

  const refreshProfile = useCallback(async () => {
    await loadProfile(session?.user?.id);
  }, [loadProfile, session?.user?.id]);

  return {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signIn,
    signUp,
    signOut,
    updateProfile,
    refreshProfile,
  };
}
