export interface Profile {
  id: string;
  username: string;
  bio: string;
  avatar_path: string | null;
  avatar_size_bytes: number;
  avatar_updated_at: string | null;
  friend_code: string;
  created_at: string;
}

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
  updated_at: string;
}

export interface FriendshipWithProfile extends Friendship {
  direction: 'incoming' | 'outgoing';
  peer: Profile;
}

export interface ConversationMember {
  conversation_id: string;
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
  profile: Profile;
}

export interface ConversationSummary {
  id: string;
  type: 'dm' | 'group';
  name: string | null;
  dm_key: string | null;
  created_by: string | null;
  created_at: string;
  members: ConversationMember[];
  dmPeer: Profile | null;
}

export type MediaCategory = 'text' | 'image' | 'video' | 'audio';

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  media_type: MediaCategory;
  media_path: string | null;
  media_name: string | null;
  media_mime: string | null;
  media_size_bytes: number;
  created_at: string;
}

export interface MessageWithSender extends Message {
  sender: Profile | null;
}

export interface StorageMetrics {
  messages_logical_bytes: number;
  media_bytes: number;
  avatars_bytes: number;
  ceiling_bytes: number;
  target_bytes: number;
  updated_at: string;
}

export interface CallPeer {
  userId: string;
  username: string;
  avatarPath: string | null;
  avatarUpdatedAt: string | null;
  muted: boolean;
  sharingScreen: boolean;
  speaking: boolean;
  audioStream: MediaStream | null;
  screenStream: MediaStream | null;
}

export type RailSection = 'dms' | 'groups' | 'friends' | 'settings';
export type FriendsTab = 'all' | 'pending' | 'add';
export type SettingsTab = 'profile' | 'privacy' | 'av';
