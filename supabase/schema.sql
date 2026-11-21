-- ============================================================================
-- veil — Ephemeral Monochrome Communication App
-- Complete Idempotent Supabase PostgreSQL Schema, RLS, 1h Purge & 5GB Failsafe
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL CHECK (username ~ '^[a-z0-9_.]{3,24}$'),
  bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 160),
  avatar_path text,
  avatar_size_bytes integer NOT NULL DEFAULT 0 CHECK (avatar_size_bytes >= 0 AND avatar_size_bytes <= 65536),
  avatar_updated_at timestamptz,
  friend_code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx
  ON public.profiles (lower(username));

CREATE TABLE IF NOT EXISTS public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friendships_no_self CHECK (requester_id <> addressee_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_unique_idx
  ON public.friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

CREATE INDEX IF NOT EXISTS friendships_requester_idx ON public.friendships (requester_id);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON public.friendships (addressee_id);

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('dm', 'group')),
  name text CHECK (name IS NULL OR char_length(name) <= 64),
  dm_key text UNIQUE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversation_members (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_members_user_idx
  ON public.conversation_members (user_id);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text CHECK (content IS NULL OR char_length(content) <= 4000),
  media_type text NOT NULL DEFAULT 'text' CHECK (media_type IN ('text', 'image', 'video', 'audio')),
  media_path text,
  media_name text,
  media_mime text,
  media_size_bytes bigint NOT NULL DEFAULT 0 CHECK (media_size_bytes >= 0 AND media_size_bytes <= 26214400),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_content_or_media CHECK (
    (content IS NOT NULL AND char_length(btrim(content)) > 0) OR media_path IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS messages_conv_created_idx
  ON public.messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS messages_created_at_idx
  ON public.messages (created_at ASC);

CREATE TABLE IF NOT EXISTS public.storage_cleanup_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket_id text NOT NULL,
  object_path text NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS storage_cleanup_queue_queued_idx
  ON public.storage_cleanup_queue (queued_at ASC);

CREATE TABLE IF NOT EXISTS public.storage_metrics (
  id int PRIMARY KEY CHECK (id = 1),
  messages_logical_bytes bigint NOT NULL DEFAULT 0,
  media_bytes bigint NOT NULL DEFAULT 0,
  avatars_bytes bigint NOT NULL DEFAULT 0,
  ceiling_bytes bigint NOT NULL DEFAULT 4500000000,
  target_bytes bigint NOT NULL DEFAULT 4000000000,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.storage_metrics (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. SECURITY DEFINER HELPER FUNCTIONS (RLS recursion-safe)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.try_parse_uuid(val text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF val IS NULL OR btrim(val) = '' THEN
    RETURN NULL;
  END IF;
  RETURN val::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_conversation_member(conv_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_members cm
    WHERE cm.conversation_id = conv_id
      AND cm.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.are_friends(user_a uuid, user_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.friendships f
    WHERE f.status = 'accepted'
      AND LEAST(f.requester_id, f.addressee_id) = LEAST(user_a, user_b)
      AND GREATEST(f.requester_id, f.addressee_id) = GREATEST(user_a, user_b)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_profile(target_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    target_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.friendships f
      WHERE (f.requester_id = auth.uid() AND f.addressee_id = target_id)
         OR (f.addressee_id = auth.uid() AND f.requester_id = target_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.conversation_members cm1
      JOIN public.conversation_members cm2
        ON cm1.conversation_id = cm2.conversation_id
      WHERE cm1.user_id = auth.uid()
        AND cm2.user_id = target_id
    );
$$;

CREATE OR REPLACE FUNCTION public.is_username_available(candidate text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    lower(btrim(candidate)) ~ '^[a-z0-9_.]{3,24}$'
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE lower(p.username) = lower(btrim(candidate))
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. SIGNUP PROFILE PROVISIONING
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_friend_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..8 LOOP
      IF i = 5 THEN
        code := code || '-';
      END IF;
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE friend_code = code);
  END LOOP;
  RETURN code;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_name text;
  clean_name text;
  final_name text;
  suffix text;
BEGIN
  raw_name := lower(btrim(COALESCE(new.raw_user_meta_data->>'username', '')));
  clean_name := regexp_replace(raw_name, '[^a-z0-9_.]', '_', 'g');

  IF char_length(clean_name) < 3 THEN
    clean_name := 'user_' || substr(replace(new.id::text, '-', ''), 1, 6);
  END IF;

  clean_name := substr(clean_name, 1, 24);
  final_name := clean_name;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(final_name)) THEN
    suffix := '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
    final_name := substr(clean_name, 1, 24 - length(suffix)) || suffix;
  END IF;

  INSERT INTO public.profiles (id, username, friend_code)
  VALUES (new.id, final_name, public.generate_friend_code())
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 4. FRIEND, DM & GROUP RPCs
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_friend_request(identifier text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  cleaned text;
  target_rec RECORD;
  existing_rec RECORD;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  cleaned := btrim(COALESCE(identifier, ''));
  IF cleaned = '' THEN
    RAISE EXCEPTION 'Enter a username or friend code.';
  END IF;

  IF left(cleaned, 1) = '@' THEN
    cleaned := substr(cleaned, 2);
  END IF;

  SELECT id, username
  INTO target_rec
  FROM public.profiles
  WHERE lower(username) = lower(cleaned)
     OR upper(friend_code) = upper(cleaned)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No user found with that exact username or friend code.';
  END IF;

  IF target_rec.id = caller_id THEN
    RAISE EXCEPTION 'You cannot add yourself.';
  END IF;

  SELECT id, requester_id, addressee_id, status
  INTO existing_rec
  FROM public.friendships
  WHERE LEAST(requester_id, addressee_id) = LEAST(caller_id, target_rec.id)
    AND GREATEST(requester_id, addressee_id) = GREATEST(caller_id, target_rec.id)
  LIMIT 1;

  IF FOUND THEN
    IF existing_rec.status = 'accepted' THEN
      RAISE EXCEPTION 'You are already friends with @%.', target_rec.username;
    END IF;

    IF existing_rec.requester_id = caller_id THEN
      RAISE EXCEPTION 'Friend request to @% is already pending.', target_rec.username;
    END IF;

    -- Mutual request: accept immediately
    UPDATE public.friendships
    SET status = 'accepted', updated_at = now()
    WHERE id = existing_rec.id;

    RETURN jsonb_build_object('status', 'accepted', 'username', target_rec.username);
  END IF;

  INSERT INTO public.friendships (requester_id, addressee_id, status)
  VALUES (caller_id, target_rec.id, 'pending');

  RETURN jsonb_build_object('status', 'pending', 'username', target_rec.username);
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_friend_request(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_friend_request(req_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  UPDATE public.friendships
  SET status = 'accepted', updated_at = now()
  WHERE id = req_id
    AND addressee_id = auth.uid()
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending friend request not found.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_friend_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_or_create_dm(friend_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  v_dm_key text;
  v_conv_id uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF friend_id = caller_id THEN
    RAISE EXCEPTION 'Cannot open a DM with yourself.';
  END IF;

  IF NOT public.are_friends(caller_id, friend_id) THEN
    RAISE EXCEPTION 'You can only direct message accepted friends.';
  END IF;

  v_dm_key := LEAST(caller_id, friend_id)::text || ':' || GREATEST(caller_id, friend_id)::text;

  INSERT INTO public.conversations (type, dm_key, created_by)
  VALUES ('dm', v_dm_key, caller_id)
  ON CONFLICT (dm_key) DO NOTHING;

  SELECT id INTO v_conv_id
  FROM public.conversations
  WHERE dm_key = v_dm_key;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES
    (v_conv_id, caller_id, 'member'),
    (v_conv_id, friend_id, 'member')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN v_conv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_dm(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_group_chat(group_name text, member_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  cleaned_name text;
  v_conv_id uuid;
  m_id uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  cleaned_name := btrim(COALESCE(group_name, ''));
  IF char_length(cleaned_name) < 1 OR char_length(cleaned_name) > 64 THEN
    RAISE EXCEPTION 'Group name must be between 1 and 64 characters.';
  END IF;

  IF member_ids IS NOT NULL THEN
    FOREACH m_id IN ARRAY member_ids LOOP
      IF m_id IS NOT NULL AND m_id <> caller_id THEN
        IF NOT public.are_friends(caller_id, m_id) THEN
          RAISE EXCEPTION 'You can only add accepted friends to a group chat.';
        END IF;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.conversations (type, name, created_by)
  VALUES ('group', cleaned_name, caller_id)
  RETURNING id INTO v_conv_id;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (v_conv_id, caller_id, 'owner');

  IF member_ids IS NOT NULL THEN
    FOREACH m_id IN ARRAY member_ids LOOP
      IF m_id IS NOT NULL AND m_id <> caller_id THEN
        INSERT INTO public.conversation_members (conversation_id, user_id, role)
        VALUES (v_conv_id, m_id, 'member')
        ON CONFLICT (conversation_id, user_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN v_conv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_group_chat(text, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.invite_to_group(conv_id uuid, target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  conv_type text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT type INTO conv_type
  FROM public.conversations
  WHERE id = conv_id;

  IF conv_type IS DISTINCT FROM 'group' THEN
    RAISE EXCEPTION 'Only group chats support member invitations.';
  END IF;

  IF NOT public.is_conversation_member(conv_id) THEN
    RAISE EXCEPTION 'You are not a member of this group.';
  END IF;

  IF NOT public.are_friends(caller_id, target_user_id) THEN
    RAISE EXCEPTION 'You can only invite accepted friends.';
  END IF;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (conv_id, target_user_id, 'member')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.invite_to_group(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.leave_conversation(conv_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  conv_type text;
  remaining int;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT type INTO conv_type
  FROM public.conversations
  WHERE id = conv_id;

  DELETE FROM public.conversation_members
  WHERE conversation_id = conv_id
    AND user_id = caller_id;

  IF conv_type = 'group' THEN
    SELECT count(*) INTO remaining
    FROM public.conversation_members
    WHERE conversation_id = conv_id;

    IF remaining = 0 THEN
      DELETE FROM public.conversations WHERE id = conv_id;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.leave_conversation(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. EPHEMERAL 1-HOUR PURGE & 5GB HARD CEILING FAILSAFE
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_messages_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_logical bigint;
  v_media bigint;
BEGIN
  v_logical := octet_length(COALESCE(NEW.content, '')) + 512;
  v_media := COALESCE(NEW.media_size_bytes, 0);

  UPDATE public.storage_metrics
  SET
    messages_logical_bytes = messages_logical_bytes + v_logical,
    media_bytes = media_bytes + v_media,
    updated_at = now()
  WHERE id = 1;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_messages_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_logical bigint;
  v_media bigint;
BEGIN
  v_logical := octet_length(COALESCE(OLD.content, '')) + 512;
  v_media := COALESCE(OLD.media_size_bytes, 0);

  UPDATE public.storage_metrics
  SET
    messages_logical_bytes = GREATEST(0, messages_logical_bytes - v_logical),
    media_bytes = GREATEST(0, media_bytes - v_media),
    updated_at = now()
  WHERE id = 1;

  IF OLD.media_path IS NOT NULL THEN
    INSERT INTO public.storage_cleanup_queue (bucket_id, object_path)
    VALUES ('chat-media', OLD.media_path);
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_profiles_avatar_metrics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.storage_metrics
    SET avatars_bytes = avatars_bytes + COALESCE(NEW.avatar_size_bytes, 0),
        updated_at = now()
    WHERE id = 1;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.storage_metrics
    SET avatars_bytes = GREATEST(0, avatars_bytes + COALESCE(NEW.avatar_size_bytes, 0) - COALESCE(OLD.avatar_size_bytes, 0)),
        updated_at = now()
    WHERE id = 1;
    IF OLD.avatar_path IS NOT NULL AND OLD.avatar_path IS DISTINCT FROM NEW.avatar_path THEN
      INSERT INTO public.storage_cleanup_queue (bucket_id, object_path)
      VALUES ('avatars', OLD.avatar_path);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.storage_metrics
    SET avatars_bytes = GREATEST(0, avatars_bytes - COALESCE(OLD.avatar_size_bytes, 0)),
        updated_at = now()
    WHERE id = 1;
    IF OLD.avatar_path IS NOT NULL THEN
      INSERT INTO public.storage_cleanup_queue (bucket_id, object_path)
      VALUES ('avatars', OLD.avatar_path);
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_storage_ceiling(
  p_ceiling_bytes bigint DEFAULT NULL,
  p_target_bytes bigint DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_metrics public.storage_metrics%ROWTYPE;
  v_ceiling bigint;
  v_target bigint;
  v_total bigint;
  v_budget bigint;
  v_deleted integer := 0;
BEGIN
  SELECT * INTO v_metrics
  FROM public.storage_metrics
  WHERE id = 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_ceiling := COALESCE(p_ceiling_bytes, v_metrics.ceiling_bytes);
  v_target := COALESCE(p_target_bytes, v_metrics.target_bytes);
  v_total := v_metrics.messages_logical_bytes + v_metrics.media_bytes + v_metrics.avatars_bytes;

  IF v_total < v_ceiling THEN
    RETURN 0;
  END IF;

  v_budget := GREATEST(0, v_target - v_metrics.avatars_bytes);

  WITH ranked AS (
    SELECT
      id,
      SUM(octet_length(COALESCE(content, '')) + 512 + COALESCE(media_size_bytes, 0))
        OVER (ORDER BY created_at DESC, id DESC) AS running_bytes
    FROM public.messages
  ),
  to_delete AS (
    SELECT id
    FROM ranked
    WHERE running_bytes > v_budget
  )
  DELETE FROM public.messages m
  USING to_delete d
  WHERE m.id = d.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_messages_check_ceiling()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_metrics public.storage_metrics%ROWTYPE;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_metrics
  FROM public.storage_metrics
  WHERE id = 1;

  IF FOUND AND (v_metrics.messages_logical_bytes + v_metrics.media_bytes + v_metrics.avatars_bytes) >= v_metrics.ceiling_bytes THEN
    PERFORM public.enforce_storage_ceiling();
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_messages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.messages
  WHERE created_at <= now() - interval '1 hour';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_storage_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_logical bigint;
  v_media bigint;
  v_avatars bigint;
BEGIN
  SELECT
    COALESCE(SUM(octet_length(COALESCE(content, '')) + 512), 0),
    COALESCE(SUM(COALESCE(media_size_bytes, 0)), 0)
  INTO v_logical, v_media
  FROM public.messages;

  SELECT COALESCE(SUM(COALESCE(avatar_size_bytes, 0)), 0)
  INTO v_avatars
  FROM public.profiles;

  UPDATE public.storage_metrics
  SET
    messages_logical_bytes = v_logical,
    media_bytes = v_media,
    avatars_bytes = v_avatars,
    updated_at = now()
  WHERE id = 1;

  RETURN jsonb_build_object(
    'messages_logical_bytes', v_logical,
    'media_bytes', v_media,
    'avatars_bytes', v_avatars,
    'total_bytes', v_logical + v_media + v_avatars
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_orphaned_chat_media()
RETURNS TABLE(object_path text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT o.name AS object_path
  FROM storage.objects o
  WHERE o.bucket_id = 'chat-media'
    AND (
      o.created_at < now() - interval '1 hour'
      OR (
        o.created_at < now() - interval '5 minutes'
        AND NOT EXISTS (
          SELECT 1
          FROM public.messages m
          WHERE m.media_path = o.name
        )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.enforce_storage_ceiling(bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_messages() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_storage_metrics() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_orphaned_chat_media() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enforce_storage_ceiling(bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_messages() TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_storage_metrics() TO service_role;
GRANT EXECUTE ON FUNCTION public.list_orphaned_chat_media() TO service_role;

DROP TRIGGER IF EXISTS messages_after_insert_metrics ON public.messages;
CREATE TRIGGER messages_after_insert_metrics
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_messages_after_insert();

DROP TRIGGER IF EXISTS messages_after_delete_metrics ON public.messages;
CREATE TRIGGER messages_after_delete_metrics
  AFTER DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_messages_after_delete();

DROP TRIGGER IF EXISTS messages_after_insert_ceiling ON public.messages;
CREATE TRIGGER messages_after_insert_ceiling
  AFTER INSERT ON public.messages
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_messages_check_ceiling();

DROP TRIGGER IF EXISTS profiles_avatar_metrics ON public.profiles;
CREATE TRIGGER profiles_avatar_metrics
  AFTER INSERT OR UPDATE OF avatar_size_bytes, avatar_path OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_profiles_avatar_metrics();

-- ----------------------------------------------------------------------------
-- 6. STRICT ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_cleanup_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_metrics ENABLE ROW LEVEL SECURITY;

-- Profiles: visible only to self, friends/pending requests, or shared chat members
DROP POLICY IF EXISTS "profiles_select_scoped" ON public.profiles;
CREATE POLICY "profiles_select_scoped"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.can_view_profile(id));

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Friendships: visible & removable by either party; updates only by addressee accepting
DROP POLICY IF EXISTS "friendships_select_own" ON public.friendships;
CREATE POLICY "friendships_select_own"
  ON public.friendships FOR SELECT
  TO authenticated
  USING (auth.uid() IN (requester_id, addressee_id));

DROP POLICY IF EXISTS "friendships_update_accept" ON public.friendships;
CREATE POLICY "friendships_update_accept"
  ON public.friendships FOR UPDATE
  TO authenticated
  USING (addressee_id = auth.uid() AND status = 'pending')
  WITH CHECK (addressee_id = auth.uid() AND status = 'accepted');

DROP POLICY IF EXISTS "friendships_delete_own" ON public.friendships;
CREATE POLICY "friendships_delete_own"
  ON public.friendships FOR DELETE
  TO authenticated
  USING (auth.uid() IN (requester_id, addressee_id));

-- Conversations & Members: strictly scoped to members
DROP POLICY IF EXISTS "conversations_select_member" ON public.conversations;
CREATE POLICY "conversations_select_member"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (public.is_conversation_member(id));

DROP POLICY IF EXISTS "conversation_members_select_member" ON public.conversation_members;
CREATE POLICY "conversation_members_select_member"
  ON public.conversation_members FOR SELECT
  TO authenticated
  USING (public.is_conversation_member(conversation_id));

-- Messages: strictly scoped to conversation members + 1-hour ephemeral window
DROP POLICY IF EXISTS "messages_select_member_ephemeral" ON public.messages;
CREATE POLICY "messages_select_member_ephemeral"
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    public.is_conversation_member(conversation_id)
    AND created_at > (now() - interval '1 hour')
  );

DROP POLICY IF EXISTS "messages_insert_member" ON public.messages;
CREATE POLICY "messages_insert_member"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_member(conversation_id)
  );

DROP POLICY IF EXISTS "messages_delete_sender" ON public.messages;
CREATE POLICY "messages_delete_sender"
  ON public.messages FOR DELETE
  TO authenticated
  USING (sender_id = auth.uid());

-- Aggregate storage metrics (contains no private/user data; lets Settings display usage)
DROP POLICY IF EXISTS "storage_metrics_select_authenticated" ON public.storage_metrics;
CREATE POLICY "storage_metrics_select_authenticated"
  ON public.storage_metrics FOR SELECT
  TO authenticated
  USING (true);

-- ----------------------------------------------------------------------------
-- 7. PRIVATE STORAGE BUCKETS & STORAGE RLS
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  false,
  55000,
  ARRAY['image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  false,
  26214400,
  ARRAY[
    'image/webp',
    'image/jpeg',
    'image/png',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    'audio/flac',
    'audio/aac'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Avatars bucket RLS: path format <user_id>/avatar.webp
DROP POLICY IF EXISTS "avatars_select_scoped" ON storage.objects;
CREATE POLICY "avatars_select_scoped"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND public.can_view_profile(public.try_parse_uuid((storage.foldername(name))[1]))
  );

DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
CREATE POLICY "avatars_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
CREATE POLICY "avatars_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;
CREATE POLICY "avatars_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Chat-media bucket RLS: path format <conversation_id>/<user_id>/<message_id>.<ext>
DROP POLICY IF EXISTS "chat_media_select_member" ON storage.objects;
CREATE POLICY "chat_media_select_member"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND public.is_conversation_member(public.try_parse_uuid((storage.foldername(name))[1]))
  );

DROP POLICY IF EXISTS "chat_media_insert_member" ON storage.objects;
CREATE POLICY "chat_media_insert_member"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND public.is_conversation_member(public.try_parse_uuid((storage.foldername(name))[1]))
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "chat_media_delete_owner" ON storage.objects;
CREATE POLICY "chat_media_delete_owner"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- ----------------------------------------------------------------------------
-- 8. REALTIME PUBLICATION & REPLICA IDENTITY
-- ----------------------------------------------------------------------------

ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.friendships REPLICA IDENTITY FULL;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['messages', 'friendships', 'conversation_members', 'conversations']
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'supabase_realtime publication not found; skipping.';
END $$;

-- ----------------------------------------------------------------------------
-- 9. PG_CRON SCHEDULED DATABASE PURGE & 5GB GUARD
-- ----------------------------------------------------------------------------
-- Note: Enable the `pg_cron` extension in Supabase Dashboard -> Database -> Extensions
-- before running (or re-run this block after enabling it).

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'veil-hourly-db-purge';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'veil-ceiling-check';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  -- Every hour on minute 0: purge messages > 1h old and enforce 4.5GB ceiling
  PERFORM cron.schedule(
    'veil-hourly-db-purge',
    '0 * * * *',
    'SELECT public.purge_expired_messages(); SELECT public.enforce_storage_ceiling();'
  );

  -- Every 10 minutes: enforce 4.5GB ceiling proactively
  PERFORM cron.schedule(
    'veil-ceiling-check',
    '*/10 * * * *',
    'SELECT public.enforce_storage_ceiling();'
  );
EXCEPTION
  WHEN undefined_table OR invalid_schema_name OR insufficient_privilege THEN
    RAISE NOTICE 'pg_cron not enabled yet; enable pg_cron in Database -> Extensions and re-run section 9.';
END $$;

-- ----------------------------------------------------------------------------
-- 10. OPTIONAL PG_NET CRON FOR EDGE FUNCTION STORAGE CLEANUP
-- ----------------------------------------------------------------------------
-- Enable `pg_net` in Database -> Extensions, deploy `supabase/functions/purge-ephemeral`,
-- and run the snippet below (replacing YOUR_PROJECT_REF and YOUR_SERVICE_ROLE_KEY):
--
-- SELECT cron.schedule(
--   'veil-hourly-storage-purge',
--   '5 * * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/purge-ephemeral',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
